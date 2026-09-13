//! Local, structured logs and the last-run marker. One JSON object per
//! line, in `logs/` under the app's data directory; a new file every day
//! and whenever the current one reaches 10 MB, the seven newest kept.
//! Nothing here leaves the machine, and nothing a person wrote is written:
//! every string field is redacted and truncated before it lands, and the
//! panic hook records a location and a redacted message, never a payload.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::time::now_iso;

pub const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
pub const KEEP_FILES: usize = 7;
pub const LOG_PREFIX: &str = "orbit-";
pub const LAST_RUN_FILE: &str = "last-run.json";
/// Longest string a log field may carry after redaction.
const MAX_FIELD_CHARS: usize = 80;
/// Longest a panic message is kept.
const MAX_MESSAGE_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Debug => "debug",
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Error => "error",
        }
    }

    /// Unknown levels count as `info`, so a typo never silences or shouts.
    pub fn parse(s: &str) -> Level {
        match s {
            "debug" => Level::Debug,
            "warn" | "warning" => Level::Warn,
            "error" => Level::Error,
            _ => Level::Info,
        }
    }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/// Drop anything quoted (that is where record text ends up in error
/// messages), collapse whitespace, and cut to `max` characters.
pub fn redact(text: &str, max: usize) -> String {
    let mut out = String::with_capacity(text.len().min(max));
    let mut quote: Option<char> = None;
    for ch in text.chars() {
        match quote {
            Some(open) => {
                let closes = match open {
                    '"' => ch == '"',
                    '\'' => ch == '\'',
                    '“' => ch == '”',
                    '‘' => ch == '’',
                    '`' => ch == '`',
                    _ => false,
                };
                if closes {
                    out.push('…');
                    out.push(ch);
                    quote = None;
                }
            }
            None => {
                if matches!(ch, '"' | '\'' | '“' | '‘' | '`') {
                    quote = Some(ch);
                    out.push(ch);
                } else {
                    out.push(ch);
                }
            }
        }
    }
    if quote.is_some() {
        out.push('…');
    }
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > max {
        let cut: String = collapsed.chars().take(max).collect();
        format!("{cut}…")
    } else {
        collapsed
    }
}

/// Numbers and flags pass; strings are redacted and shortened; anything
/// nested is dropped. Keys are trimmed to something sensible.
pub fn sanitize_fields(fields: Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for (key, value) in fields {
        let key: String = key.chars().take(48).collect();
        match value {
            Value::Number(_) | Value::Bool(_) => {
                out.insert(key, value);
            }
            Value::String(s) => {
                out.insert(key, Value::String(redact(&s, MAX_FIELD_CHARS)));
            }
            _ => {}
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Rolling files
// ---------------------------------------------------------------------------

pub fn file_name(date: &str, index: u32) -> String {
    format!("{LOG_PREFIX}{date}.{index:03}.log")
}

pub fn is_log_file(name: &str) -> bool {
    name.starts_with(LOG_PREFIX) && name.ends_with(".log")
}

/// Every log file in `dir`, oldest first (names sort chronologically); none when the folder is missing.
pub fn log_files(dir: &Path) -> io::Result<Vec<PathBuf>> {
    let mut names: Vec<String> = match fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| is_log_file(n))
            .collect(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e),
    };
    names.sort();
    Ok(names.into_iter().map(|n| dir.join(n)).collect())
}

struct Current {
    date: String,
    index: u32,
    file: File,
    size: u64,
}

/// Appends lines to `orbit-<date>.<n>.log`, starting a new file when the
/// day changes or the cap is reached, and deleting the oldest beyond `keep`.
pub struct RollingWriter {
    dir: PathBuf,
    max_bytes: u64,
    keep: usize,
    current: Option<Current>,
}

impl RollingWriter {
    pub fn new(dir: PathBuf, max_bytes: u64, keep: usize) -> Self {
        Self {
            dir,
            max_bytes,
            keep,
            current: None,
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Every log file in the folder, oldest first (names sort chronologically).
    pub fn files(&self) -> io::Result<Vec<PathBuf>> {
        log_files(&self.dir)
    }

    pub fn write_line(&mut self, date: &str, line: &str) -> io::Result<()> {
        let bytes = line.len() as u64 + 1;
        let rotate = match &self.current {
            None => true,
            Some(c) => c.date != date || c.size + bytes > self.max_bytes,
        };
        if rotate {
            self.open_next(date)?;
        }
        let current = self.current.as_mut().expect("opened above");
        current.file.write_all(line.as_bytes())?;
        current.file.write_all(b"\n")?;
        current.size += bytes;
        Ok(())
    }

    fn open_next(&mut self, date: &str) -> io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        // Continue today's newest file when it still has room (a restart
        // must not start a new file every time); otherwise take the next index.
        let mut index = 0u32;
        if let Some(c) = &self.current {
            if c.date == date {
                index = c.index + 1;
            }
        } else {
            let prefix = format!("{LOG_PREFIX}{date}.");
            for path in self.files()? {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if let Some(rest) = name.strip_prefix(&prefix) {
                    if let Some(n) = rest
                        .strip_suffix(".log")
                        .and_then(|n| n.parse::<u32>().ok())
                    {
                        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(u64::MAX);
                        index = if size < self.max_bytes { n } else { n + 1 };
                    }
                }
            }
        }
        let path = self.dir.join(file_name(date, index));
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        self.current = Some(Current {
            date: date.to_string(),
            index,
            file,
            size,
        });
        self.prune()
    }

    /// Delete every log file beyond the newest `keep`.
    pub fn prune(&self) -> io::Result<()> {
        let files = self.files()?;
        if files.len() > self.keep {
            for old in &files[..files.len() - self.keep] {
                let _ = fs::remove_file(old);
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// The process logger
// ---------------------------------------------------------------------------

pub struct Logger {
    min: Level,
    writer: Mutex<RollingWriter>,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

impl Logger {
    pub fn new(dir: PathBuf, min: Level) -> Self {
        Self {
            min,
            writer: Mutex::new(RollingWriter::new(dir, MAX_FILE_BYTES, KEEP_FILES)),
        }
    }

    pub fn log(&self, level: Level, subsystem: &str, op: &str, fields: Map<String, Value>) {
        if level < self.min {
            return;
        }
        let ts = now_iso();
        let date = ts[..10].to_string();
        let line = json!({
            "ts": ts,
            "level": level.as_str(),
            "subsystem": subsystem,
            "op": op,
            "fields": sanitize_fields(fields),
        })
        .to_string();
        // A poisoned lock (a panic while writing) must not stop the next line.
        let mut writer = self
            .writer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = writer.write_line(&date, &line);
    }

    /// The log files this logger writes, oldest first.
    #[cfg(test)]
    pub fn files(&self) -> Vec<PathBuf> {
        log_files(&self.dir()).unwrap_or_default()
    }

    pub fn dir(&self) -> PathBuf {
        self.writer
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .dir()
            .to_path_buf()
    }
}

/// Install the process-wide logger. Later calls keep the first one.
pub fn init(dir: PathBuf, min: Level) -> &'static Logger {
    LOGGER.get_or_init(|| Logger::new(dir, min))
}

pub fn logger() -> Option<&'static Logger> {
    LOGGER.get()
}

/// Write one event. Silently a no-op before `init`, so library code never checks.
pub fn event(level: Level, subsystem: &str, op: &str, fields: Map<String, Value>) {
    if let Some(l) = LOGGER.get() {
        l.log(level, subsystem, op, fields);
    }
}

/// Convenience for `event` with an error message field, redacted.
pub fn error(subsystem: &str, op: &str, message: &str) {
    let mut fields = Map::new();
    fields.insert("error".into(), Value::String(message.to_string()));
    event(Level::Error, subsystem, op, fields);
}

// ---------------------------------------------------------------------------
// The last-run marker and the panic hook
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Crash {
    pub at: String,
    /// `file:line` of the panic; no path beyond the crate.
    pub location: String,
    /// The panic message, redacted and shortened.
    pub message: String,
}

/// What the previous run left behind, as the app reports it.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LastRun {
    pub crashed_last_time: bool,
    pub started_at: Option<String>,
    pub crash: Option<Crash>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub started_at: String,
    pub ended_cleanly: bool,
    pub crash: Option<Crash>,
    pub version: String,
}

fn marker_path(dir: &Path) -> PathBuf {
    dir.join(LAST_RUN_FILE)
}

pub fn read_marker(dir: &Path) -> Option<Marker> {
    let text = fs::read_to_string(marker_path(dir)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_marker(dir: &Path, marker: &Marker) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(marker).unwrap_or_default();
    fs::write(marker_path(dir), text)
}

/// Read what the previous run left, then claim this run: the marker says
/// "not ended cleanly" until `end_run` flips it.
pub fn begin_run(dir: &Path, version: &str) -> LastRun {
    let previous = read_marker(dir);
    let last = LastRun {
        crashed_last_time: previous.as_ref().is_some_and(|m| !m.ended_cleanly),
        started_at: previous.as_ref().map(|m| m.started_at.clone()),
        crash: previous.and_then(|m| m.crash),
    };
    let _ = write_marker(
        dir,
        &Marker {
            started_at: now_iso(),
            ended_cleanly: false,
            crash: None,
            version: version.to_string(),
        },
    );
    last
}

pub fn end_run(dir: &Path) {
    if let Some(mut marker) = read_marker(dir) {
        marker.ended_cleanly = true;
        let _ = write_marker(dir, &marker);
    }
}

pub fn record_crash(dir: &Path, crash: Crash) {
    let mut marker = read_marker(dir).unwrap_or_default();
    marker.ended_cleanly = false;
    marker.crash = Some(crash);
    let _ = write_marker(dir, &marker);
}

fn payload_message(info: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(s) = info.payload().downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "panic".to_string()
    }
}

thread_local! {
    static IN_HOOK: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Write a redacted crash record and mark the run, then let the default
/// hook print. Guarded against re-entry: a panic inside the hook falls
/// through to the default hook instead of recursing.
pub fn install_panic_hook(dir: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let reentered = IN_HOOK.with(|f| f.replace(true));
        if !reentered {
            let crash = Crash {
                at: now_iso(),
                location: info
                    .location()
                    .map(|l| format!("{}:{}", l.file(), l.line()))
                    .unwrap_or_default(),
                message: redact(&payload_message(info), MAX_MESSAGE_CHARS),
            };
            record_crash(&dir, crash.clone());
            let mut fields = Map::new();
            fields.insert("location".into(), Value::String(crash.location));
            fields.insert("message".into(), Value::String(crash.message));
            event(Level::Error, "process", "panic", fields);
            IN_HOOK.with(|f| f.set(false));
        }
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redaction_drops_quoted_text_and_bounds_length() {
        assert_eq!(
            redact("no such column: \"Buy milk for Omar\" in tasks", 100),
            "no such column: \"…\" in tasks"
        );
        assert_eq!(
            redact("said 'hello there' and “more secrets”", 100),
            "said '…' and “…”"
        );
        assert_eq!(redact("unterminated \"quote here", 100), "unterminated \"…");
        assert_eq!(
            redact("  lots   of \n whitespace  ", 100),
            "lots of whitespace"
        );
        assert_eq!(redact(&"x".repeat(50), 10), format!("{}…", "x".repeat(10)));
        let mut fields = Map::new();
        fields.insert("n".into(), json!(3));
        fields.insert("ok".into(), json!(true));
        fields.insert("msg".into(), json!("title 'Secret plan' failed"));
        fields.insert("nested".into(), json!({"title": "Secret"}));
        fields.insert("list".into(), json!(["Secret"]));
        let clean = sanitize_fields(fields);
        assert_eq!(clean.len(), 3);
        assert_eq!(clean["msg"], json!("title '…' failed"));
        assert!(!serde_json::to_string(&clean).unwrap().contains("Secret"));
    }

    #[test]
    fn rotates_by_size_and_by_day_and_keeps_seven() {
        let temp = tempfile::tempdir().unwrap();
        let mut w = RollingWriter::new(temp.path().join("logs"), 100, 7);
        let line = "x".repeat(40); // 41 bytes with the newline: two per file
        for _ in 0..5 {
            w.write_line("2026-09-13", &line).unwrap();
        }
        let names: Vec<String> = w
            .files()
            .unwrap()
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            [
                "orbit-2026-09-13.000.log",
                "orbit-2026-09-13.001.log",
                "orbit-2026-09-13.002.log"
            ]
        );
        for day in 14..=20 {
            w.write_line(&format!("2026-09-{day}"), "tick").unwrap();
        }
        let files = w.files().unwrap();
        assert_eq!(files.len(), 7);
        assert!(files[0].ends_with("orbit-2026-09-14.000.log"));
        assert!(files[6].ends_with("orbit-2026-09-20.000.log"));
        // Reopening on the same day appends to the newest file that has room.
        let mut again = RollingWriter::new(temp.path().join("logs"), 100, 7);
        again.write_line("2026-09-20", "after restart").unwrap();
        let text = fs::read_to_string(temp.path().join("logs/orbit-2026-09-20.000.log")).unwrap();
        assert_eq!(text, "tick\nafter restart\n");
        assert_eq!(again.files().unwrap().len(), 7);
    }

    #[test]
    fn logger_writes_json_lines_with_redacted_fields_above_its_level() {
        let temp = tempfile::tempdir().unwrap();
        let logger = Logger::new(temp.path().to_path_buf(), Level::Info);
        let mut fields = Map::new();
        fields.insert("error".into(), json!("failed on \"Pay rent\" row"));
        fields.insert("durationMs".into(), json!(12));
        logger.log(Level::Debug, "db", "quiet", Map::new());
        logger.log(Level::Warn, "db", "write", fields);
        let files = logger.files();
        assert_eq!(files.len(), 1);
        let text = fs::read_to_string(&files[0]).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 1);
        let parsed: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(parsed["level"], "warn");
        assert_eq!(parsed["subsystem"], "db");
        assert_eq!(parsed["op"], "write");
        assert_eq!(parsed["fields"]["durationMs"], 12);
        assert_eq!(parsed["fields"]["error"], "failed on \"…\" row");
        assert!(!text.contains("Pay rent"));
        assert_eq!(&parsed["ts"].as_str().unwrap()[10..11], "T");
    }

    #[test]
    fn last_run_marker_reports_a_crash_once_and_a_clean_exit() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        // First ever run: nothing before.
        assert_eq!(begin_run(dir, "0.1.0"), LastRun::default());
        end_run(dir);
        let clean = begin_run(dir, "0.1.0");
        assert!(!clean.crashed_last_time);
        assert!(clean.started_at.is_some());
        // This run "crashes".
        record_crash(
            dir,
            Crash {
                at: "2026-09-13T10:00:00.000Z".into(),
                location: "src/x.rs:1".into(),
                message: "boom".into(),
            },
        );
        let next = begin_run(dir, "0.1.0");
        assert!(next.crashed_last_time);
        assert_eq!(next.crash.as_ref().unwrap().location, "src/x.rs:1");
        // A run that simply never ended (killed) also counts.
        let killed = begin_run(dir, "0.1.0");
        assert!(killed.crashed_last_time);
        assert!(killed.crash.is_none());
        end_run(dir);
        assert!(!begin_run(dir, "0.1.0").crashed_last_time);
    }
}
