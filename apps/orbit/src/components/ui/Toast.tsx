import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { slideUp, transition } from '@/styles/motion';
import { useToastStore, type ToastVariant } from './toastStore';

const icons: Record<ToastVariant, typeof Info> = {
  neutral: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

const accents: Record<ToastVariant, string> = {
  neutral: 'text-nav-muted',
  success: 'text-lime',
  warning: 'text-gold-2',
  danger: 'text-[#f08a7c]',
};

/**
 * Renders the toast stack. Mount once in the app shell. The container is a
 * polite live region so screen readers announce new toasts without stealing focus.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const reduced = useReducedMotion();

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      role="status"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = icons[t.variant];
          return (
            <motion.div
              key={t.id}
              layout={!reduced}
              variants={reduced ? undefined : slideUp}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={transition.base}
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-md bg-nav px-3.5 py-3 text-nav-fg shadow-xl shadow-nav/30',
              )}
              data-variant={t.variant}
            >
              <Icon
                className={cn('mt-0.5 size-4 shrink-0', accents[t.variant])}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                {t.description ? (
                  <p className="mt-0.5 text-[13px] text-nav-muted">{t.description}</p>
                ) : null}
                {t.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                    className="mt-1.5 text-[13px] font-medium text-lime hover:underline focus-visible:outline-lime-2"
                  >
                    {t.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-mr-1 grid size-6 shrink-0 place-items-center rounded text-nav-muted hover:bg-nav-3 hover:text-nav-fg focus-visible:outline-lime-2"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
