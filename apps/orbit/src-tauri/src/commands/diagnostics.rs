//! The diagnostics bundle and its friends. `diagnostics_export` writes a
//! zip next to wherever the user chose: the rolling logs, the last-run
//! marker, and `report.json` — the web side's report (already redacted)
//! plus what only the shell knows (its version, the OS, the log folder's
//! shape). Nothing is uploaded; the user opens the zip and attaches it.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::commands::db::Db;
use crate::logging::{self, LastRun, Level};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FreshIntegrity {
    pub ok: bool,
    pub messages: Vec<String>,
    pub fts5: bool,
    pub duration_ms: u64,
}

/// Re-run SQLite's integrity check when the user builds a diagnostics report.
/// The database mutex makes the result a coherent, current view of the live file.
#[tauri::command]
pub fn diagnostics_integrity(
    state: State<'_, Db>,
    generation: u64,
) -> Result<FreshIntegrity, String> {
    let started = Instant::now();
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "database lock poisoned".to_string())?;
    guard.check_generation(Some(generation))?;
    guard.authorize(None)?;
    let conn = guard
        .connection
        .as_ref()
        .ok_or_else(|| "database is not open".to_string())?;

    let fts5 = conn
        .prepare("PRAGMA compile_options")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map(|options| options.iter().any(|option| option == "ENABLE_FTS5"))
        .unwrap_or(false);
    let messages = conn
        .prepare("PRAGMA integrity_check")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .unwrap_or_else(|error| vec![error.to_string()]);
    let ok = messages == ["ok"];
    let duration_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
    let mut fields = Map::new();
    fields.insert("ok".into(), json!(ok));
    fields.insert("messages".into(), json!(messages.len()));
    fields.insert("durationMs".into(), json!(duration_ms));
    logging::event(Level::Info, "diagnostics", "integrity", fields);
    Ok(FreshIntegrity {
        ok,
        messages,
        fts5,
        duration_ms,
    })
}

/// What the previous run left; filled in at startup, read by the UI once.
pub struct LastRunState(pub Mutex<LastRun>);

#[tauri::command]
pub fn diagnostics_last_run(state: State<'_, LastRunState>) -> Result<LastRun, String> {
    state
        .0
        .lock()
        .map(|r| r.clone())
        .map_err(|_| "last-run state poisoned".to_string())
}

/// One redacted event from the webview into the rolling log. `kind` is
/// clipped to a short identifier; `fields` go through the same sanitizer
/// as every other line, so a title that slipped in is quoted away.
#[tauri::command]
pub fn diagnostics_log(
    level: String,
    kind: String,
    fields: Map<String, Value>,
) -> Result<(), String> {
    let kind: String = kind
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ':' | '_' | '-' | '.'))
        .take(64)
        .collect();
    logging::event(Level::parse(&level), "webview", &kind, fields);
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DiagnosticsBundle {
    pub path: String,
    pub files: Vec<String>,
    pub bytes: u64,
}

#[tauri::command]
pub fn diagnostics_export(
    app: AppHandle,
    path: String,
    report: Value,
) -> Result<DiagnosticsBundle, String> {
    let log_dir = logging::logger().map(|l| l.dir());
    let shell = json!({
        "version": app.package_info().version.to_string(),
        "tauri": tauri::VERSION,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "debug": cfg!(debug_assertions),
    });
    let bundle = write_bundle(Path::new(&path), report, shell, log_dir.as_deref())
        .map_err(|e| format!("Could not write the diagnostics bundle: {e}"))?;
    let mut fields = Map::new();
    fields.insert("files".into(), json!(bundle.files.len()));
    fields.insert("bytes".into(), json!(bundle.bytes));
    logging::event(Level::Info, "diagnostics", "export", fields);
    Ok(bundle)
}

/// Build the zip: `report.json`, `last-run.json`, and `logs/<file>` for
/// every rolling log. Pure of Tauri so a test can read the result back.
pub fn write_bundle(
    path: &Path,
    report: Value,
    shell: Value,
    log_dir: Option<&Path>,
) -> io::Result<DiagnosticsBundle> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = File::create(path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut files = Vec::new();

    let marker = log_dir.and_then(logging::read_marker);
    let mut report = match report {
        Value::Object(map) => map,
        other => {
            let mut map = Map::new();
            map.insert("report".into(), other);
            map
        }
    };
    report.insert("shell".into(), shell);
    report.insert(
        "lastRunMarker".into(),
        marker
            .as_ref()
            .map(|m| serde_json::to_value(m).unwrap_or(Value::Null))
            .unwrap_or(Value::Null),
    );
    let logs = log_dir
        .map(logging::log_files)
        .transpose()?
        .unwrap_or_default();
    report.insert("logFiles".into(), json!(logs.len()));

    zip.start_file("report.json", options)?;
    zip.write_all(serde_json::to_string_pretty(&Value::Object(report))?.as_bytes())?;
    files.push("report.json".to_string());

    if let Some(marker) = marker {
        zip.start_file("last-run.json", options)?;
        zip.write_all(serde_json::to_string_pretty(&marker)?.as_bytes())?;
        files.push("last-run.json".to_string());
    }

    for log in logs {
        let name = log
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("log")
            .to_string();
        let entry = format!("logs/{name}");
        zip.start_file(&entry, options)?;
        zip.write_all(&fs::read(&log)?)?;
        files.push(entry);
    }

    let file = zip.finish()?;
    let bytes = file.metadata().map(|m| m.len()).unwrap_or(0);
    Ok(DiagnosticsBundle {
        path: path.to_string_lossy().into_owned(),
        files,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn entries(path: &Path) -> Vec<(String, String)> {
        let mut archive = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut out = Vec::new();
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).unwrap();
            let mut text = String::new();
            entry.read_to_string(&mut text).unwrap();
            out.push((entry.name().to_string(), text));
        }
        out
    }

    #[test]
    fn bundle_holds_the_report_marker_and_logs_and_nothing_a_person_wrote() {
        let temp = tempfile::tempdir().unwrap();
        let logs = temp.path().join("logs");
        let logger = logging::Logger::new(logs.clone(), Level::Debug);
        let mut fields = Map::new();
        fields.insert(
            "error".into(),
            json!("could not save \"Buy a gift for Omar\""),
        );
        logger.log(Level::Error, "db", "write", fields);
        logging::begin_run(&logs, "0.1.0-test");

        let report = json!({ "generatedAt": "2026-09-14T00:00:00.000Z", "data": { "tasks": { "live": 3 } } });
        let shell = json!({ "version": "0.1.0-test", "os": "windows" });
        let out = temp.path().join("out").join("bundle.zip");
        let bundle = write_bundle(&out, report, shell, Some(&logs)).unwrap();
        assert_eq!(bundle.files.len(), 3);
        assert!(bundle.bytes > 0);

        let entries = entries(&out);
        let names: Vec<&str> = entries.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names[0], "report.json");
        assert_eq!(names[1], "last-run.json");
        assert!(names[2].starts_with("logs/orbit-"));

        let report: Value = serde_json::from_str(&entries[0].1).unwrap();
        assert_eq!(report["data"]["tasks"]["live"], 3);
        assert_eq!(report["shell"]["version"], "0.1.0-test");
        assert_eq!(report["logFiles"], 1);
        assert_eq!(report["lastRunMarker"]["endedCleanly"], false);
        let everything = entries.iter().map(|(_, t)| t.as_str()).collect::<String>();
        assert!(everything.contains("\"op\":\"write\""));
        assert!(!everything.contains("Omar"));
        assert!(!everything.contains("Buy a gift"));
    }

    #[test]
    fn a_missing_log_folder_still_yields_a_report() {
        let temp = tempfile::tempdir().unwrap();
        let out = temp.path().join("bundle.zip");
        let bundle = write_bundle(&out, json!("not an object"), json!({}), None).unwrap();
        assert_eq!(bundle.files, vec!["report.json".to_string()]);
        let report: Value = serde_json::from_str(&entries(&out)[0].1).unwrap();
        assert_eq!(report["report"], "not an object");
        assert_eq!(report["logFiles"], 0);
        assert_eq!(report["lastRunMarker"], Value::Null);
    }
}
