import { create } from 'zustand';

export type ToastVariant = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  /** 0 keeps the toast until dismissed. */
  durationMs: number;
  action?: ToastAction;
  secondaryAction?: ToastAction;
}

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
  action?: ToastAction;
  secondaryAction?: ToastAction;
  /** Reuse an id to replace an existing toast instead of stacking. */
  id?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION_MS = 4000;
const MAX_VISIBLE = 4;
let counter = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push(input) {
    const id = input.id ?? `toast-${++counter}`;
    const toast: Toast = {
      id,
      title: input.title,
      description: input.description,
      variant: input.variant ?? 'neutral',
      durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
      action: input.action,
      secondaryAction: input.secondaryAction,
    };
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);

    set((s) => {
      const without = s.toasts.filter((t) => t.id !== id);
      const next = [...without, toast];
      return { toasts: next.slice(-MAX_VISIBLE) };
    });

    if (toast.durationMs > 0) {
      timers.set(
        id,
        setTimeout(() => get().dismiss(id), toast.durationMs),
      );
    }
    return id;
  },

  dismiss(id) {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },

  clear() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    set({ toasts: [] });
  },
}));

/** Imperative API usable outside React (services, platform code). */
export const toast = Object.assign(
  (input: ToastInput | string) =>
    useToastStore.getState().push(typeof input === 'string' ? { title: input } : input),
  {
    success: (title: string, description?: string) =>
      useToastStore.getState().push({ title, description, variant: 'success' }),
    warning: (title: string, description?: string) =>
      useToastStore.getState().push({ title, description, variant: 'warning' }),
    danger: (title: string, description?: string) =>
      useToastStore.getState().push({ title, description, variant: 'danger', durationMs: 8000 }),
    dismiss: (id: string) => useToastStore.getState().dismiss(id),
  },
);
