//! One timestamp format for everything the shell writes: the same ISO 8601
//! instant the records use, so log lines, reminders, and markers compare.

use std::time::{SystemTime, UNIX_EPOCH};

/// Days since 1970-01-01 for a Gregorian civil date (Howard Hinnant).
pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let yoe = year.rem_euclid(400);
    let shifted_month = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * shifted_month + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn parse_date(date: &str) -> Option<(i64, i64, i64)> {
    if date.len() != 10 || &date[4..5] != "-" || &date[7..8] != "-" {
        return None;
    }
    Some((
        date[0..4].parse().ok()?,
        date[5..7].parse().ok()?,
        date[8..10].parse().ok()?,
    ))
}

pub fn days_between(from: &str, to: &str) -> Option<i64> {
    let (fy, fm, fd) = parse_date(from)?;
    let (ty, tm, td) = parse_date(to)?;
    Some(days_from_civil(ty, tm, td) - days_from_civil(fy, fm, fd))
}

#[allow(dead_code)] // Kept beside days_between for dated backup/retention callers.
pub fn date_shift(date: &str, delta: i64) -> Option<String> {
    let (year, month, day) = parse_date(date)?;
    Some(civil_from_days(days_from_civil(year, month, day) + delta))
}

fn civil_from_days(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn system_time_iso(at: SystemTime) -> String {
    let since = at.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs() as i64;
    let millis = since.subsec_millis();
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    format!(
        "{}T{:02}:{:02}:{:02}.{millis:03}Z",
        civil_from_days(days),
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// ISO 8601 instant for "now", the format every stored `fireAt` uses.
pub fn now_iso() -> String {
    system_time_iso(SystemTime::now())
}

pub fn today_utc() -> String {
    now_iso()[..10].to_string()
}

pub fn compact_utc() -> String {
    let iso = now_iso();
    format!(
        "{}{}{}T{}{}{}Z",
        &iso[0..4],
        &iso[5..7],
        &iso[8..10],
        &iso[11..13],
        &iso[14..16],
        &iso[17..19]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_iso_is_utc_iso8601() {
        let s = now_iso();
        assert_eq!(s.len(), 24, "{s}");
        assert!(s.ends_with('Z'));
        assert_eq!(&s[10..11], "T");
    }

    #[test]
    fn date_helpers_round_trip_leap_days() {
        for date in ["1970-01-01", "2000-02-29", "2026-09-17", "2100-03-01"] {
            assert_eq!(date_shift(date, 0).as_deref(), Some(date));
            assert_eq!(days_between(date, date), Some(0));
        }
        assert_eq!(date_shift("2024-02-28", 1).as_deref(), Some("2024-02-29"));
        assert_eq!(date_shift("2024-02-29", 1).as_deref(), Some("2024-03-01"));
        assert_eq!(days_between("2026-09-10", "2026-09-17"), Some(7));
    }
}
