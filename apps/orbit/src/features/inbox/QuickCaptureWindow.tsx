import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { usePlatform } from '@/platform';
import type { QuitPrepareRequest } from '@/platform/types';
import { CaptureBar, type CaptureBarHandle } from './CaptureBar';

/**
 * The system-wide capture window (desktop). A frameless, always-on-top
 * window that hosts the same CaptureBar as the inbox: Enter saves and hides
 * the window, Escape hides it. Opened by Ctrl+Shift+Space from anywhere.
 *
 * Before a quit (week 12) the shell asks this window too: empty text is
 * acknowledged at once; typed text is never converted on its own — the
 * window comes forward and offers Save capture, Discard, or Cancel quit.
 */
export function QuickCaptureWindow() {
  const platform = usePlatform();
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<CaptureBarHandle>(null);
  const text = useRef('');
  const [quitRequest, setQuitRequest] = useState<QuitPrepareRequest | null>(null);
  const desktop = platform.desktop;

  const hide = () => void desktop?.hideCaptureWindow();

  // The window is shown and hidden rather than recreated: refocus the input on every show.
  useEffect(() => {
    const focus = () => root.current?.querySelector<HTMLInputElement>('input')?.focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);

  useEffect(() => {
    if (!desktop) return;
    let off: (() => void) | null = null;
    let cancelled = false;
    void desktop
      .onShellEvent('orbit:quit-prepare', (payload) => {
        const request = payload as QuitPrepareRequest;
        if (!text.current.trim()) {
          void desktop.ackQuit(request, true).catch(() => undefined);
          return;
        }
        setQuitRequest(request);
        void desktop.showCaptureWindow().catch(() => undefined);
      })
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else {
          off = unsubscribe;
          void desktop.captureSubscribed().catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [desktop]);

  const answer = async (choice: 'save' | 'discard' | 'cancel') => {
    const request = quitRequest;
    if (!request || !desktop) return;
    setQuitRequest(null);
    if (choice === 'cancel') {
      await desktop.ackQuit(request, false, 'The quick capture window still holds text.');
      return;
    }
    try {
      if (choice === 'save') await bar.current?.save();
      else bar.current?.clear();
      await desktop.ackQuit(request, true);
    } catch (e) {
      await desktop
        .ackQuit(request, false, e instanceof Error ? e.message : 'The capture could not be saved.')
        .catch(() => undefined);
    }
  };

  return (
    <div
      ref={root}
      data-testid="quick-capture-window"
      className="flex h-dvh flex-col gap-2 border border-line bg-surface p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !quitRequest) hide();
      }}
    >
      <div
        className="flex cursor-move items-center justify-between text-[12px] font-semibold tracking-wide text-ink-muted uppercase select-none"
        onMouseDown={() => void desktop?.startDraggingWindow()}
      >
        <span>Quick capture</span>
        <span className="font-normal normal-case tracking-normal">
          <Kbd>Enter</Kbd> save · <Kbd>Esc</Kbd> hide
        </span>
      </div>
      {quitRequest ? (
        <div
          role="alertdialog"
          aria-label="Orbit is quitting"
          className="flex flex-wrap items-center gap-2 rounded-md border border-gold-2 bg-gold-2/20 px-3 py-2 text-[13px] text-ink"
          data-testid="capture-quit-prompt"
        >
          <span className="mr-auto">Orbit is quitting. This capture is not saved yet.</span>
          <Button size="sm" variant="ghost" onClick={() => void answer('cancel')}>
            Cancel quit
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void answer('discard')}>
            Discard
          </Button>
          <Button size="sm" variant="primary" onClick={() => void answer('save')} autoFocus>
            Save capture
          </Button>
        </div>
      ) : null}
      <CaptureBar
        ref={bar}
        autoFocus
        onSaved={hide}
        onTextChange={(value) => {
          text.current = value;
        }}
        placeholder="Capture anything… it lands in your inbox"
      />
    </div>
  );
}
