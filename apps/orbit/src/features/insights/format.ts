import { formatDuration, formatMinute } from '@orbit/core';
import type { Insight, InsightSeverity, InsightThreshold } from '@orbit/core';

/** Formatting for insight numbers. Values stay numbers in core; only this file makes strings. */

export const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  risk: 'Risk',
  attention: 'Attention',
  info: 'Info',
};

export const SEVERITY_TONE: Record<InsightSeverity, 'danger' | 'gold' | 'neutral'> = {
  risk: 'danger',
  attention: 'gold',
  info: 'neutral',
};

export function formatRatio(value: number): string {
  return `${value.toFixed(2)}×`;
}

export function formatMinutes(min: number): string {
  return `${Math.round(min)} min (${formatDuration(min)})`;
}

export function formatRange(startMin: number, endMin: number): string {
  return `${formatMinute(startMin)}–${formatMinute(endMin)}`;
}

export function formatInstant(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${formatMinute(d.getHours() * 60 + d.getMinutes())}`;
}

function formatValue(value: number, unit: InsightThreshold['unit']): string {
  switch (unit) {
    case 'ratio':
      return formatRatio(value);
    case 'days':
      return `${value} day${value === 1 ? '' : 's'}`;
    case 'minutes':
      return `${Math.round(value)} min`;
    case 'count':
      return String(value);
  }
}

/** "1.50× > 1.30× · 5 of 5 samples" — visible without opening the evidence. */
export function formatThreshold(t: InsightThreshold): string {
  const base = `${formatValue(t.actual, t.unit)} ${t.operator} ${formatValue(t.limit, t.unit)}`;
  return t.sampleSize !== null && t.minSamples !== null
    ? `${base} · ${t.sampleSize} of ${t.minSamples} samples needed`
    : base;
}

/** The dates the observation covers, when it has any. */
export function formatRangeDates(insight: Insight): string | null {
  if (!insight.range) return null;
  return insight.range.from === insight.range.to
    ? insight.range.from
    : `${insight.range.from} to ${insight.range.to}`;
}
