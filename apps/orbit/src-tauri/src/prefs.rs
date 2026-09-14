//! Machine-local desktop preferences (week 11): close-to-tray, whether the
//! first-close explanation was shown, and whether login launch was opted
//! into. They live in `desktop-preferences.json` beside the shell's own
//! `settings.json`, never in the data file: they describe this machine, so
//! exports and imports must not carry them. `ORBIT_DATA_DIR` (the e2e
//! harness) moves them beside the pinned data folder so a test run never
//! reads or writes the user's real preferences.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::commands::data_dir::env_data_dir;

pub const PREFS_FILE: &str = "desktop-preferences.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopPrefs {
    /// Closing the main window hides it; Quit is explicit. New installs default to on.
    pub close_to_tray: bool,
    /// The first user-initiated close shows what close-to-tray means, once.
    pub close_explanation_seen: bool,
    /// The user's opt-in. The OS registration is authoritative; this is what they asked for.
    pub autostart: bool,
    /// The week-10 localStorage flag was transferred (or found absent) once.
    pub legacy_close_migrated: bool,
}

impl Default for DesktopPrefs {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            close_explanation_seen: false,
            autostart: false,
            legacy_close_migrated: false,
        }
    }
}

/// A partial update from the UI; `None` leaves a field alone.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefsPatch {
    pub close_to_tray: Option<bool>,
    pub close_explanation_seen: Option<bool>,
    pub autostart: Option<bool>,
}

impl DesktopPrefs {
    pub fn apply(&mut self, patch: &PrefsPatch) {
        if let Some(v) = patch.close_to_tray {
            self.close_to_tray = v;
        }
        if let Some(v) = patch.close_explanation_seen {
            self.close_explanation_seen = v;
        }
        if let Some(v) = patch.autostart {
            self.autostart = v;
        }
    }

    /// Transfer the week-10 `orbit-close-to-tray` localStorage value once:
    /// an explicit "0" stays off, an explicit "1" stays on, anything else
    /// (missing, unreadable) adopts the new default. Idempotent.
    pub fn migrate_legacy(&mut self, raw: Option<&str>) -> bool {
        if self.legacy_close_migrated {
            return false;
        }
        match raw {
            Some("0") => self.close_to_tray = false,
            Some("1") => self.close_to_tray = true,
            _ => {}
        }
        self.legacy_close_migrated = true;
        true
    }
}

/// The in-memory copy; the file is the durable one. Written through `save`.
pub struct PrefsState(pub Mutex<DesktopPrefs>);

pub fn prefs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(data) = env_data_dir() {
        return Ok(data.parent().unwrap_or(&data).to_path_buf());
    }
    app.path().app_config_dir().map_err(|e| e.to_string())
}

pub fn read(dir: &Path) -> DesktopPrefs {
    match fs::read_to_string(dir.join(PREFS_FILE)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => DesktopPrefs::default(),
    }
}

pub fn write(dir: &Path, prefs: &DesktopPrefs) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    let mut pending = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    pending
        .write_all(text.as_bytes())
        .map_err(|e| e.to_string())?;
    pending.as_file().sync_all().map_err(|e| e.to_string())?;
    pending
        .persist(dir.join(PREFS_FILE))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Load the file into the managed state at startup.
pub fn load(app: &AppHandle) -> DesktopPrefs {
    let prefs = prefs_dir(app).map(|d| read(&d)).unwrap_or_default();
    if let Some(state) = app.try_state::<PrefsState>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = prefs.clone();
        }
    }
    prefs
}

pub fn current(app: &AppHandle) -> DesktopPrefs {
    app.try_state::<PrefsState>()
        .and_then(|s| s.0.lock().ok().map(|p| p.clone()))
        .unwrap_or_default()
}

fn save(app: &AppHandle, prefs: &DesktopPrefs) -> Result<(), String> {
    let dir = prefs_dir(app)?;
    write(&dir, prefs)?;
    if let Some(state) = app.try_state::<PrefsState>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = prefs.clone();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn prefs_get(state: State<'_, PrefsState>) -> Result<DesktopPrefs, String> {
    state
        .0
        .lock()
        .map(|p| p.clone())
        .map_err(|_| "preferences lock poisoned".to_string())
}

#[tauri::command]
pub fn prefs_set(app: AppHandle, patch: PrefsPatch) -> Result<DesktopPrefs, String> {
    let mut prefs = current(&app);
    prefs.apply(&patch);
    save(&app, &prefs)?;
    Ok(prefs)
}

/// The main window sends the raw localStorage value once after hydration.
#[tauri::command]
pub fn prefs_migrate_legacy(app: AppHandle, value: Option<String>) -> Result<DesktopPrefs, String> {
    let mut prefs = current(&app);
    if prefs.migrate_legacy(value.as_deref()) {
        save(&app, &prefs)?;
        let mut fields = serde_json::Map::new();
        fields.insert("closeToTray".into(), serde_json::json!(prefs.close_to_tray));
        fields.insert(
            "hadLegacyValue".into(),
            serde_json::json!(matches!(value.as_deref(), Some("0") | Some("1"))),
        );
        crate::logging::event(
            crate::logging::Level::Info,
            "prefs",
            "migrate-legacy",
            fields,
        );
    }
    Ok(prefs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_values_transfer_once_and_missing_adopts_the_default() {
        let mut off = DesktopPrefs::default();
        assert!(off.migrate_legacy(Some("0")));
        assert!(!off.close_to_tray);
        assert!(
            !off.migrate_legacy(Some("1")),
            "replayed migrations are ignored"
        );
        assert!(!off.close_to_tray);

        let mut on = DesktopPrefs {
            close_to_tray: false,
            ..Default::default()
        };
        assert!(on.migrate_legacy(Some("1")));
        assert!(on.close_to_tray);

        let mut missing = DesktopPrefs::default();
        assert!(missing.migrate_legacy(None));
        assert!(missing.close_to_tray, "new default is on");
        let mut junk = DesktopPrefs::default();
        assert!(junk.migrate_legacy(Some("maybe")));
        assert!(junk.close_to_tray);
    }

    #[test]
    fn round_trips_through_the_file_and_tolerates_a_bad_one() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(dir.path()), DesktopPrefs::default());
        let mut prefs = DesktopPrefs::default();
        prefs.apply(&PrefsPatch {
            close_to_tray: Some(false),
            close_explanation_seen: Some(true),
            autostart: Some(true),
        });
        write(dir.path(), &prefs).unwrap();
        assert_eq!(read(dir.path()), prefs);
        fs::write(dir.path().join(PREFS_FILE), "{not json").unwrap();
        assert_eq!(read(dir.path()), DesktopPrefs::default());
        // Unknown and missing fields are tolerated (an older or newer shell wrote the file).
        fs::write(
            dir.path().join(PREFS_FILE),
            r#"{"closeToTray":false,"future":1}"#,
        )
        .unwrap();
        let partial = read(dir.path());
        assert!(!partial.close_to_tray);
        assert!(!partial.legacy_close_migrated);
    }
}
