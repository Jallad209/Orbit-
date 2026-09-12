import type { Transition, Variants } from 'motion/react';

/** Durations in seconds for Motion; the CSS tokens in tokens.css mirror these. */
export const duration = {
  fast: 0.12,
  base: 0.18,
  slow: 0.26,
} as const;

export const easeOutQuick = [0.2, 0.8, 0.2, 1] as const;

export const transition: Record<keyof typeof duration, Transition> = {
  fast: { duration: duration.fast, ease: easeOutQuick },
  base: { duration: duration.base, ease: easeOutQuick },
  slow: { duration: duration.slow, ease: easeOutQuick },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1 },
};

export const slideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
};

export const slideDown: Variants = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};
