//! Reminder scheduler. A thread that, once a minute, looks for pending
//! reminders whose `fireAt` has passed, raises an OS notification for each,
//! and marks them fired. The queue itself is filled by the TypeScript side
//! (`rules/reminders.ts` through `useReminderScheduler`); this thread only
//! delivers, so the two runtimes share one definition of "what to remind".
//!
//! The database mutex is held only around the two short statements, never
//! while a notification is shown: the UI shares that connection.
//!
//! Resident mode (week 11): the thread waits on a channel rather than a
//! plain sleep, so a wake (resume, readiness, a reconcile that wrote rows)
//! runs a pass at once and a stop returns within one bounded join. Ticks
//! are skipped until the main window has acknowledged readiness for the
//! current database generation, so a restore or relocation never delivers
//! from a file the frontend has not reconciled yet.
//!
//! Pre-delivery validation mirrors `rules/reminders.ts`: a row fires only
//! while its rule is enabled, its source is live (an unpaid bill with the
//! same due date; an open owed-to-me commitment of a live person), and no
//! source changed after the row was prepared (`updatedAt` watermarks). A
//! reply recorded after preparation therefore holds the row until the
//! frontend has cancelled the old key and queued the new one; a deleted
//! person cancels delivery outright. Fired and dismissed rows are history
//! and are never revived; a cancelled pending row may be.

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::commands::db::{Database, Db};
use crate::logging::{self, Level};
use crate::notifications::{self, Toast};
use crate::resident;
use crate::time::now_iso;

/// How often the queue is checked.
pub const POLL_INTERVAL: Duration = Duration::from_secs(60);
/// How long Quit waits for a pass that is mid-notification before giving up on the join.
pub const STOP_DEADLINE: Duration = Duration::from_secs(5);

enum Control {
    Wake,
    Stop,
}

/// The running thread's handle: a channel in, a "finished" flag out.
pub struct Scheduler {
    control: Sender<Control>,
    finished: Arc<(Mutex<bool>, Condvar)>,
}

pub struct SchedulerState(pub Mutex<Option<Scheduler>>);

impl Scheduler {
    /// Run a pass now rather than at the next interval.
    pub fn wake(&self) {
        let _ = self.control.send(Control::Wake);
    }

    /// Ask the thread to stop and wait up to `deadline` for it. True when it finished.
    pub fn stop(&self, deadline: Duration) -> bool {
        let _ = self.control.send(Control::Stop);
        let (lock, cv) = &*self.finished;
        let Ok(mut done) = lock.lock() else {
            return false;
        };
        let until = Instant::now() + deadline;
        while !*done {
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            let Ok((guard, _)) = cv.wait_timeout(done, left) else {
                return false;
            };
            done = guard;
        }
        true
    }
}

#[derive(Debug, Deserialize)]
struct Due {
    id: String,
    title: String,
    #[serde(default)]
    body: String,
}

/// Pending reminders whose time has come. Short: the lock is released on return.
fn take_due(conn: &Connection, now: &str) -> Vec<Due> {
    let mut stmt = match conn.prepare(
        "SELECT r.id, r.data FROM reminders r \
         WHERE r.deletedAt IS NULL AND r.status = 'pending' AND r.fireAt <= ?1 \
         AND NOT EXISTS (SELECT 1 FROM reminders history WHERE history.status IN ('fired', 'dismissed') \
           AND json_extract(history.data, '$.key') = json_extract(r.data, '$.key')) \
         AND (json_extract(r.data, '$.source') IN ('review-step', 'person-follow-up', 'monthly-spending') OR ( \
          (json_extract(r.data, '$.source') = 'rule' OR json_extract(r.data, '$.source') IS NULL) \
          AND EXISTS (SELECT 1 FROM rules rule WHERE rule.id = json_extract(r.data, '$.ruleId') \
           AND json_extract(rule.data, '$.deletedAt') IS NULL AND json_extract(rule.data, '$.enabled') = 1 \
           AND json_extract(rule.data, '$.updatedAt') <= json_extract(r.data, '$.updatedAt')) \
          AND ((json_extract(r.data, '$.entityType') = 'bill' AND EXISTS \
           (SELECT 1 FROM bills b WHERE b.id = json_extract(r.data, '$.entityId') \
            AND json_extract(b.data, '$.deletedAt') IS NULL AND json_extract(b.data, '$.paid') = 0 \
            AND json_extract(b.data, '$.updatedAt') <= json_extract(r.data, '$.updatedAt') \
            AND json_extract(r.data, '$.key') = json_extract(r.data, '$.ruleId') || ':' || b.id || ':' || json_extract(b.data, '$.dueAt'))) \
         OR (json_extract(r.data, '$.entityType') = 'commitment' AND EXISTS \
           (SELECT 1 FROM commitments c LEFT JOIN people p ON p.id = json_extract(c.data, '$.personId') \
            WHERE c.id = json_extract(r.data, '$.entityId') AND json_extract(c.data, '$.deletedAt') IS NULL \
            AND json_extract(c.data, '$.status') = 'open' AND json_extract(c.data, '$.direction') = 'owed-to-me' \
            AND json_extract(c.data, '$.updatedAt') <= json_extract(r.data, '$.updatedAt') \
            AND p.id IS NOT NULL AND json_extract(p.data, '$.deletedAt') IS NULL \
             AND json_extract(p.data, '$.updatedAt') <= json_extract(r.data, '$.updatedAt')))))) \
         ORDER BY r.fireAt LIMIT 20",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(), // table missing: the migration has not run yet
    };
    let rows = stmt.query_map(params![now], |row| {
        let id: String = row.get(0)?;
        let data: String = row.get(1)?;
        Ok((id, data))
    });
    let Ok(rows) = rows else {
        return Vec::new();
    };
    rows.flatten()
        .filter_map(|(id, data)| {
            let mut due: Due = serde_json::from_str(&data).ok()?;
            due.id = id;
            Some(due)
        })
        .collect()
}

/// Mark one reminder fired, with an op-log entry like any other write.
fn mark_fired(conn: &Connection, id: &str, now: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE reminders SET data = json_set(data, '$.status', 'fired', '$.updatedAt', ?1) WHERE id = ?2",
        params![now, id],
    )?;
    conn.execute(
        "INSERT INTO opLog(entity, entityId, op, patch, at) VALUES ('reminder', ?1, 'update', ?2, ?3)",
        params![id, r#"{"status":"fired"}"#, now],
    )?;
    Ok(())
}

/// Own the connection from selection through acknowledgement, without holding
/// the mutex across the OS call. UI commands retry while this lease is active.
/// Each notification commits independently, including its op-log entry.
fn deliver(
    db: &Mutex<Database>,
    now: &str,
    mut notify: impl FnMut(&Due) -> Result<(), String>,
) -> usize {
    let mut fired = 0;
    let mut attempted = std::collections::HashSet::new();
    for index in 0..20 {
        let owner = format!("scheduler-{now}-{index}");
        let next = {
            let Ok(mut state) = db.lock() else { break };
            if state.begin(owner.clone()).is_err() {
                break;
            }
            let next = take_due(state.connection.as_ref().unwrap(), now)
                .into_iter()
                .find(|r| !attempted.contains(&r.id));
            if next.is_none() {
                let _ = state.finish(&owner, false);
            }
            next
        };
        let Some(r) = next else { break };
        attempted.insert(r.id.clone());
        let shown = notify(&r);
        let Ok(mut state) = db.lock() else { break };
        if state.authorize(Some(&owner)).is_err() {
            break;
        }
        // A notification error keeps the row pending for the next poll.
        let saved = shown.and_then(|()| {
            mark_fired(state.connection.as_ref().unwrap(), &r.id, now).map_err(|e| e.to_string())
        });
        match saved {
            Ok(()) => {
                if state.finish(&owner, true).is_ok() {
                    fired += 1;
                } else {
                    let _ = state.finish(&owner, false);
                    break;
                }
            }
            Err(error) => {
                eprintln!("orbit: reminder {} will retry: {error}", r.id);
                if state.finish(&owner, false).is_err() {
                    break;
                }
            }
        }
    }
    fired
}

/// One pass: deliver everything due. Returns how many fired. Skipped while
/// the main window has not acknowledged the current database generation.
pub fn tick(app: &AppHandle) -> usize {
    let db = app.state::<Db>();
    if !resident::scheduler_may_run(app, &db.0) {
        return 0;
    }
    let fired = deliver(&db.0, &now_iso(), |r| {
        // The click payload names the reminder, never its content; the tag collapses a
        // redelivered reminder into one notification-centre entry. `show` reports the
        // immediate submission result, so a refused toast keeps the row pending.
        notifications::show(
            app,
            &Toast {
                title: r.title.clone(),
                body: r.body.clone(),
                launch: Some(format!("orbit://reminder/{}", r.id)),
                tag: Some(r.id.clone()),
                group: Some("orbit-reminders".into()),
            },
        )
        .inspect_err(|e| logging::error("scheduler", "notify", e))
    });
    if fired > 0 {
        let mut fields = serde_json::Map::new();
        fields.insert("fired".into(), serde_json::json!(fired));
        logging::event(Level::Info, "scheduler", "deliver", fields);
    }
    fired
}

/// Start the polling thread. Call after `Db` is managed. Idempotent: a second
/// call (a tray action, a second launch) never starts a second thread.
pub fn start(app: AppHandle) {
    let state = app.state::<SchedulerState>();
    let Ok(mut slot) = state.0.lock() else { return };
    if slot.is_some() {
        return;
    }
    let (tx, rx) = mpsc::channel::<Control>();
    let finished = Arc::new((Mutex::new(false), Condvar::new()));
    let flag = finished.clone();
    let handle = app.clone();
    thread::Builder::new()
        .name("orbit-reminders".into())
        .spawn(move || {
            loop {
                tick(&handle);
                match rx.recv_timeout(POLL_INTERVAL) {
                    Ok(Control::Wake) | Err(RecvTimeoutError::Timeout) => continue,
                    Ok(Control::Stop) | Err(RecvTimeoutError::Disconnected) => break,
                }
            }
            let (lock, cv) = &*flag;
            if let Ok(mut done) = lock.lock() {
                *done = true;
            }
            cv.notify_all();
        })
        .expect("spawn reminder scheduler");
    *slot = Some(Scheduler {
        control: tx,
        finished,
    });
}

/// Run a pass as soon as the thread is free.
pub fn wake(app: &AppHandle) {
    if let Some(state) = app.try_state::<SchedulerState>() {
        if let Ok(slot) = state.0.lock() {
            if let Some(s) = slot.as_ref() {
                s.wake();
            }
        }
    }
}

/// Stop the thread and wait for it, bounded. True when it stopped in time (or never ran).
pub fn stop(app: &AppHandle, deadline: Duration) -> bool {
    let Some(state) = app.try_state::<SchedulerState>() else {
        return true;
    };
    let taken = state.0.lock().ok().and_then(|mut slot| slot.take());
    match taken {
        Some(s) => s.stop(deadline),
        None => true,
    }
}

/// The frontend asks for a pass after it wrote or reconciled reminder rows.
#[tauri::command]
pub fn scheduler_wake(app: AppHandle) {
    wake(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Mutex<Database> {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE reminders (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL,
               deletedAt TEXT GENERATED ALWAYS AS (json_extract(data, '$.deletedAt')) VIRTUAL,
               status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) VIRTUAL,
               fireAt TEXT GENERATED ALWAYS AS (json_extract(data, '$.fireAt')) VIRTUAL);
             CREATE TABLE opLog (seq INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT, entityId TEXT,
               op TEXT, patch TEXT, at TEXT);
             CREATE TABLE rules(id TEXT, data TEXT);
             CREATE TABLE bills(id TEXT, data TEXT);
             CREATE TABLE commitments(id TEXT, data TEXT);
             CREATE TABLE people(id TEXT, data TEXT);
             INSERT INTO rules VALUES ('rule', '{\"enabled\":true,\"updatedAt\":\"2026-09-18T06:00:00.000Z\"}');
             INSERT INTO bills VALUES ('bill', '{\"paid\":false,\"dueAt\":\"2026-09-21\",\"updatedAt\":\"2026-09-18T06:00:00.000Z\"}');
             INSERT INTO people VALUES ('omar', '{\"deletedAt\":null,\"lastContactAt\":\"2026-09-01T06:00:00.000Z\",\"updatedAt\":\"2026-09-10T06:00:00.000Z\"}');
             INSERT INTO commitments VALUES ('promise', '{\"personId\":\"omar\",\"status\":\"open\",\"direction\":\"owed-to-me\",\"deletedAt\":null,\"createdAt\":\"2026-09-08T06:00:00.000Z\",\"updatedAt\":\"2026-09-10T06:00:00.000Z\"}');

             INSERT INTO reminders(id, data) VALUES
               ('a', '{\"id\":\"a\",\"title\":\"Rent due\",\"body\":\"900\",\"status\":\"pending\",\"fireAt\":\"2026-09-18T07:00:00.000Z\",\"deletedAt\":null}'),
               ('b', '{\"id\":\"b\",\"title\":\"Later\",\"body\":\"\",\"status\":\"pending\",\"fireAt\":\"2099-01-01T07:00:00.000Z\",\"deletedAt\":null}'),
               ('c', '{\"id\":\"c\",\"title\":\"Done\",\"body\":\"\",\"status\":\"fired\",\"fireAt\":\"2026-09-18T07:00:00.000Z\",\"deletedAt\":null}');",
        )
        .unwrap();
        conn.execute_batch("UPDATE reminders SET data = json_set(data, '$.ruleId', 'rule', '$.entityId', 'bill', '$.entityType', 'bill', '$.key', CASE WHEN id = 'a' THEN 'rule:bill:2026-09-21' ELSE id END, '$.updatedAt', '2026-09-18T06:00:00.000Z')").unwrap();
        let mut state = Database::default();
        state.connection = Some(conn);
        Mutex::new(state)
    }

    /// A prepared follow-up row for Omar's open owed-to-me commitment.
    fn with_follow_up(db: &Mutex<Database>) {
        db.lock().unwrap().connection.as_ref().unwrap().execute_batch(
            "INSERT INTO reminders(id, data) VALUES
               ('f', '{\"id\":\"f\",\"title\":\"Follow up with Omar\",\"body\":\"\",\"status\":\"pending\",\"fireAt\":\"2026-09-15T07:00:00.000Z\",\"deletedAt\":null,\"ruleId\":\"rule\",\"entityId\":\"promise\",\"entityType\":\"commitment\",\"key\":\"rule:promise:2026-09-15\",\"updatedAt\":\"2026-09-18T06:00:00.000Z\"}')",
        ).unwrap();
    }

    #[test]
    fn takes_only_pending_due_rows_and_marks_them_fired() {
        let db = fresh();
        with_follow_up(&db);
        let now = "2026-09-18T09:00:00.000Z";
        let mut seen = Vec::new();
        assert_eq!(
            deliver(&db, now, |r| {
                seen.push(r.id.clone());
                Ok(())
            }),
            2
        );
        assert_eq!(
            seen,
            vec!["f", "a"],
            "oldest fire time first: the follow-up, then the bill"
        );
        assert_eq!(deliver(&db, now, |_| panic!("already fired")), 0);
        let guard = db.lock().unwrap();
        let conn = guard.connection.as_ref().unwrap();
        let status: String = conn
            .query_row(
                "SELECT json_extract(data, '$.status') FROM reminders WHERE id = 'a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "fired");
        let ops: i64 = conn
            .query_row("SELECT count(*) FROM opLog WHERE entityId = 'a'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(ops, 1);
    }

    #[test]
    fn skips_silently_without_a_database() {
        let db = Mutex::new(Database::default());
        assert_eq!(
            deliver(&db, "2026-09-18T09:00:00.000Z", |_| panic!("no database")),
            0
        );
    }

    #[test]
    fn failed_delivery_retries_and_never_writes_a_fired_op() {
        let db = fresh();
        let now = "2026-09-18T09:00:00.000Z";
        assert_eq!(deliver(&db, now, |_| Err("OS unavailable".into())), 0);
        {
            let state = db.lock().unwrap();
            let conn = state.connection.as_ref().unwrap();
            assert_eq!(take_due(conn, now).len(), 1);
            assert_eq!(
                conn.query_row("SELECT count(*) FROM opLog", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert_eq!(deliver(&db, now, |_| Ok(())), 1);
    }

    #[test]
    fn old_duplicate_rows_only_deliver_once_per_key() {
        let db = fresh();
        db.lock().unwrap().connection.as_ref().unwrap().execute_batch("INSERT INTO reminders(id, data) SELECT 'duplicate', json_set(data, '$.id', 'duplicate') FROM reminders WHERE id = 'a'").unwrap();
        assert_eq!(deliver(&db, "2026-09-18T09:00:00.000Z", |_| Ok(())), 1);
    }

    #[test]
    fn follow_ups_need_a_live_person_and_an_unchanged_open_owed_to_me_commitment() {
        for sql in [
            // A reply recorded after the row was prepared: the frontend re-keys it first.
            "UPDATE people SET data = json_set(data, '$.lastContactAt', '2026-09-17T06:00:00.000Z', '$.updatedAt', '2026-09-18T08:00:00.000Z')",
            "UPDATE people SET data = json_set(data, '$.deletedAt', '2026-09-18T08:00:00.000Z')",
            "DELETE FROM people",
            "UPDATE commitments SET data = json_set(data, '$.status', 'done')",
            "UPDATE commitments SET data = json_set(data, '$.direction', 'owed-by-me')",
            "UPDATE commitments SET data = json_set(data, '$.deletedAt', '2026-09-18T08:00:00.000Z')",
        ] {
            let db = fresh();
            with_follow_up(&db);
            db.lock()
                .unwrap()
                .connection
                .as_ref()
                .unwrap()
                .execute_batch(sql)
                .unwrap();
            let mut seen = Vec::new();
            deliver(&db, "2026-09-18T09:00:00.000Z", |r| {
                seen.push(r.id.clone());
                Ok(())
            });
            assert_eq!(seen, vec!["a"], "only the bill fires after: {sql}");
        }
        // Untouched, the follow-up is delivered.
        let db = fresh();
        with_follow_up(&db);
        assert_eq!(deliver(&db, "2026-09-18T09:00:00.000Z", |_| Ok(())), 2);
    }

    #[test]
    fn source_changes_prevent_delivery_even_before_webview_reconciliation() {
        for sql in [
            "UPDATE bills SET data = json_set(data, '$.paid', json('true'))",
            "UPDATE rules SET data = json_set(data, '$.enabled', json('false'))",
            "UPDATE bills SET data = json_set(data, '$.dueAt', '2026-10-01')",
            "UPDATE rules SET data = json_set(data, '$.updatedAt', '2026-09-18T08:30:00.000Z')",
        ] {
            let db = fresh();
            db.lock()
                .unwrap()
                .connection
                .as_ref()
                .unwrap()
                .execute_batch(sql)
                .unwrap();
            assert_eq!(
                deliver(&db, "2026-09-18T09:00:00.000Z", |_| panic!(
                    "obsolete reminder"
                )),
                0
            );
        }
    }

    #[test]
    fn scheduler_never_joins_ui_transactions_and_owns_delivery() {
        let db = fresh();
        let now = "2026-09-18T09:00:00.000Z";
        db.lock().unwrap().begin("ui".into()).unwrap();
        assert_eq!(deliver(&db, now, |_| panic!("must wait")), 0);
        db.lock().unwrap().finish("ui", false).unwrap();
        assert_eq!(
            deliver(&db, now, |_| {
                // The OS call happens without holding the mutex, but other callers
                // still cannot read/write/close/relocate this owned connection.
                assert!(db.lock().unwrap().authorize(None).is_err());
                Ok(())
            }),
            1
        );
    }
}
