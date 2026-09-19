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
//!
//! Activation (week 12): an `orbit://` argument — from a notification click,
//! the protocol handler, or a forwarded second launch — shows the main window
//! whatever the launch mode and hands the frontend the validated URI to
//! resolve behind its draft guard. It is queued until readiness, deduplicated
//! per delivery (not per record), and never creates another database owner.
//!
//! Quit preparation (week 12): before the database is closed, every live
//! window that holds drafts is asked to save or discard them and to
//! acknowledge with the request and generation ids. A refusal, a failed
//! save, or a missing acknowledgment cancels the quit and the app stays
//! reachable with the reason; only an explicit "discard and quit" skips
//! the step. An OS kill cannot be made transactional with an unsaved
//! textarea: only acknowledged saves survive forced termination.

use std::collections::HashMap;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Map};
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::activation::{self, Activation, Dedup};
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
/// How long Quit waits for every window to save or discard its drafts.
pub const PREPARE_DEADLINE: Duration = Duration::from_secs(20);
/// The capture window's label (`tauri.conf.json`).
pub const CAPTURE_WINDOW: &str = "capture";

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
    /// Started to open a record (a notification click, the protocol handler): main shows.
    Activate,
}

impl Launch {
    /// Only these arguments mean anything; everything else is a manual launch. An
    /// activation URI wins over `--background`: a click is an explicit request to look.
    pub fn from_args<'a>(args: impl IntoIterator<Item = &'a str>) -> Launch {
        let mut launch = Launch::Manual;
        for arg in args {
            if activation::parse(arg).is_some() {
                return Launch::Activate;
            }
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
    /// The capture window's bridge is listening for quit preparation.
    pub capture_subscribed: bool,
    /// The quit preparation in flight, if any.
    pub quit_request: Option<QuitRequest>,
    /// Activations that arrived before the frontend was ready (canonical URIs).
    pub queued_activation: Vec<String>,
    /// The main window's bridge is listening for `orbit:activate`; an activation is
    /// delivered only once this is true, so the emit can never precede the listener.
    pub activation_subscribed: bool,
    /// Changes whenever the renderer attaches or detaches its activation listener.
    /// An emit may clear the queue only if the same subscription is still current.
    pub activation_subscription_generation: u64,
    /// Prevent two shell threads from selecting and emitting the same queued click.
    pub activation_emitting: bool,
    /// Collapses one click delivered through more than one API.
    pub dedup: Dedup,
}

/// One quit preparation: which windows must answer, and what they said.
#[derive(Debug, Clone)]
pub struct QuitRequest {
    pub id: u64,
    pub generation: u64,
    /// Windows that must answer; empty for a forced quit.
    pub awaiting: Vec<String>,
    pub acks: HashMap<String, QuitAck>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuitAck {
    pub ok: bool,
    pub reason: Option<String>,
}

/// What preparation concluded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Prepared {
    Proceed,
    Cancelled { window: String, reason: String },
}

impl QuitRequest {
    /// Every asked window answered.
    pub fn complete(&self) -> bool {
        self.awaiting.iter().all(|w| self.acks.contains_key(w))
    }

    /// The verdict so far: a refusal decides at once; otherwise wait for the rest.
    pub fn verdict(&self, timed_out: bool) -> Option<Prepared> {
        for (window, ack) in &self.acks {
            if !ack.ok {
                return Some(Prepared::Cancelled {
                    window: window.clone(),
                    reason: ack
                        .reason
                        .clone()
                        .unwrap_or_else(|| "A window has unsaved changes.".into()),
                });
            }
        }
        if self.complete() {
            return Some(Prepared::Proceed);
        }
        if timed_out {
            let missing = self
                .awaiting
                .iter()
                .find(|w| !self.acks.contains_key(*w))
                .cloned()
                .unwrap_or_else(|| "timeout".into());
            return Some(Prepared::Cancelled {
                window: "timeout".into(),
                reason: format!(
                    "Orbit could not confirm that the {missing} window saved its changes. Nothing was lost; try again or discard them."
                ),
            });
        }
        None
    }

    /// Record an answer; stale ids and unexpected windows are ignored.
    pub fn record(&mut self, window: &str, id: u64, generation: u64, ack: QuitAck) -> bool {
        if id != self.id
            || generation != self.generation
            || !self.awaiting.iter().any(|w| w == window)
        {
            return false;
        }
        self.acks.insert(window.to_string(), ack);
        true
    }
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
            capture_subscribed: false,
            quit_request: None,
            queued_activation: Vec::new(),
            activation_subscribed: false,
            activation_subscription_generation: 0,
            activation_emitting: false,
            dedup: Dedup::default(),
        }
    }
}

/// Which windows a quit must hear from: the main window once it reported readiness for
/// the open generation, the capture window once its bridge subscribed. A window that
/// never got that far holds nothing to save.
pub fn windows_to_ask(resident: &Resident, generation: u64) -> Vec<String> {
    let mut out = Vec::new();
    if resident.ready_generation == Some(generation) {
        out.push(MAIN_WINDOW.to_string());
    }
    if resident.capture_subscribed {
        out.push(CAPTURE_WINDOW.to_string());
    }
    out
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
    /// Who owns `orbit://` for this user: what a notification click will actually reach.
    pub protocol_handler: crate::protocol::ProtocolHandler,
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
        protocol_handler: crate::protocol::status(),
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
/// capture opens the capture window over a hidden main, an activation shows main and
/// queues the record to open.
pub fn apply_launch_policy(app: &AppHandle) {
    let launch = with_resident(app, |r| r.launch).unwrap_or(Launch::Manual);
    let mut fields = Map::new();
    fields.insert("launch".into(), json!(launch));
    logging::event(Level::Info, "resident", "launch", fields);
    match launch {
        Launch::Manual => show_main(app),
        Launch::Activate => {
            show_main(app);
            let args: Vec<String> = std::env::args().skip(1).collect();
            if let Some(a) = activation::from_args(args.iter().map(String::as_str)) {
                activate(app, a);
            }
        }
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
/// so it cannot steal focus from whatever the user is doing. An `orbit://` argument
/// (a notification click while Orbit runs, hidden or not) shows the main window and
/// opens the record; the second process itself hands over and exits.
pub fn on_second_instance(app: &AppHandle, args: &[String]) {
    let launch = Launch::from_args(args.iter().map(String::as_str));
    let mut fields = Map::new();
    fields.insert("launch".into(), json!(launch));
    logging::event(Level::Info, "resident", "second-instance", fields);
    match launch {
        Launch::Manual => show_main(app),
        Launch::Capture => capture::show(app),
        Launch::Background => {}
        Launch::Activate => {
            show_main(app);
            if let Some(a) = activation::from_args(args.iter().map(String::as_str)) {
                activate(app, a);
            }
        }
    }
}

/// Whether a queued activation may be delivered now: the database is open (so the
/// frontend can resolve the record) and the main window's bridge has confirmed its
/// `orbit:activate` listener is attached. Both are required, which is what removes the
/// startup race — the emit can never precede the listener.
pub fn can_flush(phase: Phase, activation_subscribed: bool, queued: usize) -> bool {
    queued > 0 && activation_subscribed && matches!(phase, Phase::Ready | Phase::Degraded)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActivationEmit {
    uri: String,
    queued: usize,
    subscription_generation: u64,
}

fn begin_activation_emit(resident: &mut Resident) -> Option<ActivationEmit> {
    if resident.activation_emitting
        || !can_flush(
            resident.phase,
            resident.activation_subscribed,
            resident.queued_activation.len(),
        )
    {
        return None;
    }
    resident.activation_emitting = true;
    Some(ActivationEmit {
        uri: resident.queued_activation.last()?.clone(),
        queued: resident.queued_activation.len(),
        subscription_generation: resident.activation_subscription_generation,
    })
}

/// Finish one synchronous Tauri emit. The selected queue entries are removed only when
/// delivery succeeded and the same renderer subscription is still current. Newer clicks
/// appended during the emit remain queued and are delivered by the next pass.
fn finish_activation_emit(resident: &mut Resident, attempt: &ActivationEmit, delivered: bool) {
    let same_listener = resident.activation_subscribed
        && resident.activation_subscription_generation == attempt.subscription_generation;
    if delivered && same_listener {
        let delivered_entries = attempt.queued.min(resident.queued_activation.len());
        resident.queued_activation.drain(..delivered_entries);
    } else if !delivered
        && resident.activation_subscription_generation == attempt.subscription_generation
    {
        // Require a fresh listener handshake before retrying a failed native emit.
        resident.activation_subscribed = false;
        resident.activation_subscription_generation =
            resident.activation_subscription_generation.wrapping_add(1);
    }
    resident.activation_emitting = false;
}

/// Remove a renderer subscription only when the caller still owns the current
/// generation. A delayed cleanup from an older renderer must not disable the
/// listener installed by a newer reload.
fn unsubscribe_activation(resident: &mut Resident, subscription_generation: u64) -> bool {
    if resident.activation_subscribed
        && resident.activation_subscription_generation == subscription_generation
    {
        resident.activation_subscription_generation =
            resident.activation_subscription_generation.wrapping_add(1);
        resident.activation_subscribed = false;
        true
    } else {
        false
    }
}

/// Deliver the latest queued activation to the main window if it may be delivered now,
/// clearing the queue. The last click wins when several queued up: one record opens,
/// not a cascade. A no-op until both readiness and subscription hold, so it is safe to
/// call from `activate`, `mark_ready`, and the subscribe command alike.
pub fn flush_activation(app: &AppHandle) {
    loop {
        let attempt = with_resident(app, begin_activation_emit).flatten();
        let Some(attempt) = attempt else {
            break;
        };
        let delivered = app
            .emit_to(MAIN_WINDOW, "orbit:activate", attempt.uri.clone())
            .is_ok();
        let retry = with_resident(app, |resident| {
            finish_activation_emit(resident, &attempt, delivered);
            can_flush(
                resident.phase,
                resident.activation_subscribed,
                resident.queued_activation.len(),
            )
        })
        .unwrap_or(false);
        if !delivered {
            logging::event(
                Level::Warn,
                "resident",
                "activation-emit-failed",
                Map::new(),
            );
        }
        if !retry {
            break;
        }
    }
}

/// Hold a validated activation for delivery. Only the kind is logged. A duplicate
/// delivery of the same click is dropped; a later click on the same record goes
/// through. It is queued and then flushed: nothing is emitted until the main window
/// has both opened the database and confirmed its listener (see `flush_activation`).
pub fn activate(app: &AppHandle, activation: Activation) {
    let now = Instant::now();
    let queued = with_resident(app, |r| {
        if !r.dedup.accept(&activation.uri, now) {
            return false;
        }
        r.queued_activation.push(activation.uri.clone());
        true
    })
    .unwrap_or(false);
    let mut fields = Map::new();
    fields.insert("kind".into(), json!(activation.kind));
    if queued {
        logging::event(Level::Info, "resident", "activate", fields);
        flush_activation(app);
    } else {
        fields.insert("duplicate".into(), json!(true));
        logging::event(Level::Debug, "resident", "activate", fields);
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
    let (queued, queued_activation) = with_resident(app, |r| {
        if r.phase == Phase::Booting {
            r.phase = Phase::Ready;
        }
        r.ready_generation = Some(generation);
        (
            std::mem::take(&mut r.queued_navigation),
            r.queued_activation.len(),
        )
    })
    .unwrap_or_default();
    let mut fields = Map::new();
    fields.insert("generation".into(), json!(generation));
    fields.insert("queuedNavigation".into(), json!(queued.len()));
    fields.insert("queuedActivation".into(), json!(queued_activation));
    logging::event(Level::Info, "resident", "ready", fields);
    for path in queued {
        let _ = app.emit_to(MAIN_WINDOW, "orbit:navigate", path);
    }
    // Readiness is one of the two gates for delivery; the last queued click is emitted
    // here only if the main window has also subscribed (else its subscribe call does it).
    flush_activation(app);
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
        CloseDecision::Quit => request_quit(app, false),
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
/// 0. ask every live window to save or discard its drafts and wait for the acknowledgments
///    (skipped with `force`); a refusal or a missing answer cancels;
/// 1. enter Quitting (the frontend refuses new independent writes);
/// 2. stop the scheduler with a bounded join;
/// 3. let an owned transaction settle, bounded;
/// 4. close the process-owned database;
/// 5. save window state; mark the run clean; exit every window and the process.
///
/// If a write cannot settle or the file will not close, the app stays visible with the error.
pub fn request_quit(app: &AppHandle, force: bool) {
    let generation = app
        .try_state::<Db>()
        .and_then(|db| db.0.lock().ok().map(|g| g.generation))
        .unwrap_or(0);
    let request = with_resident(app, |r| {
        if r.phase == Phase::Quitting {
            return None;
        }
        r.phase = Phase::Quitting;
        r.shutdown_error = None;
        let id = r.quit_request.as_ref().map(|q| q.id + 1).unwrap_or(1);
        let awaiting = if force {
            Vec::new()
        } else {
            windows_to_ask(r, generation)
        };
        let request = QuitRequest {
            id,
            generation,
            awaiting,
            acks: HashMap::new(),
        };
        r.quit_request = Some(request.clone());
        Some(request)
    })
    .flatten();
    let Some(request) = request else {
        return;
    };
    let handle = app.clone();
    thread::Builder::new()
        .name("orbit-shutdown".into())
        .spawn(move || {
            if let Prepared::Cancelled { window, reason } = prepare_quit(&handle, &request) {
                cancel_quit(&handle, &window, &reason);
                return;
            }
            run_shutdown(&handle);
        })
        .ok();
}

/// Ask the windows and wait, bounded, for their answers.
fn prepare_quit(app: &AppHandle, request: &QuitRequest) -> Prepared {
    if request.awaiting.is_empty() {
        return Prepared::Proceed;
    }
    let mut fields = Map::new();
    fields.insert("windows".into(), json!(request.awaiting.len()));
    logging::event(Level::Info, "resident", "quit-prepare", fields);
    let payload = json!({ "requestId": request.id, "generation": request.generation });
    for window in &request.awaiting {
        let _ = app.emit_to(window.as_str(), "orbit:quit-prepare", payload.clone());
    }
    let until = Instant::now() + PREPARE_DEADLINE;
    loop {
        let timed_out = Instant::now() >= until;
        let verdict = with_resident(app, |r| {
            r.quit_request
                .as_ref()
                .filter(|q| q.id == request.id)
                .and_then(|q| q.verdict(timed_out))
        })
        .flatten();
        if let Some(v) = verdict {
            return v;
        }
        if timed_out {
            return Prepared::Cancelled {
                window: "timeout".into(),
                reason: "Orbit could not confirm that your changes were saved.".into(),
            };
        }
        thread::sleep(Duration::from_millis(50));
    }
}

/// A window said no (or nothing): back to Ready, visible, with the reason.
fn cancel_quit(app: &AppHandle, window: &str, reason: &str) {
    let mut fields = Map::new();
    fields.insert("window".into(), json!(window));
    logging::event(Level::Warn, "resident", "quit-cancelled", fields);
    with_resident(app, |r| {
        r.phase = if r.ready_generation.is_some() {
            Phase::Ready
        } else {
            Phase::Booting
        };
        r.quit_request = None;
    });
    show_main(app);
    let _ = app.emit_to(
        MAIN_WINDOW,
        "orbit:quit-cancelled",
        json!({ "reason": reason, "window": window }),
    );
}

/// A window's answer to the preparation request. Stale or unexpected answers are ignored.
pub fn ack_quit(
    app: &AppHandle,
    window_label: &str,
    id: u64,
    generation: u64,
    ok: bool,
    reason: Option<String>,
) -> bool {
    with_resident(app, |r| {
        r.quit_request
            .as_mut()
            .map(|q| q.record(window_label, id, generation, QuitAck { ok, reason }))
            .unwrap_or(false)
    })
    .unwrap_or(false)
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
pub fn resident_quit(app: AppHandle, force: Option<bool>) {
    request_quit(&app, force.unwrap_or(false));
}

#[tauri::command]
pub fn resident_quit_ack(
    app: AppHandle,
    window: Window,
    request_id: u64,
    generation: u64,
    ok: bool,
    reason: Option<String>,
) {
    ack_quit(&app, window.label(), request_id, generation, ok, reason);
}

/// Whether an activation is still held for readiness (the frontend need not poll: the
/// shell emits it on readiness; this exists for Settings and tests).
#[tauri::command]
pub fn resident_activation_pending(app: AppHandle) -> usize {
    with_resident(&app, |r| r.queued_activation.len()).unwrap_or(0)
}

/// The capture window's bridge is listening: quits wait for its answer from now on.
#[tauri::command]
pub fn resident_capture_subscribed(app: AppHandle, window: Window) -> Result<(), String> {
    if window.label() != CAPTURE_WINDOW {
        return Err("Only the capture window subscribes here.".into());
    }
    with_resident(&app, |r| r.capture_subscribed = true);
    Ok(())
}

/// The main window's bridge attached its `orbit:activate` listener: any activation held
/// for it may now be delivered. This is the second half of the delivery gate (the first
/// is database readiness), so an activation that arrived — or completed readiness —
/// before the listener existed is delivered here instead of being lost.
#[tauri::command]
pub fn resident_activation_subscribed(app: AppHandle, window: Window) -> Result<u64, String> {
    if window.label() != MAIN_WINDOW {
        return Err("Only the main window subscribes here.".into());
    }
    let subscription_generation = with_resident(&app, |r| {
        r.activation_subscription_generation = r.activation_subscription_generation.wrapping_add(1);
        r.activation_subscribed = true;
        r.activation_subscription_generation
    })
    .ok_or_else(|| "Resident state is unavailable.".to_string())?;
    flush_activation(&app);
    Ok(subscription_generation)
}

/// The main renderer removed its activation listener (for example during a reload). Any
/// in-progress emit tied to that subscription stays queued and a later subscription retries it.
#[tauri::command]
pub fn resident_activation_unsubscribed(
    app: AppHandle,
    window: Window,
    subscription_generation: u64,
) -> Result<(), String> {
    if window.label() != MAIN_WINDOW {
        return Err("Only the main window unsubscribes here.".into());
    }
    with_resident(&app, |r| {
        unsubscribe_activation(r, subscription_generation);
    })
    .ok_or_else(|| "Resident state is unavailable.".to_string())?;
    Ok(())
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
        // An activation wins over a background launch: a click is a request to look.
        assert_eq!(
            Launch::from_args([
                "orbit.exe",
                "--background",
                "orbit://reminder/01a0a1b6-3ad4-7678-92cc-ae55e388b0a6"
            ]),
            Launch::Activate
        );
        assert_eq!(
            Launch::from_args([
                "orbit.exe",
                "orbit://evil/01a0a1b6-3ad4-7678-92cc-ae55e388b0a6"
            ]),
            Launch::Manual
        );
    }

    #[test]
    fn an_activation_is_delivered_only_when_ready_and_subscribed() {
        // Nothing queued: never.
        assert!(!can_flush(Phase::Ready, true, 0));
        // Queued but a gate is missing.
        assert!(
            !can_flush(Phase::Booting, true, 1),
            "database not ready yet"
        );
        assert!(
            !can_flush(Phase::Ready, false, 1),
            "listener not attached yet"
        );
        assert!(!can_flush(Phase::Quitting, true, 1), "shutting down");
        // Both gates held: deliver. Degraded still shows the record.
        assert!(can_flush(Phase::Ready, true, 1));
        assert!(can_flush(Phase::Degraded, true, 2));
    }

    #[test]
    fn activation_delivery_clears_only_the_selected_entries_after_a_success() {
        let mut resident = Resident::new(Launch::Manual);
        resident.phase = Phase::Ready;
        resident.activation_subscribed = true;
        resident.activation_subscription_generation = 7;
        resident.queued_activation = vec!["orbit://task/one".into(), "orbit://task/two".into()];

        let attempt = begin_activation_emit(&mut resident).expect("ready delivery");
        assert_eq!(attempt.uri, "orbit://task/two");
        assert!(resident.activation_emitting);
        // A later click is not part of the selected batch and must survive its delivery.
        resident.queued_activation.push("orbit://task/three".into());
        finish_activation_emit(&mut resident, &attempt, true);

        assert_eq!(resident.queued_activation, ["orbit://task/three"]);
        assert!(!resident.activation_emitting);
        assert!(resident.activation_subscribed);
    }

    #[test]
    fn failed_or_stale_activation_delivery_stays_queued_for_a_fresh_listener() {
        let mut resident = Resident::new(Launch::Manual);
        resident.phase = Phase::Ready;
        resident.activation_subscribed = true;
        resident.activation_subscription_generation = 3;
        resident.queued_activation = vec!["orbit://bill/one".into()];

        let failed = begin_activation_emit(&mut resident).expect("ready delivery");
        finish_activation_emit(&mut resident, &failed, false);
        assert_eq!(resident.queued_activation, ["orbit://bill/one"]);
        assert!(!resident.activation_subscribed);

        resident.activation_subscribed = true;
        resident.activation_subscription_generation += 1;
        let stale = begin_activation_emit(&mut resident).expect("retry delivery");
        // The renderer reloads while the native emit is in flight.
        resident.activation_subscribed = false;
        resident.activation_subscription_generation += 1;
        finish_activation_emit(&mut resident, &stale, true);
        assert_eq!(resident.queued_activation, ["orbit://bill/one"]);
        assert!(!resident.activation_emitting);

        resident.activation_subscribed = true;
        let superseded = begin_activation_emit(&mut resident).expect("new delivery");
        resident.activation_subscription_generation += 1;
        resident.activation_subscribed = true;
        finish_activation_emit(&mut resident, &superseded, false);
        assert!(
            resident.activation_subscribed,
            "do not disable the newer listener"
        );
        assert_eq!(resident.queued_activation, ["orbit://bill/one"]);
    }

    #[test]
    fn delayed_unsubscribe_cannot_disable_a_newer_activation_listener() {
        let mut resident = Resident::new(Launch::Manual);
        resident.activation_subscribed = true;
        resident.activation_subscription_generation = 12;

        assert!(!unsubscribe_activation(&mut resident, 11));
        assert!(resident.activation_subscribed);
        assert_eq!(resident.activation_subscription_generation, 12);

        assert!(unsubscribe_activation(&mut resident, 12));
        assert!(!resident.activation_subscribed);
        assert_eq!(resident.activation_subscription_generation, 13);
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
        assert!(r.quit_request.is_none());
    }

    #[test]
    fn quit_asks_only_the_windows_that_can_hold_drafts() {
        let mut r = Resident::new(Launch::Manual);
        assert!(
            windows_to_ask(&r, 1).is_empty(),
            "nothing loaded: nothing to save"
        );
        r.ready_generation = Some(1);
        assert_eq!(windows_to_ask(&r, 1), vec!["main"]);
        assert!(
            windows_to_ask(&r, 2).is_empty(),
            "a stale generation holds no drafts"
        );
        r.capture_subscribed = true;
        assert_eq!(windows_to_ask(&r, 1), vec!["main", "capture"]);
    }

    fn request() -> QuitRequest {
        QuitRequest {
            id: 7,
            generation: 3,
            awaiting: vec!["main".into(), "capture".into()],
            acks: HashMap::new(),
        }
    }

    #[test]
    fn quit_proceeds_only_when_every_window_acknowledged() {
        let mut q = request();
        assert_eq!(q.verdict(false), None);
        assert!(q.record(
            "main",
            7,
            3,
            QuitAck {
                ok: true,
                reason: None
            }
        ));
        assert_eq!(
            q.verdict(false),
            None,
            "the capture window has not answered"
        );
        assert!(q.record(
            "capture",
            7,
            3,
            QuitAck {
                ok: true,
                reason: None
            }
        ));
        assert_eq!(q.verdict(false), Some(Prepared::Proceed));
    }

    #[test]
    fn a_refusal_or_a_missing_answer_cancels_with_the_reason() {
        let mut q = request();
        assert!(q.record(
            "capture",
            7,
            3,
            QuitAck {
                ok: false,
                reason: Some("The quick capture window still holds text.".into())
            }
        ));
        assert_eq!(
            q.verdict(false),
            Some(Prepared::Cancelled {
                window: "capture".into(),
                reason: "The quick capture window still holds text.".into()
            })
        );
        let q = request();
        match q.verdict(true) {
            Some(Prepared::Cancelled { window, reason }) => {
                assert_eq!(window, "timeout");
                assert!(reason.contains("main window"));
            }
            other => panic!("expected a timeout cancellation, got {other:?}"),
        }
    }

    #[test]
    fn stale_or_foreign_acknowledgments_are_ignored() {
        let mut q = request();
        assert!(
            !q.record(
                "main",
                6,
                3,
                QuitAck {
                    ok: true,
                    reason: None
                }
            ),
            "old request id"
        );
        assert!(
            !q.record(
                "main",
                7,
                2,
                QuitAck {
                    ok: true,
                    reason: None
                }
            ),
            "old generation"
        );
        assert!(
            !q.record(
                "settings",
                7,
                3,
                QuitAck {
                    ok: true,
                    reason: None
                }
            ),
            "unknown window"
        );
        assert!(q.acks.is_empty());
    }
}
