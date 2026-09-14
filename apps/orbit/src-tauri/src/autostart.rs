//! Opt-in login launch (week 11). The OS registration (`HKCU\...\Run` on
//! Windows, written by `tauri-plugin-autostart` for the current user only)
//! is the source of truth: every read goes back to it, and an enable or
//! disable that fails leaves the toggle showing the real state. Under
//! `ORBIT_AUTOSTART_FAKE=<file>` (the e2e harness) the registration is a
//! file, so a test never touches the user's login items.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::logging::{self, Level};
use crate::prefs;

/// The argument the login launch passes; the lifecycle reads it as "start hidden".
pub const BACKGROUND_ARG: &str = "--background";
/// The registry value name the plugin writes; the NSIS hook deletes exactly this one.
pub const APP_NAME: &str = "Orbit";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutostartStatus {
    /// What the OS actually has registered.
    pub enabled: bool,
    /// What the user opted into (the preference), which can disagree after a failure.
    pub wanted: bool,
    /// Why the last read or write failed, if it did.
    pub error: Option<String>,
    /// Real registration or the test double.
    pub backend: &'static str,
}

fn fake_path() -> Option<PathBuf> {
    std::env::var_os("ORBIT_AUTOSTART_FAKE")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

fn read_registration(app: &AppHandle) -> Result<bool, String> {
    if let Some(path) = fake_path() {
        return Ok(path.exists());
    }
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

fn write_registration(app: &AppHandle, on: bool) -> Result<(), String> {
    if let Some(path) = fake_path() {
        return if on {
            fs::write(&path, format!("{APP_NAME} {BACKGROUND_ARG}\n")).map_err(|e| e.to_string())
        } else {
            match fs::remove_file(&path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        };
    }
    let manager = app.autolaunch();
    if on {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

pub fn status(app: &AppHandle) -> AutostartStatus {
    let wanted = prefs::current(app).autostart;
    let backend = if fake_path().is_some() { "fake" } else { "os" };
    match read_registration(app) {
        Ok(enabled) => AutostartStatus {
            enabled,
            wanted,
            error: None,
            backend,
        },
        Err(error) => AutostartStatus {
            enabled: false,
            wanted,
            error: Some(error),
            backend,
        },
    }
}

/// Actual OS state, read back every time Settings asks.
#[tauri::command]
pub fn autostart_get(app: AppHandle) -> AutostartStatus {
    status(&app)
}

/// Enable or disable from an explicit user action, then read back what the OS has.
#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> AutostartStatus {
    let mut fields = serde_json::Map::new();
    fields.insert("enabled".into(), serde_json::json!(enabled));
    let result = write_registration(&app, enabled);
    if let Err(e) = &result {
        logging::error("autostart", "set", e);
    } else {
        logging::event(Level::Info, "autostart", "set", fields);
    }
    // The preference records the request; the read-back below reports reality.
    let _ = prefs::prefs_set(
        app.clone(),
        prefs::PrefsPatch {
            autostart: Some(enabled),
            ..Default::default()
        },
    );
    let mut current = status(&app);
    if let Err(e) = result {
        current.error = Some(e);
    }
    current
}

/// Make sure a non-test build never registers with a stale target: the
/// plugin registers the current executable, so after an installation-path
/// change an enabled registration is rewritten to point here.
pub fn refresh_target(app: &AppHandle) {
    if fake_path().is_some() {
        return;
    }
    if prefs::current(app).autostart {
        if let Ok(true) = read_registration(app) {
            if let Err(e) = write_registration(app, true) {
                logging::error("autostart", "refresh", &e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_background_argument_is_the_documented_one() {
        // The NSIS hook and the docs quote this value; a rename must be deliberate.
        assert_eq!(BACKGROUND_ARG, "--background");
        assert_eq!(APP_NAME, "Orbit");
    }
}
