//! Orbit desktop shell. The web app runs unchanged inside a WebView; this
//! crate adds what a browser cannot do: a real data file (SQLite through
//! `commands::db`), a user-chosen data folder, native dialogs and
//! notifications, remembered window state, a system-wide quick-capture
//! shortcut, a reminder scheduler that delivers OS notifications, local
//! rolling logs with a diagnostics bundle (never telemetry), and — since
//! week 11 — a resident process: one instance, a tray, close-to-tray, and
//! opt-in login launch. No feature lives here that the engine could do in
//! TypeScript.

mod autostart;
mod commands;
mod logging;
mod prefs;
mod resident;
mod scheduler;
mod time;
mod tray;

use std::sync::Mutex;

use serde_json::{json, Map};
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use commands::db::{Database, Db};
use commands::diagnostics::LastRunState;
use logging::Level;
use prefs::PrefsState;
use resident::{Launch, Resident, ResidentState};
use scheduler::SchedulerState;

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

/// An isolated run (the desktop e2e harness pins `ORBIT_DATA_DIR`): no
/// single-instance registration, so a test can never activate the user's
/// running Orbit, and no window-state file in the user's profile.
fn isolated() -> bool {
    commands::data_dir::env_data_dir().is_some()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch = Launch::from_args(
        std::env::args()
            .skip(1)
            .collect::<Vec<_>>()
            .iter()
            .map(String::as_str),
    );
    let mut builder = tauri::Builder::default();
    // Single instance goes first: a second process must hand over before anything else
    // (logging, the shortcut, the database, the scheduler) is claimed.
    if !isolated() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            resident::on_second_instance(app, &args);
        }));
    }
    builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name(autostart::APP_NAME)
                .arg(autostart::BACKGROUND_ARG)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && *shortcut == capture_shortcut() {
                        commands::capture::show(app);
                    }
                })
                .build(),
        );
    if !isolated() {
        // Size, position, and maximized only: visibility is the launch policy's call.
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(resident::WINDOW_STATE_FLAGS)
                .build(),
        );
    }
    let app = builder
        .manage(Db(Mutex::new(Database::default())))
        .manage(LastRunState(Mutex::new(logging::LastRun::default())))
        .manage(PrefsState(Mutex::new(prefs::DesktopPrefs::default())))
        .manage(ResidentState(Mutex::new(Resident {
            window_state: !isolated(),
            ..Resident::new(launch)
        })))
        .manage(SchedulerState(Mutex::new(None)))
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
            let handle = app.handle().clone();
            // Native preferences and the tray come before the frontend mounts.
            prefs::load(&handle);
            autostart::refresh_target(&handle);
            match tray::build(&handle) {
                Ok(_tray) => {
                    if let Some(state) = handle.try_state::<ResidentState>() {
                        if let Ok(mut r) = state.0.lock() {
                            r.tray_available = true;
                        }
                    }
                    logging::event(Level::Info, "resident", "tray", Map::new());
                }
                Err(error) => {
                    // The main window stays reachable; close-to-tray is off for this run.
                    logging::error("resident", "tray", &error);
                    if let Some(state) = handle.try_state::<ResidentState>() {
                        if let Ok(mut r) = state.0.lock() {
                            r.tray_available = false;
                            r.tray_error = Some(error);
                        }
                    }
                }
            }
            // A failed registration (another app owns the chord) must not stop Orbit.
            if let Err(e) = app.global_shortcut().register(capture_shortcut()) {
                eprintln!("orbit: could not register quick-capture shortcut: {e}");
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_title("Orbit");
            }
            resident::apply_launch_policy(&handle);
            // `Db` is managed above; the scheduler skips ticks until the frontend reports ready.
            scheduler::start(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    resident::MAIN_WINDOW => {
                        if resident::on_main_close_requested(window.app_handle())
                            != resident::CloseDecision::Allow
                        {
                            api.prevent_close();
                        }
                    }
                    commands::capture::CAPTURE_WINDOW => {
                        // Closing the capture window hides it; it is reused, never recreated.
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
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
            prefs::prefs_get,
            prefs::prefs_set,
            prefs::prefs_migrate_legacy,
            autostart::autostart_get,
            autostart::autostart_set,
            resident::resident_status,
            resident::resident_ready,
            resident::resident_show_main,
            resident::resident_hide_main,
            resident::resident_quit,
            scheduler::scheduler_wake,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Orbit");
    app.run(|app, event| match event {
        // The last window went away without Quit (it should not: closes are intercepted).
        // Run the orderly shutdown instead of dying mid-write.
        RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            if resident::phase(app) != resident::Phase::Quitting {
                api.prevent_exit();
                resident::request_quit(app);
            }
        }
        RunEvent::Exit => {
            let clean = resident::shutdown_was_clean(app);
            let mut fields = Map::new();
            fields.insert("clean".into(), json!(clean));
            logging::event(Level::Info, "process", "exit", fields);
            // Only an orderly shutdown marks the run clean; anything else stays an unclean run.
            if clean {
                if let Some(logger) = logging::logger() {
                    logging::end_run(&logger.dir());
                }
            }
        }
        _ => {}
    });
}
