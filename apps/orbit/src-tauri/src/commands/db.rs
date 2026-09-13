//! One SQLite connection behind a mutex, driven statement by statement from
//! TypeScript (`packages/storage/src/sqlite`). Keeping a single connection is
//! what makes `BEGIN IMMEDIATE … COMMIT` from the JS side a real transaction;
//! a pool would hand the COMMIT to a different connection.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Value as Json};
use tauri::State;

use crate::logging::{self, Level};

#[derive(Default)]
pub struct Database {
    pub connection: Option<Connection>,
    pub generation: u64,
    owner: Option<(String, Instant)>,
}

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

    pub fn begin(&mut self, owner: String) -> Result<(), String> {
        self.authorize(None)?;
        self.connection
            .as_ref()
            .ok_or("database is not open")?
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        self.owner = Some((owner, Instant::now()));
        Ok(())
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

fn with_conn<T>(
    state: &State<'_, Db>,
    owner: Option<&str>,
    generation: Option<u64>,
    f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    guard.check_generation(generation)?;
    guard.authorize(owner)?;
    let conn = guard
        .connection
        .as_ref()
        .ok_or_else(|| "database is not open".to_string())?;
    let result = f(conn).map_err(|e| e.to_string());
    if owner.is_none() && !conn.is_autocommit() {
        conn.execute_batch("ROLLBACK").map_err(|e| e.to_string())?;
        return Err("Use an owned database transaction for BEGIN/COMMIT.".into());
    }
    result
}

/// Both webviews open the same file. Never replace an active connection on reopen.
#[tauri::command]
pub fn db_open(state: State<'_, Db>, path: String) -> Result<u64, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    guard.expire()?;
    open_connection(&mut guard.connection, &path)?;
    Ok(guard.generation)
}

fn open_connection(active: &mut Option<Connection>, path: &str) -> Result<(), String> {
    if let Some(conn) = active {
        let requested = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
        let current = std::fs::canonicalize(conn.path().ok_or("database has no file path")?)
            .map_err(|e| e.to_string())?;
        if requested == current {
            return Ok(());
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
            Ok(())
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
    with_conn(&state, owner.as_deref(), generation, |conn| {
        conn.execute(&sql, params_from_iter(params.iter().map(to_sql)))
    })
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
    with_conn(&state, owner.as_deref(), generation, |conn| {
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
    })
}

/// A script of several statements (migrations, BEGIN / COMMIT). No parameters.
#[tauri::command]
pub fn db_exec(
    state: State<'_, Db>,
    sql: String,
    owner: Option<String>,
    generation: Option<u64>,
) -> Result<(), String> {
    with_conn(&state, owner.as_deref(), generation, |conn| {
        conn.execute_batch(&sql)
    })
}

#[tauri::command]
pub fn db_begin(
    state: State<'_, Db>,
    owner: String,
    generation: Option<u64>,
) -> Result<(), String> {
    let mut db = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    db.check_generation(generation)?;
    db.begin(owner)
}

#[tauri::command]
pub fn db_finish(
    state: State<'_, Db>,
    owner: String,
    commit: bool,
    generation: Option<u64>,
) -> Result<(), String> {
    let mut db = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    db.check_generation(generation)?;
    db.finish(&owner, commit)
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
    fn only_the_owner_can_access_or_finish_a_transaction() {
        let mut db = Database {
            connection: Some(Connection::open_in_memory().unwrap()),
            ..Default::default()
        };
        db.begin("main".into()).unwrap();
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
        db.begin("main".into()).unwrap();
        assert!(db
            .connection
            .as_ref()
            .unwrap()
            .execute_batch("INSERT OR ROLLBACK INTO test VALUES(1)")
            .is_err());
        assert!(db.finish("main", true).unwrap_err().contains("rolled back"));
        db.authorize(None).unwrap();
        db.begin("capture".into()).unwrap();
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
        db.begin("gone".into()).unwrap();
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
    fn another_window_opening_the_same_file_preserves_the_active_transaction() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("orbit.db");
        let mut active = None;
        open_connection(&mut active, path.to_str().unwrap()).unwrap();
        active
            .as_ref()
            .unwrap()
            .execute_batch("CREATE TABLE tasks(id); BEGIN IMMEDIATE; INSERT INTO tasks VALUES (1);")
            .unwrap();
        open_connection(&mut active, path.to_str().unwrap()).unwrap();
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
