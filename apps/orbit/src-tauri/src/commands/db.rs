//! One SQLite connection behind a mutex, driven statement by statement from
//! TypeScript (`packages/storage/src/sqlite`). Keeping a single connection is
//! what makes `BEGIN IMMEDIATE … COMMIT` from the JS side a real transaction;
//! a pool would hand the COMMIT to a different connection.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Map, Value as Json};
use tauri::State;

use crate::logging::{self, Level};

#[derive(Default)]
pub struct Database {
    pub connection: Option<Connection>,
    pub generation: u64,
    owner: Option<(String, Instant)>,
    /// Label of the webview whose document opened the owned transaction, so a reload of that
    /// window releases it at once instead of after the 30 s expiry.
    owner_window: Option<String>,
    /// Shutdown has begun: new independent writes and new transactions are refused with a
    /// clear message; a transaction that already owns the connection may still finish.
    pub quitting: bool,
}

pub const QUITTING_MESSAGE: &str = "Orbit is quitting; this change was not saved.";

pub struct Db(pub Mutex<Database>);

impl Database {
    pub fn check_generation(&self, generation: Option<u64>) -> Result<(), String> {
        if generation.is_some_and(|g| g != self.generation) {
            return Err("The data file changed. Reload Orbit before saving more changes.".into());
        }
        Ok(())
    }
    /// A vanished/reloaded webview must not leave everyone else locked out forever.
    pub fn expire(&mut self) -> Result<(), String> {
        if self
            .owner
            .as_ref()
            .is_some_and(|(_, at)| at.elapsed() > Duration::from_secs(30))
        {
            if let Some(conn) = self.connection.as_ref() {
                if !conn.is_autocommit() {
                    conn.execute_batch("ROLLBACK").map_err(|e| e.to_string())?;
                }
            }
            self.owner = None;
        }
        Ok(())
    }

    /// No transaction is owned (an abandoned one is expired first). Shutdown waits for this.
    pub fn is_idle(&mut self) -> bool {
        let _ = self.expire();
        self.owner.is_none()
    }

    pub fn authorize(&mut self, owner: Option<&str>) -> Result<(), String> {
        self.expire()?;
        match (&mut self.owner, owner) {
            (None, None) => Ok(()),
            (Some((active, touched)), Some(id)) if active == id => {
                *touched = Instant::now();
                Ok(())
            }
            (Some(_), None) => Err("ORBIT_DB_BUSY: another transaction is active".into()),
            _ => Err("The database transaction expired or has already finished.".into()),
        }
    }

    pub fn begin(&mut self, owner: String, window: Option<String>) -> Result<(), String> {
        if self.quitting {
            return Err(QUITTING_MESSAGE.into());
        }
        self.authorize(None)?;
        self.connection
            .as_ref()
            .ok_or("database is not open")?
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        self.owner = Some((owner, Instant::now()));
        self.owner_window = window;
        Ok(())
    }

    /// The document that owned the transaction is gone (the window navigated or reloaded):
    /// nothing can ever finish it, so roll it back now. True when something was released.
    pub fn release_window(&mut self, label: &str) -> Result<bool, String> {
        if self.owner.is_none() || self.owner_window.as_deref() != Some(label) {
            return Ok(false);
        }
        if let Some(conn) = self.connection.as_ref() {
            if !conn.is_autocommit() {
                conn.execute_batch("ROLLBACK").map_err(|e| e.to_string())?;
            }
        }
        self.owner = None;
        self.owner_window = None;
        Ok(true)
    }

    pub fn finish(&mut self, owner: &str, commit: bool) -> Result<(), String> {
        self.authorize(Some(owner))?;
        let conn = self.connection.as_ref().ok_or("database is not open")?;
        if conn.is_autocommit() {
            // SQLite can roll back automatically after a write failure.
            self.owner = None;
            return if commit {
                Err("The database transaction was rolled back.".into())
            } else {
                Ok(())
            };
        }
        let result = conn
            .execute_batch(if commit { "COMMIT" } else { "ROLLBACK" })
            .map_err(|e| e.to_string());
        if result.is_ok() || conn.is_autocommit() {
            self.owner = None;
        }
        result
    }
}

type Row = Map<String, Json>;

fn to_sql(v: &Json) -> Value {
    match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().unwrap_or(0.0)),
        },
        Json::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}

fn from_sql(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => Json::from(f),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::Array(b.iter().map(|x| Json::from(*x)).collect()),
    }
}

/// A command that waited for the connection, or ran, at least this long is logged, so a
/// slow start or a stalled screen can be attributed from the diagnostics bundle.
const SLOW_COMMAND: Duration = Duration::from_millis(250);

/// Statement shape only (no parameters, so no user data), enough to name the query.
fn note_slow(command: &str, statement: &str, lock_wait: Duration, exec: Duration) {
    if lock_wait < SLOW_COMMAND && exec < SLOW_COMMAND {
        return;
    }
    let mut fields = Map::new();
    fields.insert("command".into(), json!(command));
    fields.insert(
        "statement".into(),
        json!(statement
            .split_whitespace()
            .take(6)
            .collect::<Vec<_>>()
            .join(" ")),
    );
    fields.insert("lockWaitMs".into(), json!(lock_wait.as_millis()));
    fields.insert("execMs".into(), json!(exec.as_millis()));
    logging::event(Level::Info, "db", "slow", fields);
}

fn with_conn<T>(
    state: &State<'_, Db>,
    command: &str,
    statement: &str,
    owner: Option<&str>,
    generation: Option<u64>,
    read_only: bool,
    f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let waiting = Instant::now();
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let lock_wait = waiting.elapsed();
    guard.check_generation(generation)?;
    if guard.quitting && owner.is_none() && !read_only {
        return Err(QUITTING_MESSAGE.into());
    }
    guard.authorize(owner)?;
    let conn = guard
        .connection
        .as_ref()
        .ok_or_else(|| "database is not open".to_string())?;
    let running = Instant::now();
    let result = f(conn).map_err(|e| e.to_string());
    note_slow(command, statement, lock_wait, running.elapsed());
    if owner.is_none() && !conn.is_autocommit() {
        conn.execute_batch("ROLLBACK").map_err(|e| e.to_string())?;
        return Err("Use an owned database transaction for BEGIN/COMMIT.".into());
    }
    result
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub generation: u64,
    /// This call opened the file. The window that opens it verifies it and owns recovery;
    /// a window that finds it already open (the other webview got there first) does neither,
    /// so the full integrity check runs once per connection, not once per window.
    pub fresh: bool,
}

/// Both webviews open the same file. Never replace an active connection on reopen.
#[tauri::command]
pub fn db_open(state: State<'_, Db>, path: String) -> Result<Opened, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    guard.expire()?;
    let fresh = open_connection(&mut guard.connection, &path)?;
    Ok(Opened {
        generation: guard.generation,
        fresh,
    })
}

/// Opens the file unless it is already the active connection; true when this call opened it.
fn open_connection(active: &mut Option<Connection>, path: &str) -> Result<bool, String> {
    if let Some(conn) = active {
        let requested = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
        let current = std::fs::canonicalize(conn.path().ok_or("database has no file path")?)
            .map_err(|e| e.to_string())?;
        if requested == current {
            return Ok(false);
        }
        return Err(
            "A different database is already open. Reload Orbit to use the current data folder."
                .into(),
        );
    }
    match Connection::open(path) {
        Ok(conn) => {
            *active = Some(conn);
            logging::event(Level::Info, "db", "open", Map::new());
            Ok(true)
        }
        Err(e) => {
            logging::error("db", "open", &e.to_string());
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub fn db_close(state: State<'_, Db>, generation: Option<u64>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    guard.check_generation(generation)?;
    guard.authorize(None)?;
    if let Some(conn) = guard.connection.take() {
        if let Err((conn, error)) = conn.close() {
            guard.connection = Some(conn);
            return Err(error.to_string());
        }
    }
    Ok(())
}

/// One statement without a result set. Returns the affected row count.
#[tauri::command]
pub fn db_execute(
    state: State<'_, Db>,
    sql: String,
    params: Vec<Json>,
    owner: Option<String>,
    generation: Option<u64>,
) -> Result<usize, String> {
    with_conn(
        &state,
        "db_execute",
        &sql,
        owner.as_deref(),
        generation,
        false,
        |conn| conn.execute(&sql, params_from_iter(params.iter().map(to_sql))),
    )
}

/// One statement with a result set, rows as JSON objects keyed by column name.
#[tauri::command]
pub fn db_select(
    state: State<'_, Db>,
    sql: String,
    params: Vec<Json>,
    owner: Option<String>,
    generation: Option<u64>,
) -> Result<Vec<Row>, String> {
    with_conn(
        &state,
        "db_select",
        &sql,
        owner.as_deref(),
        generation,
        true,
        |conn| {
            let mut stmt = conn.prepare(&sql)?;
            let names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
            let rows = stmt.query_map(params_from_iter(params.iter().map(to_sql)), |row| {
                let mut out = Row::new();
                for (i, name) in names.iter().enumerate() {
                    out.insert(name.clone(), from_sql(row.get_ref(i)?));
                }
                Ok(out)
            })?;
            rows.collect()
        },
    )
}

/// A script of several statements (migrations, BEGIN / COMMIT). No parameters.
#[tauri::command]
pub fn db_exec(
    state: State<'_, Db>,
    sql: String,
    owner: Option<String>,
    generation: Option<u64>,
) -> Result<(), String> {
    with_conn(
        &state,
        "db_exec",
        &sql,
        owner.as_deref(),
        generation,
        false,
        |conn| conn.execute_batch(&sql),
    )
}

#[tauri::command]
pub fn db_begin(
    state: State<'_, Db>,
    webview: tauri::Webview,
    owner: String,
    generation: Option<u64>,
) -> Result<(), String> {
    let waiting = Instant::now();
    let mut db = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let lock_wait = waiting.elapsed();
    db.check_generation(generation)?;
    let running = Instant::now();
    let result = db.begin(owner, Some(webview.label().to_string()));
    note_slow("db_begin", "BEGIN IMMEDIATE", lock_wait, running.elapsed());
    result
}

#[tauri::command]
pub fn db_finish(
    state: State<'_, Db>,
    owner: String,
    commit: bool,
    generation: Option<u64>,
) -> Result<(), String> {
    let waiting = Instant::now();
    let mut db = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let lock_wait = waiting.elapsed();
    db.check_generation(generation)?;
    let running = Instant::now();
    let result = db.finish(&owner, commit);
    note_slow(
        "db_finish",
        if commit { "COMMIT" } else { "ROLLBACK" },
        lock_wait,
        running.elapsed(),
    );
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_restored_database_rejects_work_queued_by_old_webviews() {
        let mut db = Database::default();
        db.check_generation(Some(0)).unwrap();
        db.generation += 1;
        assert!(db.check_generation(Some(0)).unwrap_err().contains("Reload"));
        db.check_generation(Some(1)).unwrap();
    }

    #[test]
    fn shutdown_refuses_new_transactions_but_lets_an_owned_one_finish() {
        let mut db = Database {
            connection: Some(Connection::open_in_memory().unwrap()),
            ..Default::default()
        };
        db.begin("main".into(), Some("main".into())).unwrap();
        db.quitting = true;
        assert!(!db.is_idle(), "the owned transaction is still settling");
        assert_eq!(
            db.begin("capture".into(), None).unwrap_err(),
            QUITTING_MESSAGE
        );
        db.authorize(Some("main")).unwrap();
        db.finish("main", true).unwrap();
        assert!(db.is_idle());
        assert_eq!(
            db.begin("later".into(), None).unwrap_err(),
            QUITTING_MESSAGE
        );
    }

    #[test]
    fn only_the_owner_can_access_or_finish_a_transaction() {
        let mut db = Database {
            connection: Some(Connection::open_in_memory().unwrap()),
            ..Default::default()
        };
        db.begin("main".into(), Some("main".into())).unwrap();
        assert!(db.authorize(None).unwrap_err().contains("ORBIT_DB_BUSY"));
        assert!(db.authorize(Some("capture")).is_err());
        assert!(db.finish("capture", false).is_err());
        db.authorize(Some("main")).unwrap();
        db.finish("main", true).unwrap();
        db.authorize(None).unwrap();
        assert!(db.authorize(Some("main")).is_err());
    }

    #[test]
    fn sqlite_automatic_rollback_releases_the_owner() {
        let mut db = Database {
            connection: Some(Connection::open_in_memory().unwrap()),
            ..Default::default()
        };
        db.connection
            .as_ref()
            .unwrap()
            .execute_batch("CREATE TABLE test(id PRIMARY KEY); INSERT INTO test VALUES(1)")
            .unwrap();
        db.begin("main".into(), Some("main".into())).unwrap();
        assert!(db
            .connection
            .as_ref()
            .unwrap()
            .execute_batch("INSERT OR ROLLBACK INTO test VALUES(1)")
            .is_err());
        assert!(db.finish("main", true).unwrap_err().contains("rolled back"));
        db.authorize(None).unwrap();
        db.begin("capture".into(), Some("capture".into())).unwrap();
        db.finish("capture", true).unwrap();
    }

    #[test]
    fn abandoned_owner_is_rolled_back_before_another_window_proceeds() {
        let mut db = Database {
            connection: Some(Connection::open_in_memory().unwrap()),
            ..Default::default()
        };
        db.connection
            .as_ref()
            .unwrap()
            .execute_batch("CREATE TABLE tasks(id)")
            .unwrap();
        db.begin("gone".into(), Some("main".into())).unwrap();
        db.connection
            .as_ref()
            .unwrap()
            .execute_batch("INSERT INTO tasks VALUES (1)")
            .unwrap();
        db.owner = Some(("gone".into(), Instant::now() - Duration::from_secs(31)));
        db.authorize(None).unwrap();
        assert_eq!(
            db.connection
                .as_ref()
                .unwrap()
                .query_row("SELECT count(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(db.finish("gone", true).is_err());
    }

    #[test]
    fn reloading_the_owning_window_releases_its_transaction_at_once() {
        let mut db = Database {
            connection: Some(Connection::open_in_memory().unwrap()),
            ..Default::default()
        };
        db.connection
            .as_ref()
            .unwrap()
            .execute_batch("CREATE TABLE tasks(id)")
            .unwrap();
        db.begin("doc-1".into(), Some("main".into())).unwrap();
        db.connection
            .as_ref()
            .unwrap()
            .execute_batch("INSERT INTO tasks VALUES (1)")
            .unwrap();
        // Another window's document loading changes nothing.
        assert!(!db.release_window("capture").unwrap());
        assert!(db.authorize(None).is_err());
        // The owning window's new document: rolled back, free immediately, no 30 s wait.
        assert!(db.release_window("main").unwrap());
        assert!(!db.release_window("main").unwrap());
        db.authorize(None).unwrap();
        assert_eq!(
            db.connection
                .as_ref()
                .unwrap()
                .query_row("SELECT count(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(db.finish("doc-1", true).is_err());
        // A transaction owned from Rust (the scheduler) has no window and is never released this way.
        db.begin("scheduler".into(), None).unwrap();
        assert!(!db.release_window("main").unwrap());
        db.finish("scheduler", false).unwrap();
    }

    #[test]
    fn another_window_opening_the_same_file_preserves_the_active_transaction() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("orbit.db");
        let mut active = None;
        assert!(open_connection(&mut active, path.to_str().unwrap()).unwrap());
        active
            .as_ref()
            .unwrap()
            .execute_batch("CREATE TABLE tasks(id); BEGIN IMMEDIATE; INSERT INTO tasks VALUES (1);")
            .unwrap();
        // The second window is told the file was already open, so it skips verification.
        assert!(!open_connection(&mut active, path.to_str().unwrap()).unwrap());
        let conn = active.as_ref().unwrap();
        assert!(!conn.is_autocommit());
        conn.execute_batch("COMMIT").unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM tasks", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn a_stale_window_cannot_switch_back_to_a_different_file() {
        let temp = tempfile::tempdir().unwrap();
        let current = temp.path().join("current.db");
        let stale = temp.path().join("stale.db");
        Connection::open(&stale).unwrap();
        let mut active = None;
        open_connection(&mut active, current.to_str().unwrap()).unwrap();
        assert!(open_connection(&mut active, stale.to_str().unwrap())
            .unwrap_err()
            .contains("different database"));
        assert_eq!(
            fs_path(active.as_ref().unwrap()),
            std::fs::canonicalize(current).unwrap()
        );
    }

    fn fs_path(conn: &Connection) -> std::path::PathBuf {
        std::fs::canonicalize(conn.path().unwrap()).unwrap()
    }
}
