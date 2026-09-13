//! Where the data file lives. The choice is stored next to the app's own
//! config (never inside the data folder, which the user may move), and the
//! file itself is `orbit.db` inside the chosen folder.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::{Connection, MAIN_DB};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::db::Db;

pub const DATA_FILE: &str = "orbit.db";
const SETTINGS_FILE: &str = "settings.json";

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
fn env_data_dir() -> Option<PathBuf> {
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
    let dir = relocate_connection(&mut guard, Path::new(&path), |dir| {
        let mut settings = read_settings(&app)?;
        settings.data_dir = Some(dir.to_string_lossy().into_owned());
        write_settings(&app, &settings)
    })?;
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
