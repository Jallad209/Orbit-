//! The system tray (week 11): Orbit's presence while the main window is
//! hidden. Menu: Open Orbit, Quick Capture, Plan my day, Quit. Left click
//! activates the main window; right click opens the menu. Every action
//! reuses an existing window or flow; none creates a second window, a
//! second scheduler, or another shortcut registration. Creation can fail
//! (no shell tray, a broken icon); the caller then keeps the main window
//! reachable and disables close-to-tray for the run.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

use crate::commands::capture;
use crate::resident;

pub const TRAY_ID: &str = "orbit-tray";

const OPEN: &str = "tray-open";
const CAPTURE: &str = "tray-capture";
const PLAN: &str = "tray-plan";
const QUIT: &str = "tray-quit";

/// What a menu id means; pure so the routing is testable without a tray.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    Open,
    Capture,
    PlanMyDay,
    Quit,
}

pub fn action_for(id: &str) -> Option<TrayAction> {
    match id {
        OPEN => Some(TrayAction::Open),
        CAPTURE => Some(TrayAction::Capture),
        PLAN => Some(TrayAction::PlanMyDay),
        QUIT => Some(TrayAction::Quit),
        _ => None,
    }
}

pub fn perform(app: &AppHandle, action: TrayAction) {
    match action {
        TrayAction::Open => resident::show_main(app),
        TrayAction::Capture => capture::show(app),
        TrayAction::PlanMyDay => {
            // The existing Today planning flow, in proposal mode; nothing is accepted for the user.
            resident::show_main(app);
            resident::navigate(app, "/today?regenerate=1");
        }
        TrayAction::Quit => resident::request_quit(app, false),
    }
}

pub fn build(app: &AppHandle) -> Result<TrayIcon, String> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, OPEN, "Open Orbit", true, None::<&str>)
                .map_err(|e| e.to_string())?,
            &MenuItem::with_id(
                app,
                CAPTURE,
                "Quick Capture",
                true,
                Some("Ctrl+Shift+Space"),
            )
            .map_err(|e| e.to_string())?,
            &MenuItem::with_id(app, PLAN, "Plan my day", true, None::<&str>)
                .map_err(|e| e.to_string())?,
            &PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?,
            &MenuItem::with_id(app, QUIT, "Quit Orbit", true, None::<&str>)
                .map_err(|e| e.to_string())?,
        ],
    )
    .map_err(|e| e.to_string())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "no application icon is bundled".to_string())?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Orbit")
        .menu(&menu)
        // Right click opens the menu; left click is handled below.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Some(action) = action_for(event.id().as_ref()) {
                perform(app, action);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                resident::show_main(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_ids_route_to_the_four_actions_and_nothing_else() {
        assert_eq!(action_for("tray-open"), Some(TrayAction::Open));
        assert_eq!(action_for("tray-capture"), Some(TrayAction::Capture));
        assert_eq!(action_for("tray-plan"), Some(TrayAction::PlanMyDay));
        assert_eq!(action_for("tray-quit"), Some(TrayAction::Quit));
        assert_eq!(action_for("open"), None);
        assert_eq!(action_for(""), None);
    }
}
