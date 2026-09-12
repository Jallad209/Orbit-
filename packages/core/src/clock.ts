/**
 * Injectable clock. The engine never calls `new Date()` directly so that
 * planner, parser, and insight tests are deterministic.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface FixedClock extends Clock {
  /** Move the clock forward by `ms` milliseconds. */
  advance(ms: number): void;
  /** Set the clock to an exact instant. */
  set(at: Date | string): void;
}

export function fixedClock(at: Date | string): FixedClock {
  let current = new Date(at);
  return {
    now: () => new Date(current),
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
    set: (next) => {
      current = new Date(next);
    },
  };
}

export function nowIso(clock: Clock): string {
  return clock.now().toISOString();
}
