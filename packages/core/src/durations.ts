/**
 * Human duration strings ↔ minutes. Accepts "45", "45m", "1h", "1h30",
 * "1h 30m", "1:30", "2.5h", "90 min". Returns null when unparseable.
 */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+):(\d{1,2})$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
  if (
    (m = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\s*(?:(\d+)\s*(?:m|min|mins|minutes?)?)?$/.exec(s))
  ) {
    return Math.round(Number(m[1]) * 60) + Number(m[2] ?? 0);
  }
  if ((m = /^(\d+)\s*(?:m|min|mins|minutes?)$/.exec(s))) return Number(m[1]);
  if ((m = /^(\d+)$/.exec(s))) return Number(m[1]);
  return null;
}

/** 90 → "1h 30m", 45 → "45m", 120 → "2h". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}
