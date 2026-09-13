//! Where the data file lives. The choice is stored next to the app's own
//! config (never inside the data folder, which the user may move), and the
//! file itself is `orbit.db` inside the chosen folder.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

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
    fs::write(path, text).map_err(|e| e.to_string())
}

/// The folder the user chose, or `None` on first run.
#[tauri::command]
pub fn data_dir_get(app: AppHandle) -> Result<Option<String>, String> {
    Ok(read_settings(&app)?.data_dir)
}

/// `%APPDATA%\app.orbit.desktop\data` — used until the user picks a folder.
#[tauri::command]
pub fn data_dir_default(app: AppHandle) -> Result<String, String> {
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
    let dir = PathBuf::from(&path);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    fs::create_dir_all(dir.join("backups")).map_err(|e| e.to_string())?;
    let mut settings = read_settings(&app)?;
    settings.data_dir = Some(dir.to_string_lossy().into_owned());
    write_settings(&app, &settings)?;
    Ok(dir.to_string_lossy().into_owned())
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
