import { useEffect, useRef } from 'react';
import { Kbd } from '@/components/ui/Kbd';
import { usePlatform } from '@/platform';
import { CaptureBar } from './CaptureBar';

/**
 * The system-wide capture window (desktop). A frameless, always-on-top
 * window that hosts the same CaptureBar as the inbox: Enter saves and hides
 * the window, Escape hides it. Opened by Ctrl+Shift+Space from anywhere.
 */
export function QuickCaptureWindow() {
  const platform = usePlatform();
  const root = useRef<HTMLDivElement>(null);

  const hide = () => void platform.desktop?.hideCaptureWindow();

  // The window is shown and hidden rather than recreated: refocus the input on every show.
  useEffect(() => {
    const focus = () => root.current?.querySelector<HTMLInputElement>('input')?.focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);

  return (
    <div
      ref={root}
      data-testid="quick-capture-window"
      className="flex h-dvh flex-col gap-2 border border-line bg-surface p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide();
      }}
    >
      <div
        className="flex cursor-move items-center justify-between text-[12px] font-semibold tracking-wide text-ink-muted uppercase select-none"
        onMouseDown={() => void platform.desktop?.startDraggingWindow()}
      >
        <span>Quick capture</span>
        <span className="font-normal normal-case tracking-normal">
          <Kbd>Enter</Kbd> save · <Kbd>Esc</Kbd> hide
        </span>
      </div>
      <CaptureBar autoFocus onSaved={hide} placeholder="Capture anything… it lands in your inbox" />
    </div>
  );
}
