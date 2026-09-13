/**
 * Source fingerprints for "until data changes" snoozes. A fingerprint hashes
 * the canonical form of the semantic source values behind one insight:
 * sorted, with only the fields that could change the verdict, plus the
 * settings that apply and the algorithm version. Time never goes in, so a
 * snooze taken this morning is still in force this afternoon, and reordering
 * input arrays cannot change the hash.
 */

/** Deterministic serialization: object keys sorted, arrays as given (callers sort them). */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Two independent 32-bit FNV-1a hashes of the canonical form, as 16 hex characters. */
export function fingerprint(source: unknown): string {
  const text = canonical(source);
  const a = fnv1a(text, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv1a(text, 0x9747b28c).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

/** Sort helper so evidence and fingerprint sources are order-independent. */
export function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
