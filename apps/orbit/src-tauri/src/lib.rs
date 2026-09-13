//! Orbit desktop shell. The web app runs unchanged inside a WebView; this
//! crate adds what a browser cannot do: a real data file (SQLite through
//! `commands::db`), a user-chosen data folder, native dialogs and
//! notifications, remembered window state, and a system-wide quick-capture
//! shortcut. No feature lives here that the engine could do in TypeScript.

mod commands;

use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use commands::db::Db;

/// `Ctrl+Shift+Space` from anywhere opens the capture window.
fn capture_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .manage(Db(Mutex::new(None)))
        .setup(|app| {
            // A failed registration (another app owns the chord) must not stop Orbit.
            if let Err(e) = app.global_shortcut().register(capture_shortcut()) {
                eprintln!("orbit: could not register quick-capture shortcut: {e}");
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_title("Orbit");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db::db_open,
            commands::db::db_close,
            commands::db::db_execute,
            commands::db::db_select,
            commands::db::db_exec,
            commands::data_dir::data_dir_get,
            commands::data_dir::data_dir_set,
            commands::data_dir::data_dir_relocate,
            commands::data_dir::data_dir_default,
            commands::data_dir::data_dir_reveal,
            commands::data_dir::data_backups,
            commands::data_dir::data_quarantine,
            commands::data_dir::data_restore,
            commands::data_dir::file_read_text,
            commands::data_dir::file_write_text,
            commands::capture::capture_show,
            commands::capture::capture_hide,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Orbit");
}
