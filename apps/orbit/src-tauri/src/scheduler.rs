//! Reminder scheduler. A thread that, once a minute, looks for pending
//! reminders whose `fireAt` has passed, raises an OS notification for each,
//! and marks them fired. The queue itself is filled by the TypeScript side
//! (`rules/reminders.ts` through `useReminderScheduler`); this thread only
//! delivers, so the two runtimes share one definition of "what to remind".
//!
//! The database mutex is held only around the two short statements, never
//! while a notification is shown: the UI shares that connection.

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::commands::db::Db;

/// How often the queue is checked.
pub const POLL_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Debug, Deserialize)]
struct Due {
    id: String,
    title: String,
    #[serde(default)]
    body: String,
}

/// ISO 8601 instant for "now", the format every stored `fireAt` uses.
fn now_iso() -> String {
    let since = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = since.as_secs() as i64;
    let millis = since.subsec_millis();
    // Civil-from-days (Howard Hinnant), no chrono needed for one timestamp.
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Pending reminders whose time has come. Short: the lock is released on return.
fn take_due(db: &Mutex<Option<Connection>>, now: &str) -> Vec<Due> {
    let Ok(guard) = db.lock() else {
        return Vec::new();
    };
    let Some(conn) = guard.as_ref() else {
        return Vec::new(); // not open yet: skip silently
    };
    let mut stmt = match conn.prepare(
        "SELECT id, data FROM reminders \
         WHERE deletedAt IS NULL AND status = 'pending' AND fireAt <= ?1 \
         ORDER BY fireAt LIMIT 20",
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
fn mark_fired(db: &Mutex<Option<Connection>>, id: &str, now: &str) {
    let Ok(guard) = db.lock() else { return };
    let Some(conn) = guard.as_ref() else { return };
    let _ = conn.execute(
        "UPDATE reminders SET data = json_set(data, '$.status', 'fired', '$.updatedAt', ?1) WHERE id = ?2",
        params![now, id],
    );
    let _ = conn.execute(
        "INSERT INTO opLog(entity, entityId, op, patch, at) VALUES ('reminder', ?1, 'update', ?2, ?3)",
        params![id, r#"{"status":"fired"}"#, now],
    );
}

/// One pass: deliver everything due. Returns how many fired.
pub fn tick(app: &AppHandle) -> usize {
    let db = app.state::<Db>();
    let now = now_iso();
    let due = take_due(&db.0, &now);
    let mut fired = 0;
    for r in due {
        let shown = app
            .notification()
            .builder()
            .title(&r.title)
            .body(&r.body)
            .show();
        if shown.is_err() {
            eprintln!("orbit: could not show reminder {}", r.id);
        }
        mark_fired(&db.0, &r.id, &now);
        fired += 1;
    }
    fired
}

/// Start the polling thread. Call after `Db` is managed.
pub fn start(app: AppHandle) {
    thread::Builder::new()
        .name("orbit-reminders".into())
        .spawn(move || loop {
            tick(&app);
            thread::sleep(POLL_INTERVAL);
        })
        .expect("spawn reminder scheduler");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_iso_is_utc_iso8601() {
        let s = now_iso();
        assert_eq!(s.len(), 24, "{s}");
        assert!(s.ends_with('Z'));
        assert_eq!(&s[10..11], "T");
    }

    fn fresh() -> Mutex<Option<Connection>> {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE reminders (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL,
               deletedAt TEXT GENERATED ALWAYS AS (json_extract(data, '$.deletedAt')) VIRTUAL,
               status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) VIRTUAL,
               fireAt TEXT GENERATED ALWAYS AS (json_extract(data, '$.fireAt')) VIRTUAL);
             CREATE TABLE opLog (seq INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT, entityId TEXT,
               op TEXT, patch TEXT, at TEXT);
             INSERT INTO reminders(id, data) VALUES
               ('a', '{\"id\":\"a\",\"title\":\"Rent due\",\"body\":\"900\",\"status\":\"pending\",\"fireAt\":\"2026-09-18T07:00:00.000Z\",\"deletedAt\":null}'),
               ('b', '{\"id\":\"b\",\"title\":\"Later\",\"body\":\"\",\"status\":\"pending\",\"fireAt\":\"2099-01-01T07:00:00.000Z\",\"deletedAt\":null}'),
               ('c', '{\"id\":\"c\",\"title\":\"Done\",\"body\":\"\",\"status\":\"fired\",\"fireAt\":\"2026-09-18T07:00:00.000Z\",\"deletedAt\":null}');",
        )
        .unwrap();
        Mutex::new(Some(conn))
    }

    #[test]
    fn takes_only_pending_due_rows_and_marks_them_fired() {
        let db = fresh();
        let now = "2026-09-18T09:00:00.000Z";
        let due = take_due(&db, now);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, "a");
        assert_eq!(due[0].title, "Rent due");
        mark_fired(&db, "a", now);
        assert!(take_due(&db, now).is_empty());
        let guard = db.lock().unwrap();
        let conn = guard.as_ref().unwrap();
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
        let db: Mutex<Option<Connection>> = Mutex::new(None);
        assert!(take_due(&db, "2026-09-18T09:00:00.000Z").is_empty());
        mark_fired(&db, "a", "2026-09-18T09:00:00.000Z");
    }
}
