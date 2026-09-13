//! Orbit desktop shell. The web app runs unchanged inside a WebView; this
//! crate adds what a browser cannot do: a real data file (SQLite through
//! `commands::db`), a user-chosen data folder, native dialogs and
//! notifications, remembered window state, a system-wide quick-capture
//! shortcut, a reminder scheduler that delivers OS notifications, and
//! local rolling logs with a diagnostics bundle (never telemetry). No
//! feature lives here that the engine could do in TypeScript.

mod commands;
mod logging;
mod scheduler;
mod time;

use std::sync::Mutex;

use serde_json::{json, Map};
use tauri::{Manager, RunEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use commands::db::{Database, Db};
use commands::diagnostics::LastRunState;
use logging::Level;

/// `Ctrl+Shift+Space` from anywhere opens the capture window.
fn capture_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

/// Where the rolling logs live: beside the data folder when `ORBIT_DATA_DIR`
/// points at a throwaway one (desktop e2e), else under the app's own data dir.
fn log_dir(app: &tauri::App) -> Option<std::path::PathBuf> {
    if let Some(data) = commands::data_dir::env_data_dir() {
        return Some(data.parent().unwrap_or(&data).join("logs"));
    }
    app.path().app_data_dir().ok().map(|d| d.join("logs"))
}

/// Quiet in release, verbose in development.
fn log_level() -> Level {
    if cfg!(debug_assertions) {
        Level::Debug
    } else {
        Level::Info
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && *shortcut == capture_shortcut() {
                        commands::capture::show(app);
                    }
                })
                .build(),
        )
        .manage(Db(Mutex::new(Database::default())))
        .manage(LastRunState(Mutex::new(logging::LastRun::default())))
        .setup(|app| {
            // Logs live under the app's own data folder, never the user's chosen one.
            if let Some(dir) = log_dir(app) {
                let version = app.package_info().version.to_string();
                let last = logging::begin_run(&dir, &version);
                if let Some(state) = app.try_state::<LastRunState>() {
                    if let Ok(mut slot) = state.0.lock() {
                        *slot = last.clone();
                    }
                }
                logging::init(dir.clone(), log_level());
                logging::install_panic_hook(dir);
                let mut fields = Map::new();
                fields.insert("version".into(), json!(version));
                fields.insert("debug".into(), json!(cfg!(debug_assertions)));
                fields.insert("crashedLastTime".into(), json!(last.crashed_last_time));
                logging::event(Level::Info, "process", "start", fields);
            }
            // A failed registration (another app owns the chord) must not stop Orbit.
            if let Err(e) = app.global_shortcut().register(capture_shortcut()) {
                eprintln!("orbit: could not register quick-capture shortcut: {e}");
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_title("Orbit");
            }
            // `Db` is managed above; the scheduler skips ticks until the file is open.
            scheduler::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db::db_open,
            commands::db::db_close,
            commands::db::db_execute,
            commands::db::db_select,
            commands::db::db_exec,
            commands::db::db_begin,
            commands::db::db_finish,
            commands::data_dir::data_dir_get,
            commands::data_dir::data_dir_set,
            commands::data_dir::data_dir_relocate,
            commands::data_dir::data_dir_default,
            commands::data_dir::data_dir_reveal,
            commands::data_dir::data_backups,
            commands::data_dir::data_quarantine,
            commands::data_dir::data_restore,
            commands::data_dir::data_restore_backup,
            commands::data_dir::file_read_text,
            commands::data_dir::file_write_text,
            commands::capture::capture_show,
            commands::capture::capture_hide,
            commands::diagnostics::diagnostics_last_run,
            commands::diagnostics::diagnostics_log,
            commands::diagnostics::diagnostics_export,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Orbit");
    app.run(|_app, event| {
        if let RunEvent::Exit = event {
            logging::event(Level::Info, "process", "exit", Map::new());
            if let Some(logger) = logging::logger() {
                logging::end_run(&logger.dir());
            }
        }
    });
}
