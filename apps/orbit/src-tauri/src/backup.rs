//! Verified local backup rotation for the desktop data file.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

use serde::Serialize;
use serde_json::{json, Map};
use tauri::{AppHandle, Manager, State};

use crate::commands::data_dir::{candidate, snapshot_to, BackupCandidate};
use crate::commands::db::{Database, Db};
use crate::logging::{self, Level};
use crate::{resident, time};

pub const KEEP_DAILY: usize = 7;
pub const KEEP_WEEKLY: usize = 4;
pub const KEEP_MANUAL: usize = 3;
pub const KEEP_BEFORE_RESTORE: usize = 3;
pub const WEEKLY_EVERY_DAYS: i64 = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackupKind {
    Daily,
    Weekly,
    Manual,
    BeforeRestore,
    Other,
}

pub fn classify(file_name: &str) -> BackupKind {
    if file_name.starts_with("daily-") && file_name.ends_with(".db") {
        BackupKind::Daily
    } else if file_name.starts_with("weekly-") && file_name.ends_with(".db") {
        BackupKind::Weekly
    } else if file_name.starts_with("manual-") && file_name.ends_with(".db") {
        BackupKind::Manual
    } else if file_name.starts_with("before-restore-") && file_name.ends_with(".db") {
        BackupKind::BeforeRestore
    } else {
        BackupKind::Other
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pruned {
    pub daily: usize,
    pub weekly: usize,
    pub manual: usize,
    pub before_restore: usize,
}

#[derive(Debug, Clone)]
struct Entry {
    path: PathBuf,
    kind: BackupKind,
    modified: SystemTime,
}

fn keep_for(kind: BackupKind) -> usize {
    match kind {
        BackupKind::Daily => KEEP_DAILY,
        BackupKind::Weekly => KEEP_WEEKLY,
        BackupKind::Manual => KEEP_MANUAL,
        BackupKind::BeforeRestore => KEEP_BEFORE_RESTORE,
        BackupKind::Other => usize::MAX,
    }
}

fn plan_prune(entries: Vec<Entry>) -> Vec<Entry> {
    let mut remove = Vec::new();
    for kind in [
        BackupKind::Daily,
        BackupKind::Weekly,
        BackupKind::Manual,
        BackupKind::BeforeRestore,
    ] {
        let mut matching = entries
            .iter()
            .filter(|entry| entry.kind == kind)
            .cloned()
            .collect::<Vec<_>>();
        matching.sort_by(|a, b| {
            if kind == BackupKind::BeforeRestore {
                a.modified
                    .cmp(&b.modified)
                    .then_with(|| a.path.cmp(&b.path))
            } else {
                a.path.cmp(&b.path)
            }
        });
        let excess = matching.len().saturating_sub(keep_for(kind));
        remove.extend(matching.into_iter().take(excess));
    }
    remove
}

pub(crate) fn prune(dir: &Path) -> Result<Pruned, String> {
    let mut entries = Vec::new();
    let read = match fs::read_dir(dir) {
        Ok(read) => read,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Pruned::default()),
        Err(error) => return Err(error.to_string()),
    };
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("db") {
            continue;
        }
        let meta = entry.metadata().map_err(|error| error.to_string())?;
        entries.push(Entry {
            kind: classify(
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(""),
            ),
            path,
            modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        });
    }
    let mut pruned = Pruned::default();
    for entry in plan_prune(entries) {
        fs::remove_file(&entry.path).map_err(|error| error.to_string())?;
        match entry.kind {
            BackupKind::Daily => pruned.daily += 1,
            BackupKind::Weekly => pruned.weekly += 1,
            BackupKind::Manual => pruned.manual += 1,
            BackupKind::BeforeRestore => pruned.before_restore += 1,
            BackupKind::Other => {}
        }
    }
    Ok(pruned)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    Busy,
    Quitting,
    Exists,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Created {
        weekly: bool,
        bytes: u64,
        pruned: Pruned,
    },
    Skipped(SkipReason),
}

fn backup_dir(connection: &rusqlite::Connection) -> Result<PathBuf, String> {
    let file = connection.path().ok_or("The database has no file path")?;
    Ok(Path::new(file)
        .parent()
        .ok_or("The database has no parent folder")?
        .join("backups"))
}

fn newest_weekly_date(dir: &Path) -> Option<String> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            (classify(&name) == BackupKind::Weekly && name.len() >= 17)
                .then(|| name[7..17].to_string())
        })
        .max()
}

pub fn daily_if_due(db: &mut Database, today: &str) -> Result<Outcome, String> {
    if db.quitting {
        return Ok(Outcome::Skipped(SkipReason::Quitting));
    }
    if db.authorize(None).is_err() {
        return Ok(Outcome::Skipped(SkipReason::Busy));
    }
    let Some(connection) = db.connection.as_ref() else {
        return Ok(Outcome::Skipped(SkipReason::Closed));
    };
    if !connection.is_autocommit() {
        return Ok(Outcome::Skipped(SkipReason::Busy));
    }
    let dir = backup_dir(connection)?;
    let daily_name = format!("daily-{today}.db");
    if dir.join(&daily_name).exists() {
        return Ok(Outcome::Skipped(SkipReason::Exists));
    }
    let daily = snapshot_to(connection, &dir, &daily_name)?;
    let bytes = fs::metadata(&daily)
        .map_err(|error| error.to_string())?
        .len();
    let promote = newest_weekly_date(&dir)
        .and_then(|date| time::days_between(&date, today))
        .is_none_or(|days| days >= WEEKLY_EVERY_DAYS);
    if promote {
        let weekly = dir.join(format!("weekly-{today}.db"));
        fs::copy(&daily, &weekly).map_err(|error| error.to_string())?;
        fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(weekly)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
    }
    Ok(Outcome::Created {
        weekly: promote,
        bytes,
        pruned: prune(&dir)?,
    })
}

pub(crate) fn log_pruned(pruned: Pruned) {
    if pruned == Pruned::default() {
        return;
    }
    let mut fields = Map::new();
    fields.insert("daily".into(), json!(pruned.daily));
    fields.insert("weekly".into(), json!(pruned.weekly));
    fields.insert("manual".into(), json!(pruned.manual));
    fields.insert("beforeRestore".into(), json!(pruned.before_restore));
    logging::event(Level::Info, "backup", "pruned", fields);
}

pub fn run_daily(app: &AppHandle) {
    let Some(state) = app.try_state::<Db>() else {
        return;
    };
    if !resident::scheduler_may_run(app, &state.0) {
        return;
    }
    let started = Instant::now();
    let result = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())
        .and_then(|mut guard| daily_if_due(&mut guard, &time::today_utc()));
    match result {
        Ok(Outcome::Created {
            weekly,
            bytes,
            pruned,
        }) => {
            let mut fields = Map::new();
            fields.insert("kind".into(), json!("daily"));
            fields.insert("weekly".into(), json!(weekly));
            fields.insert("bytes".into(), json!(bytes));
            fields.insert("durationMs".into(), json!(started.elapsed().as_millis()));
            logging::event(Level::Info, "backup", "created", fields);
            log_pruned(pruned);
        }
        Ok(Outcome::Skipped(reason)) => {
            let mut fields = Map::new();
            fields.insert("reason".into(), json!(format!("{reason:?}").to_lowercase()));
            logging::event(Level::Debug, "backup", "skipped", fields);
        }
        Err(error) => logging::error("backup", "failed", &error),
    }
}

pub(crate) fn unique_backup_name(dir: &Path, kind: &str, stamp: &str) -> String {
    let base = format!("{kind}-{stamp}");
    for suffix in 0..1000 {
        let name = if suffix == 0 {
            format!("{base}.db")
        } else {
            format!("{base}-{suffix}.db")
        };
        if !dir.join(&name).exists() {
            return name;
        }
    }
    format!("{base}-overflow.db")
}

#[tauri::command]
pub fn data_backup_now(
    state: State<'_, Db>,
    generation: Option<u64>,
) -> Result<BackupCandidate, String> {
    let started = Instant::now();
    let result = (|| {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        guard.check_generation(generation)?;
        if guard.quitting {
            return Err("Orbit is quitting; try again after reopening it.".into());
        }
        guard.authorize(None)?;
        let connection = guard.connection.as_ref().ok_or("database is not open")?;
        if !connection.is_autocommit() {
            return Err("Orbit is saving data. Try backing up again in a moment.".into());
        }
        let dir = backup_dir(connection)?;
        let name = unique_backup_name(&dir, "manual", &time::compact_utc());
        let path = snapshot_to(connection, &dir, &name)?;
        let pruned = prune(&dir)?;
        log_pruned(pruned);
        candidate(&path)
    })();
    match &result {
        Ok(item) => {
            let mut fields = Map::new();
            fields.insert("kind".into(), json!("manual"));
            fields.insert("weekly".into(), json!(false));
            fields.insert("bytes".into(), json!(item.size_bytes));
            fields.insert("durationMs".into(), json!(started.elapsed().as_millis()));
            logging::event(Level::Info, "backup", "created", fields);
        }
        Err(error) => logging::error("backup", "failed", error),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn classify_names() {
        assert_eq!(classify("daily-2026-09-17.db"), BackupKind::Daily);
        assert_eq!(classify("weekly-2026-09-17.db"), BackupKind::Weekly);
        assert_eq!(classify("manual-20260917T090000Z.db"), BackupKind::Manual);
        assert_eq!(
            classify("before-restore-20260917T090000Z.db"),
            BackupKind::BeforeRestore
        );
        assert_eq!(classify("custom.db"), BackupKind::Other);
    }

    #[test]
    fn same_second_backups_get_unique_classifiable_names() {
        let temp = tempfile::tempdir().unwrap();
        let first = unique_backup_name(temp.path(), "before-restore", "20260917T090000Z");
        fs::write(temp.path().join(&first), b"x").unwrap();
        let second = unique_backup_name(temp.path(), "before-restore", "20260917T090000Z");

        assert_eq!(first, "before-restore-20260917T090000Z.db");
        assert_eq!(second, "before-restore-20260917T090000Z-1.db");
        assert_eq!(classify(&second), BackupKind::BeforeRestore);
    }

    #[test]
    fn rotation_keeps_seven_daily_and_four_weekly_and_ignores_other_kinds() {
        let temp = tempfile::tempdir().unwrap();
        for day in 1..=40 {
            fs::write(temp.path().join(format!("daily-2026-08-{day:02}.db")), b"x").unwrap();
        }
        for day in 1..=10 {
            fs::write(
                temp.path().join(format!("weekly-2026-07-{day:02}.db")),
                b"x",
            )
            .unwrap();
        }
        for day in 1..=2 {
            fs::write(
                temp.path()
                    .join(format!("before-restore-202609{day:02}T090000Z.db")),
                b"x",
            )
            .unwrap();
        }
        fs::write(temp.path().join("custom.db"), b"x").unwrap();
        let removed = prune(temp.path()).unwrap();
        assert_eq!(removed.daily, 33);
        assert_eq!(removed.weekly, 6);
        let names = fs::read_dir(temp.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            names
                .iter()
                .filter(|name| classify(name) == BackupKind::Daily)
                .count(),
            KEEP_DAILY
        );
        assert_eq!(
            names
                .iter()
                .filter(|name| classify(name) == BackupKind::Weekly)
                .count(),
            KEEP_WEEKLY
        );
        assert!(names.iter().any(|name| name == "custom.db"));
        assert_eq!(
            names
                .iter()
                .filter(|name| classify(name) == BackupKind::BeforeRestore)
                .count(),
            2
        );
    }

    #[test]
    fn before_restore_copies_keep_their_own_cap_by_mtime() {
        let entries = (0..5)
            .map(|index| Entry {
                path: PathBuf::from(format!("before-restore-random-{index}.db")),
                kind: BackupKind::BeforeRestore,
                modified: SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(index),
            })
            .collect();
        let planned = plan_prune(entries);
        assert_eq!(planned.len(), 2);
        assert!(planned[0].path.ends_with("before-restore-random-0.db"));
        assert!(planned[1].path.ends_with("before-restore-random-1.db"));
    }

    fn file_database(dir: &Path) -> Database {
        fs::create_dir_all(dir).unwrap();
        let connection = Connection::open(dir.join("orbit.db")).unwrap();
        connection
            .execute_batch(
                "PRAGMA user_version=4; PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
                 CREATE TABLE tasks(id TEXT PRIMARY KEY, data TEXT);
                 CREATE TABLE notes(id TEXT PRIMARY KEY, data TEXT);
                 INSERT INTO tasks VALUES ('one', '{}');",
            )
            .unwrap();
        let mut db = Database::default();
        db.connection = Some(connection);
        db
    }

    #[test]
    fn same_day_is_a_noop_and_weekly_is_promoted_every_seven_days() {
        let temp = tempfile::tempdir().unwrap();
        let mut db = file_database(temp.path());
        assert!(matches!(
            daily_if_due(&mut db, "2026-09-10").unwrap(),
            Outcome::Created { weekly: true, .. }
        ));
        assert_eq!(
            daily_if_due(&mut db, "2026-09-10").unwrap(),
            Outcome::Skipped(SkipReason::Exists)
        );
        assert!(matches!(
            daily_if_due(&mut db, "2026-09-16").unwrap(),
            Outcome::Created { weekly: false, .. }
        ));
        assert!(matches!(
            daily_if_due(&mut db, "2026-09-17").unwrap(),
            Outcome::Created { weekly: true, .. }
        ));
    }

    #[test]
    fn daily_backup_from_a_live_wal_connection_is_complete_and_single_file() {
        let temp = tempfile::tempdir().unwrap();
        let mut db = file_database(temp.path());
        assert!(temp.path().join("orbit.db-wal").exists());
        assert!(matches!(
            daily_if_due(&mut db, "2026-09-17").unwrap(),
            Outcome::Created { .. }
        ));
        let path = temp.path().join("backups/daily-2026-09-17.db");
        let copy = Connection::open(&path).unwrap();
        crate::commands::data_dir::verify_copy(db.connection.as_ref().unwrap(), &copy).unwrap();
        assert_eq!(
            copy.query_row("SELECT count(*) FROM tasks", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(!temp.path().join("backups/daily-2026-09-17.db-wal").exists());
        db.connection
            .as_ref()
            .unwrap()
            .execute("INSERT INTO tasks VALUES ('two', '{}')", [])
            .unwrap();
    }

    #[test]
    fn backup_skips_when_a_transaction_is_owned_or_quitting() {
        let temp = tempfile::tempdir().unwrap();
        let mut db = file_database(temp.path());
        db.begin("ui".into(), None).unwrap();
        assert_eq!(
            daily_if_due(&mut db, "2026-09-17").unwrap(),
            Outcome::Skipped(SkipReason::Busy)
        );
        db.finish("ui", false).unwrap();
        db.quitting = true;
        assert_eq!(
            daily_if_due(&mut db, "2026-09-17").unwrap(),
            Outcome::Skipped(SkipReason::Quitting)
        );
    }

    /// Release evidence, not part of the fast suite. Run with:
    /// `cargo test --manifest-path apps/orbit/src-tauri/Cargo.toml backup_50k_snapshot_measurement -- --ignored --nocapture`
    #[test]
    #[ignore = "release-candidate performance measurement"]
    fn backup_50k_snapshot_measurement() {
        let temp = tempfile::tempdir().unwrap();
        let mut db = file_database(temp.path());
        {
            let connection = db.connection.as_mut().unwrap();
            let transaction = connection.transaction().unwrap();
            {
                let mut tasks = transaction
                    .prepare("INSERT INTO tasks VALUES (?1, ?2)")
                    .unwrap();
                for index in 1..50_000 {
                    tasks
                        .execute((format!("task-{index:05}"), r#"{"title":"Benchmark task"}"#))
                        .unwrap();
                }
                let mut notes = transaction
                    .prepare("INSERT INTO notes VALUES (?1, ?2)")
                    .unwrap();
                for index in 0..10_000 {
                    notes
                        .execute((format!("note-{index:05}"), r#"{"title":"Benchmark note"}"#))
                        .unwrap();
                }
            }
            transaction.commit().unwrap();
        }

        let started = Instant::now();
        assert!(matches!(
            daily_if_due(&mut db, "2026-09-17").unwrap(),
            Outcome::Created { .. }
        ));
        let elapsed = started.elapsed();
        let path = temp.path().join("backups/daily-2026-09-17.db");
        let bytes = fs::metadata(&path).unwrap().len();
        let copy = Connection::open(path).unwrap();
        let rows: i64 = copy
            .query_row(
                "SELECT (SELECT count(*) FROM tasks) + (SELECT count(*) FROM notes)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 60_000);
        println!(
            "backup-50k-duration-ms={} bytes={bytes}",
            elapsed.as_millis()
        );
    }
}
