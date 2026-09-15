//! Native notifications with an activation payload (week 12). The
//! notification plugin forwards title and body only and hands the show
//! call to a background task, so it can neither attach a launch payload
//! nor report whether Windows accepted the toast. This module talks to the
//! WinRT toast API directly on Windows: it builds the toast XML with
//! `launch="orbit://reminder/<id>" activationType="protocol"`, so a click
//! starts (or activates, through single instance) Orbit with that URI
//! whether the process is running, hidden, or gone, and `show` returns
//! the immediate submission result. "Fired" then means "Windows accepted
//! the toast", never "the user saw it": Focus Assist and notification
//! settings can still hide it.
//!
//! Identity: the installed build registers `app.orbit.desktop` through the
//! installer's shortcut; a development run under `target/` uses
//! PowerShell's identity, exactly as the plugin does, and proves nothing
//! about the installed experience. Other platforms fall back to the plugin.

use tauri::AppHandle;

/// One toast: text plus the activation payload and the identity used to
/// collapse duplicates in the notification centre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Toast {
    pub title: String,
    pub body: String,
    /// The `orbit://` URI a click activates; only kind and id, never content.
    pub launch: Option<String>,
    /// A stable identity so a redelivered reminder replaces its earlier entry.
    pub tag: Option<String>,
    pub group: Option<String>,
}

/// XML-escape text for an attribute or element.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// The toast document. Pure, so the shape is testable without WinRT.
pub fn toast_xml(toast: &Toast) -> String {
    let launch = match &toast.launch {
        Some(uri) => format!(" launch=\"{}\" activationType=\"protocol\"", escape(uri)),
        None => String::new(),
    };
    let body = if toast.body.is_empty() {
        String::new()
    } else {
        format!("<text>{}</text>", escape(&toast.body))
    };
    format!(
        "<toast{launch}><visual><binding template=\"ToastGeneric\"><text>{}</text>{body}</binding></visual></toast>",
        escape(&toast.title)
    )
}

/// Tags and groups are short identifiers; Windows caps them, and a reminder id fits.
fn ident(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(64)
        .collect()
}

/// Whether this process is the installed build (the plugin's own heuristic).
#[cfg(windows)]
fn installed(app: &AppHandle) -> bool {
    let _ = app;
    let exe = match tauri::utils::platform::current_exe() {
        Ok(exe) => exe,
        Err(_) => return false,
    };
    let dir = exe
        .parent()
        .map(|d| d.display().to_string())
        .unwrap_or_default();
    let sep = std::path::MAIN_SEPARATOR;
    !(dir.ends_with(&format!("{sep}target{sep}debug"))
        || dir.ends_with(&format!("{sep}target{sep}release")))
}

/// Show the toast and report whether Windows accepted it. Synchronous: the
/// caller marks the reminder fired only on `Ok`.
#[cfg(windows)]
pub fn show(app: &AppHandle, toast: &Toast) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    const POWERSHELL_APP_ID: &str =
        "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
    let app_id = if installed(app) {
        app.config().identifier.clone()
    } else {
        POWERSHELL_APP_ID.to_string()
    };
    let document = XmlDocument::new().map_err(|e| e.to_string())?;
    document
        .LoadXml(&HSTRING::from(toast_xml(toast)))
        .map_err(|e| e.to_string())?;
    let notification =
        ToastNotification::CreateToastNotification(&document).map_err(|e| e.to_string())?;
    if let Some(tag) = &toast.tag {
        notification
            .SetTag(&HSTRING::from(ident(tag)))
            .map_err(|e| e.to_string())?;
    }
    if let Some(group) = &toast.group {
        notification
            .SetGroup(&HSTRING::from(ident(group)))
            .map_err(|e| e.to_string())?;
    }
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
        .map_err(|e| e.to_string())?;
    notifier.Show(&notification).map_err(|e| e.to_string())
}

/// Other platforms: the plugin, which cannot carry a launch payload or report submission.
#[cfg(not(windows))]
pub fn show(app: &AppHandle, toast: &Toast) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&toast.title)
        .body(&toast.body)
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toast_xml_carries_the_protocol_launch_and_escapes_text() {
        let xml = toast_xml(&Toast {
            title: "Rent <due> 2026-09-20".into(),
            body: "900 \"USD\" & more".into(),
            launch: Some("orbit://reminder/01a0a1b6-3ad4-7678-92cc-ae55e388b0a6".into()),
            tag: Some("01a0a1b6-3ad4-7678-92cc-ae55e388b0a6".into()),
            group: Some("orbit-reminders".into()),
        });
        assert!(xml.starts_with(
            "<toast launch=\"orbit://reminder/01a0a1b6-3ad4-7678-92cc-ae55e388b0a6\" activationType=\"protocol\">"
        ));
        assert!(xml.contains("<text>Rent &lt;due&gt; 2026-09-20</text>"));
        assert!(xml.contains("<text>900 &quot;USD&quot; &amp; more</text>"));
        assert!(!xml.contains('<') || xml.matches("<text>").count() == 2);
    }

    #[test]
    fn toast_xml_without_a_payload_or_body_stays_minimal() {
        let xml = toast_xml(&Toast {
            title: "Follow up".into(),
            body: String::new(),
            launch: None,
            tag: None,
            group: None,
        });
        assert_eq!(
            xml,
            "<toast><visual><binding template=\"ToastGeneric\"><text>Follow up</text></binding></visual></toast>"
        );
    }

    #[test]
    fn identifiers_are_reduced_to_safe_characters_and_bounded() {
        assert_eq!(ident("01a0-a1b6 <x>"), "01a0-a1b6x");
        assert_eq!(ident(&"a".repeat(100)).len(), 64);
        assert_eq!(escape("a\u{0007}b"), "ab");
    }
}
