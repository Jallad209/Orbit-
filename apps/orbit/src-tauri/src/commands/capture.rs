//! The system-wide quick-capture window: a small always-on-top window that
//! hosts the same CaptureBar as the inbox. Shown by the global shortcut or
//! a command, hidden by Escape or after a capture.

use tauri::{AppHandle, Emitter, Manager};

pub const CAPTURE_WINDOW: &str = "capture";

pub fn show(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(CAPTURE_WINDOW) {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("capture:open", ());
    }
}

#[tauri::command]
pub fn capture_show(app: AppHandle) {
    show(&app);
}

#[tauri::command]
pub fn capture_hide(app: AppHandle) {
    if let Some(win) = app.get_webview_window(CAPTURE_WINDOW) {
        let _ = win.hide();
    }
}
