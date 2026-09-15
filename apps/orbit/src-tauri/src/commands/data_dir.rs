//! Where the data file lives. The choice is stored next to the app's own
//! config (never inside the data folder, which the user may move), and the
//! file itself is `orbit.db` inside the chosen folder.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::{
    backup::{Backup, StepResult},
    Connection, OpenFlags, MAIN_DB,
};
use serde::{Deserialize, Serialize};
use serde_json::Map;
use tauri::{AppHandle, Manager, State};

use crate::logging::{self, Level};

use super::db::Db;

pub const DATA_FILE: &str = "orbit.db";
const SETTINGS_FILE: &str = "settings.json";

/// The tables each schema version added (`packages/storage/src/sqlite/migrations.ts`).
/// A backup is judged against its own version's inventory: a schema-1 file has no
/// reminder or settings tables and a schema-2 file no review tables, and both are
/// still complete Orbit backups that migrate forward after the restore.
const TABLES_V2: &[&str] = &["reminders", "appSettings"];
const TABLES_V3: &[&str] = &["weeklyReviews", "weeklyReviewActions"];

/// Whether a table that exists in the live file is expected in a backup at `version`.
fn table_expected_at(table: &str, version: i64) -> bool {
    if version < 2 && TABLES_V2.contains(&table) {
        return false;
    }
    if version < 3 && TABLES_V3.contains(&table) {
        return false;
    }
    // The search index (week 10) is a rebuildable cache, not part of the data.
    !table.starts_with("search_")
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Settings {
    #[serde(default)]
    data_dir: Option<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(SETTINGS_FILE))
}

fn read_settings(app: &AppHandle) -> Result<Settings, String> {
    let path = settings_path(app)?;
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let mut pending =
        tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|e| e.to_string())?;
    pending
        .write_all(text.as_bytes())
        .map_err(|e| e.to_string())?;
    pending.as_file().sync_all().map_err(|e| e.to_string())?;
    pending.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

/// `ORBIT_DATA_DIR` pins the data folder for a run — the desktop e2e harness
/// uses it so a test never opens the user's real database or settings.
pub fn env_data_dir() -> Option<PathBuf> {
    std::env::var_os("ORBIT_DATA_DIR")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

fn ensure_dir(dir: &Path) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    fs::create_dir_all(dir.join("backups")).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// The folder the user chose, or `None` on first run.
#[tauri::command]
pub fn data_dir_get(app: AppHandle) -> Result<Option<String>, String> {
    if let Some(dir) = env_data_dir() {
        return ensure_dir(&dir).map(Some);
    }
    Ok(read_settings(&app)?.data_dir)
}

/// `%APPDATA%\app.orbit.desktop\data` — used until the user picks a folder.
#[tauri::command]
pub fn data_dir_default(app: AppHandle) -> Result<String, String> {
    if let Some(dir) = env_data_dir() {
        return Ok(dir.to_string_lossy().into_owned());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("data");
    Ok(dir.to_string_lossy().into_owned())
}

/// Remember a folder and make sure it exists. The caller reopens the database.
#[tauri::command]
pub fn data_dir_set(app: AppHandle, path: String) -> Result<String, String> {
    if let Some(dir) = env_data_dir() {
        // Pinned for this run: nothing to remember.
        return ensure_dir(&dir);
    }
    let dir = PathBuf::from(&path);
    ensure_dir(&dir)?;
    let mut settings = read_settings(&app)?;
    settings.data_dir = Some(dir.to_string_lossy().into_owned());
    write_settings(&app, &settings)?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Copy the live database, including committed WAL data, before changing folders.
/// The mutex covers the whole operation so capture cannot write between copy and switch.
#[tauri::command]
pub fn data_dir_relocate(
    app: AppHandle,
    state: State<'_, Db>,
    path: String,
) -> Result<String, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    guard.authorize(None)?;
    let dir = relocate_connection(&mut guard.connection, Path::new(&path), |dir| {
        let mut settings = read_settings(&app)?;
        settings.data_dir = Some(dir.to_string_lossy().into_owned());
        write_settings(&app, &settings)
    })
    .inspect_err(|e| logging::error("data", "relocate", e))?;
    // The webviews reload and acknowledge readiness again; the scheduler waits for that.
    guard.generation += 1;
    logging::event(Level::Info, "data", "relocate", Map::new());
    Ok(dir.to_string_lossy().into_owned())
}

fn verify_copy(source: &Connection, copy: &Connection) -> Result<(), String> {
    let messages = copy
        .prepare("PRAGMA integrity_check")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    if messages != ["ok"] {
        return Err(format!(
            "The copied database failed verification: {}",
            messages.join("; ")
        ));
    }
    let version =
        |conn: &Connection| conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0));
    if version(source).map_err(|e| e.to_string())? != version(copy).map_err(|e| e.to_string())? {
        return Err("The copied database has a different schema version".into());
    }
    let mut tables = source
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .map_err(|e| e.to_string())?;
    let names = tables
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for name in names {
        let name = name.map_err(|e| e.to_string())?;
        let sql = format!("SELECT count(*) FROM \"{}\"", name.replace('"', "\"\""));
        let count = |conn: &Connection| conn.query_row(&sql, [], |row| row.get::<_, i64>(0));
        if count(source).map_err(|e| e.to_string())? != count(copy).map_err(|e| e.to_string())? {
            return Err(format!(
                "The copied database has different row counts for {name}"
            ));
        }
    }
    Ok(())
}

fn relocate_connection(
    active: &mut Option<Connection>,
    dir: &Path,
    remember: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<PathBuf, String> {
    let source = active.as_ref().ok_or("The database is not open yet")?;
    if !source.is_autocommit() {
        return Err("Orbit is saving data. Try changing the folder again in a moment.".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let dir = fs::canonicalize(dir).map_err(|e| e.to_string())?;
    let target = dir.join(DATA_FILE);
    let source_path = fs::canonicalize(source.path().ok_or("The database has no file path")?)
        .map_err(|e| e.to_string())?;
    if source_path == target {
        return Ok(dir);
    }
    // Sidecars can belong to another database even if its main file is absent.
    for name in [
        DATA_FILE,
        "orbit.db-wal",
        "orbit.db-shm",
        "orbit.db-journal",
    ] {
        match fs::symlink_metadata(dir.join(name)) {
            Ok(_) => return Err("That folder already contains an Orbit database or its recovery files. Choose another folder.".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
            Err(e) => return Err(e.to_string()),
        }
    }
    fs::create_dir_all(dir.join("backups")).map_err(|e| e.to_string())?;
    let staged = tempfile::Builder::new()
        .prefix(".orbit-relocate-")
        .tempfile_in(&dir)
        .map_err(|e| e.to_string())?
        .into_temp_path();
    source
        .backup(MAIN_DB, &staged, None)
        .map_err(|e| e.to_string())?;
    {
        let copy = Connection::open(&staged).map_err(|e| e.to_string())?;
        verify_copy(source, &copy)?;
        // Consolidate the copy into one file before publishing it under orbit.db.
        copy.pragma_update(None, "journal_mode", "DELETE")
            .map_err(|e| e.to_string())?;
        copy.close().map_err(|(_, e)| e.to_string())?;
    }
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&staged)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    staged
        .persist_noclobber(&target)
        .map_err(|e| e.to_string())?;
    let switch = (|| {
        let copy = Connection::open(&target).map_err(|e| e.to_string())?;
        copy.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
        )
        .map_err(|e| e.to_string())?;
        remember(&dir)?;
        Ok::<_, String>(copy)
    })();
    match switch {
        Ok(copy) => *active = Some(copy),
        Err(e) => {
            // Only this operation's new copy is removed; the source stays open and untouched.
            let cleanup = fs::remove_file(&target);
            return Err(match cleanup {
                Ok(()) => e,
                Err(cleanup) => format!(
                    "{e}. The original folder is still active; a copy remains at {} ({cleanup})",
                    target.display()
                ),
            });
        }
    }
    Ok(dir)
}

/// Show the data file in the system file manager.
#[tauri::command]
pub fn data_dir_reveal(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    let file = target.join(DATA_FILE);
    let reveal = if file.exists() {
        file
    } else {
        target.to_path_buf()
    };
    tauri_plugin_opener::reveal_item_in_dir(reveal).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCandidate {
    pub path: String,
    pub modified_at: String,
    pub size_bytes: u64,
}

/// Every `*.db` file in `<data dir>/backups`, for the restore path.
#[tauri::command]
pub fn data_backups(path: String) -> Result<Vec<BackupCandidate>, String> {
    let dir = Path::new(&path).join("backups");
    let mut out = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|x| x.to_str()) != Some("db") {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let secs = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(BackupCandidate {
            path: p.to_string_lossy().into_owned(),
            // Seconds since the epoch, zero-padded so lexical order is chronological.
            modified_at: format!("{secs:020}"),
            size_bytes: meta.len(),
        });
    }
    Ok(out)
}

/// Move a corrupt data file (and its WAL/SHM) aside so a fresh one can be created.
#[tauri::command]
pub fn data_quarantine(path: String) -> Result<String, String> {
    let file = PathBuf::from(&path);
    let stamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let stem = file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("orbit")
        .to_string();
    let target = file.with_file_name(format!("{stem}.corrupt-{stamp}.db"));
    fs::rename(&file, &target).map_err(|e| e.to_string())?;
    for suffix in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{path}{suffix}"));
        if side.exists() {
            let _ = fs::remove_file(side);
        }
    }
    Ok(target.to_string_lossy().into_owned())
}

/// Copy a backup over the data file path.
#[tauri::command]
pub fn data_restore(from: String, to: String) -> Result<(), String> {
    fs::copy(&from, &to).map(|_| ()).map_err(|e| e.to_string())
}

/// Restore into the open connection through SQLite's atomic backup transaction.
/// The mutex excludes both webviews and the scheduler for the entire switch.
#[tauri::command]
pub fn data_restore_backup(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, Db>,
    from: String,
    generation: Option<u64>,
) -> Result<String, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    guard.check_generation(generation)?;
    guard.authorize(None)?;
    let preserved = restore_connection(&mut guard.connection, Path::new(&from), |source, dest| {
        copy_into(source, dest)
    })
    .inspect_err(|e| logging::error("data", "restore", e))?;
    logging::event(Level::Info, "data", "restore", Map::new());
    guard.generation += 1; // Already-queued work from an old webview must not overwrite restored data.
                           // Reload the other webview as well so cached settings and records are discarded.
    for (label, other) in app.webview_windows() {
        if label != window.label() {
            let _ = other.eval("window.location.reload()");
        }
    }
    Ok(preserved.to_string_lossy().into_owned())
}

fn copy_into(source: &Connection, destination: &mut Connection) -> Result<(), String> {
    let backup = Backup::new(source, destination).map_err(|e| e.to_string())?;
    match backup.step(-1).map_err(|e| e.to_string())? {
        StepResult::Done => Ok(()),
        _ => Err("The database is busy. Restore was not applied; try again.".into()),
    }
    // Dropping an incomplete Backup rolls its destination transaction back.
}

fn restore_connection(
    active: &mut Option<Connection>,
    from: &Path,
    apply: impl FnOnce(&Connection, &mut Connection) -> Result<(), String>,
) -> Result<PathBuf, String> {
    let current = active.as_mut().ok_or("The database is not open yet")?;
    if !current.is_autocommit() {
        return Err("Orbit is saving data. Try restoring again in a moment.".into());
    }
    let live_path = fs::canonicalize(current.path().ok_or("The database has no file path")?)
        .map_err(|e| e.to_string())?;
    let from = fs::canonicalize(from).map_err(|e| e.to_string())?;
    if from == live_path {
        return Err("Choose a backup, not the active data file.".into());
    }
    let source = Connection::open_with_flags(&from, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    // Check integrity and materialize every table before changing anything live.
    verify_copy(&source, &source)?;
    let version = |conn: &Connection| {
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())
    };
    let source_version = version(&source)?;
    if source_version < 1 || source_version > version(current)? {
        return Err("This backup has an unsupported schema version. Update Orbit before restoring a newer backup.".into());
    }
    let tables = current
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    for table in tables {
        if !table_expected_at(&table, source_version) {
            continue;
        }
        source
            .prepare(&format!(
                "SELECT * FROM \"{}\" LIMIT 0",
                table.replace('"', "\"\"")
            ))
            .map_err(|_| "This is not an Orbit backup.".to_string())?;
    }
    let backups = live_path.parent().unwrap().join("backups");
    fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
    let preserved = tempfile::Builder::new()
        .prefix("before-restore-")
        .suffix(".db")
        .tempfile_in(&backups)
        .map_err(|e| e.to_string())?
        .into_temp_path();
    current
        .backup(MAIN_DB, &preserved, None)
        .map_err(|e| e.to_string())?;
    let original = Connection::open(&preserved).map_err(|e| e.to_string())?;
    verify_copy(current, &original)?;
    original
        .pragma_update(None, "journal_mode", "DELETE")
        .map_err(|e| e.to_string())?;
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&preserved)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    let preserved = preserved.keep().map_err(|e| e.to_string())?;
    let restore = apply(&source, current).and_then(|()| verify_copy(&source, current));
    if let Err(error) = restore {
        copy_into(&original, current).map_err(|recovery| format!("{error}. Automatic recovery failed ({recovery}); your original data is preserved at {}", preserved.display()))?;
        return Err(format!(
            "{error}. The original database is still open and unchanged."
        ));
    }
    Ok(preserved)
}

/// Plain file reads and writes for import / export. Paths come from native
/// dialogs, so no scope table is needed on the JS side.
#[tauri::command]
pub fn file_read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_write_text(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_verifies_first_preserves_original_and_keeps_connection_open() {
        let temp = tempfile::tempdir().unwrap();
        let live = temp.path().join("live");
        let backup_dir = temp.path().join("backup");
        let mut active = Some(seed(&live));
        active
            .as_ref()
            .unwrap()
            .execute_batch("INSERT INTO tasks VALUES ('task-2', '{}')")
            .unwrap();
        seed(&backup_dir).close().unwrap();
        let preserved =
            restore_connection(&mut active, &backup_dir.join(DATA_FILE), copy_into).unwrap();
        assert_eq!(count(active.as_ref().unwrap()), 1);
        assert_eq!(count(&Connection::open(preserved).unwrap()), 2);
        active
            .as_ref()
            .unwrap()
            .execute_batch("INSERT INTO tasks VALUES ('new', '{}')")
            .unwrap();
        assert_eq!(count(active.as_ref().unwrap()), 2);
    }

    #[test]
    fn missing_corrupt_newer_and_failed_restores_leave_original_usable() {
        let temp = tempfile::tempdir().unwrap();
        let live = temp.path().join("live");
        let backup_dir = temp.path().join("backup");
        let mut active = Some(seed(&live));
        let backup = seed(&backup_dir);
        let from = backup_dir.join(DATA_FILE);
        let corrupt = temp.path().join("corrupt.db");
        fs::write(&corrupt, "not sqlite").unwrap();
        for invalid in [temp.path().join("missing.db"), corrupt] {
            assert!(restore_connection(&mut active, &invalid, copy_into).is_err());
            assert_eq!(count(active.as_ref().unwrap()), 1);
        }
        backup.pragma_update(None, "user_version", 99).unwrap();
        assert!(restore_connection(&mut active, &from, copy_into).is_err());
        backup.pragma_update(None, "user_version", 1).unwrap();
        active
            .as_ref()
            .unwrap()
            .execute_batch("CREATE TABLE projects(id, data)")
            .unwrap();
        assert!(restore_connection(&mut active, &from, copy_into)
            .unwrap_err()
            .contains("not an Orbit backup"));
        backup
            .execute_batch("CREATE TABLE projects(id, data)")
            .unwrap();
        backup.close().unwrap();
        // Simulate a failure even AFTER the destination was modified.
        assert!(restore_connection(&mut active, &from, |_, current| {
            current.execute_batch("DELETE FROM tasks").unwrap();
            Err("injected restore failure".into())
        })
        .unwrap_err()
        .contains("original database is still open"));
        assert_eq!(count(active.as_ref().unwrap()), 1);
        active
            .as_ref()
            .unwrap()
            .execute_batch("INSERT INTO tasks VALUES ('still-usable', '{}')")
            .unwrap();
    }

    #[test]
    fn a_backup_without_the_search_cache_restores_into_a_file_that_has_one() {
        let temp = tempfile::tempdir().unwrap();
        let live = temp.path().join("live");
        let backup_dir = temp.path().join("backup");
        let mut active = Some(seed(&live));
        active
            .as_ref()
            .unwrap()
            .execute_batch(
                "CREATE VIRTUAL TABLE search_fts USING fts5(title);
                 CREATE TABLE search_meta(key TEXT PRIMARY KEY, value TEXT);
                 INSERT INTO search_meta VALUES ('schema', '1');
                 INSERT INTO tasks VALUES ('task-2', '{}')",
            )
            .unwrap();
        seed(&backup_dir).close().unwrap();
        restore_connection(&mut active, &backup_dir.join(DATA_FILE), copy_into).unwrap();
        let conn = active.as_ref().unwrap();
        assert_eq!(count(conn), 1);
        // The restored file is the backup: no cache tables until the app rebuilds them.
        let cache: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name LIKE 'search%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cache, 0);
    }

    #[test]
    fn restore_refuses_an_active_ui_transaction() {
        let temp = tempfile::tempdir().unwrap();
        let mut active = Some(seed(temp.path()));
        active
            .as_ref()
            .unwrap()
            .execute_batch("BEGIN IMMEDIATE")
            .unwrap();
        assert!(
            restore_connection(&mut active, &temp.path().join("missing.db"), copy_into)
                .unwrap_err()
                .contains("saving data")
        );
        assert!(!active.as_ref().unwrap().is_autocommit());
        active.as_ref().unwrap().execute_batch("ROLLBACK").unwrap();
    }

    fn seed(dir: &Path) -> Connection {
        fs::create_dir_all(dir).unwrap();
        let conn = Connection::open(dir.join(DATA_FILE)).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
             PRAGMA user_version=1;
             CREATE TABLE tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);
             CREATE TABLE opLog(seq INTEGER PRIMARY KEY, patch TEXT);
             INSERT INTO tasks VALUES ('task-1', '{\"title\":\"Keep me\"}');
             INSERT INTO opLog VALUES (1, 'created');",
        )
        .unwrap();
        conn
    }

    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT count(*) FROM tasks", [], |row| row.get(0))
            .unwrap()
    }

    /// The real fixture files written by older schema versions (`pnpm run make:fixture`).
    fn fixture_db(version: u32) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/db")
            .join(format!("v{version}.db"))
    }

    #[test]
    fn table_expectations_follow_the_backup_version() {
        assert!(table_expected_at("tasks", 1));
        assert!(!table_expected_at("reminders", 1));
        assert!(!table_expected_at("weeklyReviews", 1));
        assert!(table_expected_at("reminders", 2));
        assert!(!table_expected_at("weeklyReviewActions", 2));
        assert!(table_expected_at("weeklyReviews", 3));
        assert!(!table_expected_at("search_fts", 3));
    }

    #[test]
    fn real_old_backups_restore_into_a_schema_3_file_and_migrate_forward() {
        // A live file at schema 3 holds every table, including the week-12 review stores.
        let live_schema = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/sqlite/v3.sql"),
        )
        .unwrap();
        for version in [1u32, 2] {
            let temp = tempfile::tempdir().unwrap();
            let live_dir = temp.path().join("live");
            fs::create_dir_all(&live_dir).unwrap();
            let live = Connection::open(live_dir.join(DATA_FILE)).unwrap();
            live.execute_batch(&live_schema).unwrap();
            live.execute_batch("PRAGMA journal_mode=WAL").unwrap();
            let backup = temp.path().join(format!("backup-v{version}.db"));
            fs::copy(fixture_db(version), &backup).unwrap();
            let mut active = Some(live);
            restore_connection(&mut active, &backup, copy_into)
                .unwrap_or_else(|e| panic!("v{version} backup should restore: {e}"));
            let conn = active.as_ref().unwrap();
            let restored: i64 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(
                restored,
                i64::from(version),
                "the file is the backup's version"
            );
            let tasks: i64 = conn
                .query_row("SELECT count(*) FROM tasks", [], |r| r.get(0))
                .unwrap();
            assert!(tasks > 0);
            // The forward migration is the frontend's job on reload; the older file must
            // simply lack the newer tables rather than carry half of them.
            let reviews: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE name = 'weeklyReviews'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(reviews, 0);
        }
    }

    #[test]
    fn relocation_includes_wal_and_switches_only_after_verification() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("old");
        let new = temp.path().join("new");
        let mut active = Some(seed(&old));
        assert!(fs::metadata(old.join("orbit.db-wal")).unwrap().len() > 0);
        let mut saved = None;
        let result = relocate_connection(&mut active, &new, |dir| {
            let copy = Connection::open(dir.join(DATA_FILE)).unwrap();
            assert_eq!(count(&copy), 1);
            saved = Some(dir.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(saved, Some(result));
        let copy = active.as_ref().unwrap();
        assert_eq!(count(copy), 1);
        assert_eq!(
            copy.query_row("SELECT data FROM tasks", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "{\"title\":\"Keep me\"}"
        );
        assert_eq!(
            copy.query_row("SELECT patch FROM opLog", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "created"
        );
        copy.execute("INSERT INTO tasks VALUES ('task-2', '{}')", [])
            .unwrap();
        assert_eq!(count(copy), 2);
        assert_eq!(count(&Connection::open(old.join(DATA_FILE)).unwrap()), 1);
        assert!(new.join("backups").is_dir());
    }

    #[test]
    fn relocation_never_overwrites_an_existing_database_or_sidecar() {
        for name in [
            DATA_FILE,
            "orbit.db-wal",
            "orbit.db-shm",
            "orbit.db-journal",
        ] {
            let temp = tempfile::tempdir().unwrap();
            let mut active = Some(seed(&temp.path().join("old")));
            let new = temp.path().join("new");
            fs::create_dir_all(&new).unwrap();
            fs::write(new.join(name), b"existing data").unwrap();
            let error =
                relocate_connection(&mut active, &new, |_| panic!("must not switch")).unwrap_err();
            assert!(error.contains("already contains"));
            assert_eq!(fs::read(new.join(name)).unwrap(), b"existing data");
            assert_eq!(count(active.as_ref().unwrap()), 1);
        }
    }

    #[test]
    fn settings_failure_leaves_the_original_connection_and_removes_only_the_new_copy() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("old");
        let new = temp.path().join("new");
        let mut active = Some(seed(&old));
        let error =
            relocate_connection(&mut active, &new, |_| Err("settings denied".into())).unwrap_err();
        assert_eq!(error, "settings denied");
        assert_eq!(
            fs::canonicalize(active.as_ref().unwrap().path().unwrap()).unwrap(),
            fs::canonicalize(old.join(DATA_FILE)).unwrap()
        );
        assert_eq!(count(active.as_ref().unwrap()), 1);
        assert!(!new.join(DATA_FILE).exists());
        assert!(!new.join("orbit.db-wal").exists());
        assert!(!new.join("orbit.db-shm").exists());
        assert!(old.join(DATA_FILE).exists());
    }

    #[test]
    fn active_transaction_prevents_relocation_without_rolling_back_its_work() {
        let temp = tempfile::tempdir().unwrap();
        let mut active = Some(seed(&temp.path().join("old")));
        active
            .as_ref()
            .unwrap()
            .execute_batch("BEGIN IMMEDIATE; INSERT INTO tasks VALUES ('task-2', '{}');")
            .unwrap();
        let error = relocate_connection(&mut active, &temp.path().join("new"), |_| {
            panic!("must not switch")
        })
        .unwrap_err();
        assert!(error.contains("saving data"));
        assert!(!active.as_ref().unwrap().is_autocommit());
        active.as_ref().unwrap().execute_batch("COMMIT").unwrap();
        assert_eq!(count(active.as_ref().unwrap()), 2);
    }

    #[test]
    fn choosing_the_current_folder_is_a_noop() {
        let temp = tempfile::tempdir().unwrap();
        let mut active = Some(seed(temp.path()));
        relocate_connection(&mut active, temp.path(), |_| panic!("nothing changed")).unwrap();
        assert_eq!(count(active.as_ref().unwrap()), 1);
    }

    #[test]
    fn verification_rejects_missing_rows_and_a_different_schema_version() {
        let temp = tempfile::tempdir().unwrap();
        let source = seed(&temp.path().join("old"));
        let copy = seed(&temp.path().join("copy"));
        copy.execute("DELETE FROM tasks", []).unwrap();
        assert!(verify_copy(&source, &copy)
            .unwrap_err()
            .contains("row counts"));
        copy.execute_batch("PRAGMA user_version=2").unwrap();
        assert!(verify_copy(&source, &copy)
            .unwrap_err()
            .contains("schema version"));
    }
}
