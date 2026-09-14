//! The resident lifecycle coordinator (week 11). One place owns why the
//! process started, whether it is ready, what closing the main window
//! means, and how the process ends. A hidden main window is not a
//! headless app: the webview stays loaded, keeps the database open, and
//! keeps reconciling reminders; the native scheduler only delivers what the
//! frontend prepared, and only once the frontend has said the current
//! database generation is ready.
//!
//! | Event                                   | Result                                              |
//! | --------------------------------------- | --------------------------------------------------- |
//! | manual launch                           | main shows and focuses                              |
//! | `--background` (login launch)           | main stays hidden; readiness reported when it comes |
//! | `--capture` (second launch)             | the capture window opens                            |
//! | X, close-to-tray on, tray available     | main hides; nothing is torn down                    |
//! | X, first time                           | the explanation shows first                         |
//! | X, close-to-tray off or no tray         | orderly shutdown                                    |
//! | X before preferences settled            | main stays; the frontend explains startup is running|
//! | tray Quit                               | orderly shutdown regardless of the preference       |
//! | readiness never arrives (background)    | main is shown so the error is reachable             |

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Map};
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::autostart;
use crate::commands::capture;
use crate::commands::db::{Database, Db};
use crate::logging::{self, Level};
use crate::prefs;
use crate::scheduler;

pub const MAIN_WINDOW: &str = "main";
/// Argument a second launch may pass to open the capture window instead of the main one.
pub const CAPTURE_ARG: &str = "--capture";
/// A background launch that never becomes ready is surfaced after this long.
pub const READY_TIMEOUT: Duration = Duration::from_secs(30);
/// How long Quit waits for an owned database transaction to settle.
pub const SETTLE_DEADLINE: Duration = Duration::from_secs(10);

/// The window-state fields that are restored. Visibility is deliberately not one of them:
/// whether the main window shows is the launch policy's decision, never a saved value.
pub const WINDOW_STATE_FLAGS: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Booting,
    Ready,
    /// Ready once, but something the user must see happened (a quit that could not finish).
    Degraded,
    Quitting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Launch {
    Manual,
    Background,
    Capture,
}

impl Launch {
    /// Only these arguments mean anything; everything else is a manual launch.
    pub fn from_args<'a>(args: impl IntoIterator<Item = &'a str>) -> Launch {
        let mut launch = Launch::Manual;
        for arg in args {
            if arg == autostart::BACKGROUND_ARG {
                launch = Launch::Background;
            } else if arg == CAPTURE_ARG {
                return Launch::Capture;
            }
        }
        launch
    }
}

#[derive(Debug)]
pub struct Resident {
    pub phase: Phase,
    pub launch: Launch,
    pub tray_available: bool,
    pub tray_error: Option<String>,
    /// The database generation the main window acknowledged; `None` until the first handshake.
    pub ready_generation: Option<u64>,
    /// Navigation requests that arrived before the frontend was ready.
    pub queued_navigation: Vec<String>,
    /// Set once the orderly shutdown finished; only then is the run marked clean.
    pub clean_shutdown: bool,
    pub shutdown_error: Option<String>,
    /// The window-state plugin is registered (not in an isolated test run).
    pub window_state: bool,
}

impl Resident {
    pub fn new(launch: Launch) -> Self {
        Self {
            phase: Phase::Booting,
            launch,
            tray_available: false,
            tray_error: None,
            ready_generation: None,
            queued_navigation: Vec::new(),
            clean_shutdown: false,
            shutdown_error: None,
            window_state: false,
        }
    }
}

pub struct ResidentState(pub Mutex<Resident>);

/// What Settings and the shell bridge show. Truthful: the operational state, not a wish.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResidentStatus {
    pub phase: Phase,
    pub launch: Launch,
    pub tray_available: bool,
    pub tray_error: Option<String>,
    /// The preference as saved.
    pub close_to_tray: bool,
    /// The preference in effect: saved, and the tray exists to make it real.
    pub close_to_tray_effective: bool,
    /// The legacy flag has been transferred; a user close is safe to honour.
    pub close_resolved: bool,
    pub close_explanation_seen: bool,
    pub ready_generation: Option<u64>,
    pub generation: u64,
    pub shutdown_error: Option<String>,
    /// Whether the main window is currently shown (hidden to the tray otherwise).
    pub main_visible: bool,
}

fn with_resident<T>(app: &AppHandle, f: impl FnOnce(&mut Resident) -> T) -> Option<T> {
    let state = app.try_state::<ResidentState>()?;
    let mut guard = state.0.lock().ok()?;
    Some(f(&mut guard))
}

pub fn phase(app: &AppHandle) -> Phase {
    with_resident(app, |r| r.phase).unwrap_or(Phase::Booting)
}

pub fn status(app: &AppHandle) -> ResidentStatus {
    let prefs = prefs::current(app);
    let generation = app
        .try_state::<Db>()
        .and_then(|db| db.0.lock().ok().map(|g| g.generation))
        .unwrap_or(0);
    let (phase, launch, tray_available, tray_error, ready_generation, shutdown_error) =
        with_resident(app, |r| {
            (
                r.phase,
                r.launch,
                r.tray_available,
                r.tray_error.clone(),
                r.ready_generation,
                r.shutdown_error.clone(),
            )
        })
        .unwrap_or((Phase::Booting, Launch::Manual, false, None, None, None));
    ResidentStatus {
        phase,
        launch,
        tray_available,
        tray_error,
        close_to_tray: prefs.close_to_tray,
        close_to_tray_effective: prefs.close_to_tray && tray_available,
        close_resolved: prefs.legacy_close_migrated,
        close_explanation_seen: prefs.close_explanation_seen,
        ready_generation,
        generation,
        shutdown_error,
        main_visible: app
            .get_webview_window(MAIN_WINDOW)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false),
    }
}

/// Show, unminimize, and focus the existing main window. Never creates a second one.
pub fn show_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

pub fn hide_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
        let _ = main.hide();
    }
}

/// Apply the launch policy once the windows exist: manual shows, background stays hidden,
/// capture opens the capture window over a hidden main.
pub fn apply_launch_policy(app: &AppHandle) {
    let launch = with_resident(app, |r| r.launch).unwrap_or(Launch::Manual);
    let mut fields = Map::new();
    fields.insert("launch".into(), json!(launch));
    logging::event(Level::Info, "resident", "launch", fields);
    match launch {
        Launch::Manual => show_main(app),
        Launch::Background => {
            let handle = app.clone();
            thread::Builder::new()
                .name("orbit-ready-timeout".into())
                .spawn(move || {
                    thread::sleep(READY_TIMEOUT);
                    let ready =
                        with_resident(&handle, |r| r.ready_generation.is_some()).unwrap_or(true);
                    if !ready {
                        logging::event(Level::Warn, "resident", "ready-timeout", Map::new());
                        show_main(&handle);
                        let _ = handle.emit_to(MAIN_WINDOW, "orbit:ready-timeout", ());
                    }
                })
                .ok();
        }
        Launch::Capture => capture::show(app),
    }
}

/// A second process started: activate what its arguments ask for, nothing else.
/// Arbitrary URLs and commands are ignored. A duplicate login launch is left alone
/// so it cannot steal focus from whatever the user is doing.
pub fn on_second_instance(app: &AppHandle, args: &[String]) {
    let launch = Launch::from_args(args.iter().map(String::as_str));
    let mut fields = Map::new();
    fields.insert("launch".into(), json!(launch));
    logging::event(Level::Info, "resident", "second-instance", fields);
    match launch {
        Launch::Manual => show_main(app),
        Launch::Capture => capture::show(app),
        Launch::Background => {}
    }
}

/// Send the frontend somewhere, or hold the request until it is ready.
pub fn navigate(app: &AppHandle, path: &str) {
    if !path.starts_with('/') {
        return; // internal routes only
    }
    let ready = with_resident(app, |r| {
        if r.phase == Phase::Ready || r.phase == Phase::Degraded {
            true
        } else {
            r.queued_navigation.push(path.to_string());
            false
        }
    })
    .unwrap_or(false);
    if ready {
        let _ = app.emit_to(MAIN_WINDOW, "orbit:navigate", path);
    }
}

/// The main window finished opening the database, migrating settings and
/// preferences, and reconciling reminders for `generation`. Only the main
/// window may say so, and only for the generation that is actually open.
pub fn mark_ready(app: &AppHandle, window_label: &str, generation: u64) -> Result<(), String> {
    if window_label != MAIN_WINDOW {
        return Err("Only the main window reports readiness.".into());
    }
    let current = app
        .try_state::<Db>()
        .and_then(|db| db.0.lock().ok().map(|g| g.generation))
        .unwrap_or(0);
    if generation != current {
        return Err(format!(
            "Readiness for generation {generation} ignored: the data file is at {current}."
        ));
    }
    let queued = with_resident(app, |r| {
        if r.phase == Phase::Booting {
            r.phase = Phase::Ready;
        }
        r.ready_generation = Some(generation);
        std::mem::take(&mut r.queued_navigation)
    })
    .unwrap_or_default();
    let mut fields = Map::new();
    fields.insert("generation".into(), json!(generation));
    fields.insert("queuedNavigation".into(), json!(queued.len()));
    logging::event(Level::Info, "resident", "ready", fields);
    for path in queued {
        let _ = app.emit_to(MAIN_WINDOW, "orbit:navigate", path);
    }
    scheduler::wake(app);
    Ok(())
}

/// The scheduler delivers only for the generation the frontend prepared, and never
/// once shutdown has begun.
pub fn scheduler_may_run(app: &AppHandle, db: &Mutex<Database>) -> bool {
    let generation = match db.lock() {
        Ok(guard) => guard.generation,
        Err(_) => return false,
    };
    with_resident(app, |r| {
        r.phase != Phase::Quitting && r.ready_generation == Some(generation)
    })
    .unwrap_or(false)
}

/// The main window's X. Decides between hiding and quitting, or holds the
/// window when the decision cannot be made safely yet.
pub fn on_main_close_requested(app: &AppHandle) -> CloseDecision {
    if phase(app) == Phase::Quitting {
        return CloseDecision::Allow;
    }
    let prefs = prefs::current(app);
    let tray = with_resident(app, |r| r.tray_available).unwrap_or(false);
    let decision = decide_close(&prefs, tray);
    let mut fields = Map::new();
    fields.insert("decision".into(), json!(decision.name()));
    logging::event(Level::Info, "resident", "close-requested", fields);
    match decision {
        CloseDecision::Blocked => {
            let _ = app.emit_to(MAIN_WINDOW, "orbit:close-blocked", ());
        }
        CloseDecision::Explain => {
            let _ = app.emit_to(MAIN_WINDOW, "orbit:close-explain", ());
        }
        CloseDecision::Hide => hide_main(app),
        CloseDecision::Quit => request_quit(app),
        CloseDecision::Allow => {}
    }
    decision
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseDecision {
    /// Preferences have not settled: keep the window and say so.
    Blocked,
    /// First close-to-tray: show the explanation before hiding.
    Explain,
    Hide,
    Quit,
    /// Shutdown is already under way; let the window go.
    Allow,
}

impl CloseDecision {
    fn name(self) -> &'static str {
        match self {
            CloseDecision::Blocked => "blocked",
            CloseDecision::Explain => "explain",
            CloseDecision::Hide => "hide",
            CloseDecision::Quit => "quit",
            CloseDecision::Allow => "allow",
        }
    }
}

/// Pure policy, so it can be tested without windows.
pub fn decide_close(prefs: &prefs::DesktopPrefs, tray_available: bool) -> CloseDecision {
    if !prefs.legacy_close_migrated {
        return CloseDecision::Blocked;
    }
    if prefs.close_to_tray && tray_available {
        if !prefs.close_explanation_seen {
            return CloseDecision::Explain;
        }
        return CloseDecision::Hide;
    }
    CloseDecision::Quit
}

/// Orderly shutdown, off the event loop:
/// 1. enter Quitting (the frontend refuses new independent writes);
/// 2. stop the scheduler with a bounded join;
/// 3. let an owned transaction settle, bounded;
/// 4. close the process-owned database;
/// 5. save window state; mark the run clean; exit every window and the process.
///
/// If a write cannot settle or the file will not close, the app stays visible with the error.
pub fn request_quit(app: &AppHandle) {
    let already = with_resident(app, |r| {
        if r.phase == Phase::Quitting {
            true
        } else {
            r.phase = Phase::Quitting;
            r.shutdown_error = None;
            false
        }
    })
    .unwrap_or(true);
    if already {
        return;
    }
    let handle = app.clone();
    thread::Builder::new()
        .name("orbit-shutdown".into())
        .spawn(move || run_shutdown(&handle))
        .ok();
}

fn run_shutdown(app: &AppHandle) {
    logging::event(Level::Info, "resident", "quit", Map::new());
    // New independent writes are refused from here; owned transactions may finish.
    if let Some(db) = app.try_state::<Db>() {
        if let Ok(mut guard) = db.0.lock() {
            guard.quitting = true;
        }
    }
    let _ = app.emit("orbit:quitting", ());
    let stopped = scheduler::stop(app, scheduler::STOP_DEADLINE);
    if !stopped {
        logging::event(Level::Warn, "scheduler", "stop-timeout", Map::new());
    }
    if let Err(error) = close_database(app, SETTLE_DEADLINE) {
        logging::error("resident", "quit", &error);
        with_resident(app, |r| {
            r.phase = Phase::Degraded;
            r.shutdown_error = Some(error.clone());
        });
        // Writes are accepted again: the app keeps running until the user retries.
        if let Some(db) = app.try_state::<Db>() {
            if let Ok(mut guard) = db.0.lock() {
                guard.quitting = false;
            }
        }
        // The scheduler stopped; the app is still usable and the user can retry Quit.
        show_main(app);
        let _ = app.emit_to(MAIN_WINDOW, "orbit:quit-failed", error);
        return;
    }
    if with_resident(app, |r| r.window_state).unwrap_or(false) {
        let _ = app.save_window_state(WINDOW_STATE_FLAGS);
    }
    with_resident(app, |r| r.clean_shutdown = true);
    logging::event(Level::Info, "resident", "shutdown-complete", Map::new());
    app.exit(0);
}

/// Wait for any owned transaction to finish (or expire), then close the connection.
fn close_database(app: &AppHandle, settle: Duration) -> Result<(), String> {
    let Some(db) = app.try_state::<Db>() else {
        return Ok(());
    };
    let until = Instant::now() + settle;
    loop {
        let mut guard =
            db.0.lock()
                .map_err(|_| "database lock poisoned".to_string())?;
        if guard.is_idle() {
            if let Some(conn) = guard.connection.take() {
                if let Err((conn, error)) = conn.close() {
                    guard.connection = Some(conn);
                    return Err(format!("The data file could not be closed: {error}"));
                }
                logging::event(Level::Info, "db", "close", Map::new());
            }
            return Ok(());
        }
        drop(guard);
        if Instant::now() >= until {
            return Err(
                "Orbit is still saving data. Quit was cancelled so nothing is lost; try again in a moment."
                    .into(),
            );
        }
        thread::sleep(Duration::from_millis(100));
    }
}

/// Whether the run may be marked clean at `RunEvent::Exit`.
pub fn shutdown_was_clean(app: &AppHandle) -> bool {
    with_resident(app, |r| r.clean_shutdown).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn resident_status(app: AppHandle) -> ResidentStatus {
    status(&app)
}

#[tauri::command]
pub fn resident_ready(app: AppHandle, window: Window, generation: u64) -> Result<(), String> {
    mark_ready(&app, window.label(), generation)
}

#[tauri::command]
pub fn resident_show_main(app: AppHandle) {
    show_main(&app);
}

/// Hide after the explanation was acknowledged (the frontend records that it was seen).
#[tauri::command]
pub fn resident_hide_main(app: AppHandle) {
    hide_main(&app);
}

#[tauri::command]
pub fn resident_quit(app: AppHandle) {
    request_quit(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_reason_reads_only_the_allowlisted_arguments() {
        assert_eq!(Launch::from_args(["orbit.exe"]), Launch::Manual);
        assert_eq!(
            Launch::from_args(["orbit.exe", "--background"]),
            Launch::Background
        );
        assert_eq!(
            Launch::from_args(["orbit.exe", "--capture"]),
            Launch::Capture
        );
        assert_eq!(
            Launch::from_args(["orbit.exe", "--background", "--capture"]),
            Launch::Capture
        );
        assert_eq!(
            Launch::from_args(["orbit.exe", "https://evil.example/", "cmd /c format c:"]),
            Launch::Manual
        );
    }

    #[test]
    fn close_policy_matches_the_matrix() {
        let mut p = prefs::DesktopPrefs::default();
        assert_eq!(
            decide_close(&p, true),
            CloseDecision::Blocked,
            "unresolved legacy flag"
        );
        p.legacy_close_migrated = true;
        assert_eq!(
            decide_close(&p, true),
            CloseDecision::Explain,
            "first close explains"
        );
        p.close_explanation_seen = true;
        assert_eq!(decide_close(&p, true), CloseDecision::Hide);
        assert_eq!(
            decide_close(&p, false),
            CloseDecision::Quit,
            "no tray: close is a quit"
        );
        p.close_to_tray = false;
        assert_eq!(decide_close(&p, true), CloseDecision::Quit);
    }

    #[test]
    fn a_new_resident_boots_without_readiness_or_a_tray() {
        let r = Resident::new(Launch::Background);
        assert_eq!(r.phase, Phase::Booting);
        assert!(r.ready_generation.is_none());
        assert!(!r.tray_available);
        assert!(!r.clean_shutdown);
    }
}
