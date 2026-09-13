import type { TimeWindow } from '@orbit/core';

/** One pixel per minute keeps the arithmetic trivial: 16 hours = 960 px. */
export const PX_PER_MIN = 1;

export interface CanvasLayout {
  startMin: number;
  endMin: number;
  heightPx: number;
  hours: number[];
}

/** The visible day: at least 06:00–22:00, stretched to cover the working window. */
export function canvasLayout(window: TimeWindow): CanvasLayout {
  const startMin = Math.min(6 * 60, Math.max(0, window.startMin - 60));
  const endMin = Math.max(22 * 60, Math.min(1440, window.endMin + 60));
  const hours: number[] = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);
  return { startMin, endMin, heightPx: (endMin - startMin) * PX_PER_MIN, hours };
}

export function minuteToPx(minute: number, layout: CanvasLayout): number {
  return (minute - layout.startMin) * PX_PER_MIN;
}

export function pxToMinute(px: number, layout: CanvasLayout): number {
  return Math.round(px / PX_PER_MIN) + layout.startMin;
}
