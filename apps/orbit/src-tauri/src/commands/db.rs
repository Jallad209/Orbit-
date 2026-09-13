//! One SQLite connection behind a mutex, driven statement by statement from
//! TypeScript (`packages/storage/src/sqlite`). Keeping a single connection is
//! what makes `BEGIN IMMEDIATE … COMMIT` from the JS side a real transaction;
//! a pool would hand the COMMIT to a different connection.

use std::sync::Mutex;

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Value as Json};
use tauri::State;

pub struct Db(pub Mutex<Option<Connection>>);

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
    f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    let conn = guard
        .as_ref()
        .ok_or_else(|| "database is not open".to_string())?;
    f(conn).map_err(|e| e.to_string())
}

/// Open (or create) the data file. Replaces any connection already open.
#[tauri::command]
pub fn db_open(state: State<'_, Db>, path: String) -> Result<(), String> {
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    *guard = Some(conn);
    Ok(())
}

#[tauri::command]
pub fn db_close(state: State<'_, Db>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    if let Some(conn) = guard.take() {
        conn.close().map_err(|(_, e)| e.to_string())?;
    }
    Ok(())
}

/// One statement without a result set. Returns the affected row count.
#[tauri::command]
pub fn db_execute(state: State<'_, Db>, sql: String, params: Vec<Json>) -> Result<usize, String> {
    with_conn(&state, |conn| {
        conn.execute(&sql, params_from_iter(params.iter().map(to_sql)))
    })
}

/// One statement with a result set, rows as JSON objects keyed by column name.
#[tauri::command]
pub fn db_select(state: State<'_, Db>, sql: String, params: Vec<Json>) -> Result<Vec<Row>, String> {
    with_conn(&state, |conn| {
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
pub fn db_exec(state: State<'_, Db>, sql: String) -> Result<(), String> {
    with_conn(&state, |conn| conn.execute_batch(&sql))
}
