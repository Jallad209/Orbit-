//! `orbit://` activations (week 12): the typed URI a notification click or
//! a protocol handler hands to the process. One strict parser here mirrors
//! `apps/orbit/src/lib/destinations.ts` and both are checked against the
//! shared vectors in `tests/fixtures/behaviour/orbit-uris.json`.
//!
//! A URI only names a record to open. It cannot mark paid, complete a task,
//! record contact, import data, accept a plan, run a command, switch the
//! data directory, or open an arbitrary page. Only the kind reaches the
//! logs; the id and anything else never do.

use std::time::{Duration, Instant};

/// The kinds a URI may name; reminders resolve to their source in the frontend.
pub const KINDS: &[&str] = &[
    "reminder",
    "task",
    "person",
    "commitment",
    "bill",
    "note",
    "review",
];
pub const SCHEME: &str = "orbit://";
pub const MAX_URI_LEN: usize = 128;
/// Two deliveries of one activation through more than one API within this window are one.
pub const DEDUP_WINDOW: Duration = Duration::from_millis(1500);

/// A validated activation: the canonical URI (lower-case id) and its kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Activation {
    pub uri: String,
    pub kind: &'static str,
    pub id: String,
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (i, b) in bytes.iter().enumerate() {
        let hyphen = matches!(i, 8 | 13 | 18 | 23);
        if hyphen {
            if *b != b'-' {
                return false;
            }
        } else if !b.is_ascii_hexdigit() {
            return false;
        }
    }
    // RFC 9562 version 1–8 and variant 8, 9, a, b — the same shape the schema accepts.
    let version = bytes[14];
    let variant = bytes[19].to_ascii_lowercase();
    matches!(version, b'1'..=b'8') && matches!(variant, b'8' | b'9' | b'a' | b'b')
}

/// Parse an argument as an activation. Anything that is not exactly
/// `orbit://<kind>/<uuid>` (an optional trailing slash allowed) is `None`:
/// wrong case, credentials, ports, queries, fragments, encoded characters,
/// whitespace, extra segments, unknown kinds, over-long input.
pub fn parse(input: &str) -> Option<Activation> {
    if input.len() > MAX_URI_LEN || !input.starts_with(SCHEME) {
        return None;
    }
    let rest = &input[SCHEME.len()..];
    if rest.bytes().any(|b| {
        b.is_ascii_whitespace()
            || b.is_ascii_control()
            || matches!(b, b'%' | b'?' | b'#' | b'@' | b':' | b'\\')
    }) {
        return None;
    }
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let (kind, id) = rest.split_once('/')?;
    let kind = KINDS.iter().find(|k| **k == kind)?;
    if !is_uuid(id) {
        return None;
    }
    let id = id.to_ascii_lowercase();
    Some(Activation {
        uri: format!("{SCHEME}{kind}/{id}"),
        kind,
        id,
    })
}

/// The first activation among launch arguments, if any.
pub fn from_args<'a>(args: impl IntoIterator<Item = &'a str>) -> Option<Activation> {
    args.into_iter().find_map(parse)
}

/// Collapses duplicate deliveries of one activation (the same URI within
/// `DEDUP_WINDOW`) while letting a later deliberate click through.
#[derive(Debug, Default)]
pub struct Dedup {
    last: Option<(String, Instant)>,
}

impl Dedup {
    /// True when this delivery should be acted on.
    pub fn accept(&mut self, uri: &str, now: Instant) -> bool {
        if let Some((last, at)) = &self.last {
            if last == uri && now.duration_since(*at) < DEDUP_WINDOW {
                return false;
            }
        }
        self.last = Some((uri.to_string(), now));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[derive(serde::Deserialize)]
    struct Vectors {
        accept: Vec<AcceptCase>,
        reject: Vec<String>,
    }

    #[derive(serde::Deserialize)]
    struct AcceptCase {
        input: String,
        kind: String,
        id: String,
    }

    fn vectors() -> Vectors {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/behaviour/orbit-uris.json");
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn parses_exactly_the_shared_accept_vectors() {
        for case in vectors().accept {
            let parsed =
                parse(&case.input).unwrap_or_else(|| panic!("should accept {}", case.input));
            assert_eq!(parsed.kind, case.kind, "{}", case.input);
            assert_eq!(parsed.id, case.id, "{}", case.input);
            assert_eq!(parsed.uri, format!("orbit://{}/{}", case.kind, case.id));
        }
    }

    #[test]
    fn rejects_every_shared_reject_vector_without_panicking() {
        for input in vectors().reject {
            assert!(parse(&input).is_none(), "should reject {input}");
        }
    }

    #[test]
    fn an_activation_beats_other_arguments_and_duplicates_collapse() {
        let id = "01a0a1b6-3ad4-7678-92cc-ae55e388b0a6";
        let uri = format!("orbit://task/{id}");
        assert_eq!(
            from_args(["orbit.exe", "--background", uri.as_str()])
                .unwrap()
                .kind,
            "task"
        );
        assert!(from_args(["orbit.exe", "--background"]).is_none());
        let mut dedup = Dedup::default();
        let t0 = Instant::now();
        assert!(dedup.accept(&uri, t0));
        assert!(
            !dedup.accept(&uri, t0 + Duration::from_millis(100)),
            "a second API delivering the same click"
        );
        assert!(
            dedup.accept(&uri, t0 + Duration::from_secs(3)),
            "a later deliberate click"
        );
        assert!(dedup.accept(
            "orbit://note/01a0a1b6-3ad4-7678-92cc-ae55e388b0a6",
            t0 + Duration::from_millis(200)
        ));
    }
}
