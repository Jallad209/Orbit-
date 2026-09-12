import { Dialog as DialogPrimitive } from 'radix-ui';
import { useNavigate } from 'react-router';
import { useAppStore } from '@/app/store';
import { Kbd } from '@/components/ui/Kbd';
import { toast } from '@/components/ui/toastStore';
import { useHotkey } from '@/lib/hotkeys';
import { CaptureBar } from './CaptureBar';

/**
 * Press `c` on any screen to capture without leaving it. Closes on save and
 * offers a one-click jump to the inbox. The desktop shell (week 7) reuses
 * the same bar in its system-wide window.
 */
export function QuickCaptureOverlay() {
  const open = useAppStore((s) => s.quickCaptureOpen);
  const setOpen = useAppStore((s) => s.setQuickCaptureOpen);
  const navigate = useNavigate();

  useHotkey('c', () => setOpen(true), { description: 'Quick capture', group: 'General' });

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-nav/30 backdrop-blur-[2px] animate-fade-in" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed top-[18vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border border-line bg-surface p-4 shadow-xl shadow-nav/20 animate-slide-down focus:outline-none"
          data-testid="quick-capture"
        >
          <DialogPrimitive.Title className="mb-2 text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
            Quick capture
          </DialogPrimitive.Title>
          <CaptureBar
            autoFocus
            onSaved={(result) => {
              setOpen(false);
              toast({
                title: 'Captured',
                description: result.fields.title,
                variant: 'success',
                action: { label: 'Open inbox', onClick: () => navigate('/inbox') },
              });
            }}
          />
          <p className="mt-3 text-[11px] text-ink-faint">
            <Kbd>Esc</Kbd> to close
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
