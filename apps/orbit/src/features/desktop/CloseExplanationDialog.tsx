import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/Dialog';

interface Props {
  open: boolean;
  /** Record that the explanation was seen and hide to the tray. */
  onHide: () => void;
  onQuit: () => void;
  onCancel: () => void;
}

/**
 * Shown once, before the first close-to-tray. Says what happens, how to get
 * Orbit back, where Quit is, and how to turn the behaviour off. The login
 * launch never triggers it: only a close the user asked for does.
 */
export function CloseExplanationDialog({ open, onHide, onQuit, onCancel }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onCancel() : undefined)}>
      <DialogContent size="sm" data-testid="close-explanation">
        <DialogTitle>Orbit keeps running in the tray</DialogTitle>
        <DialogDescription>
          Closing this window hides it; reminders keep working. Click the tray icon or open Orbit
          again to bring it back. Quit is in the tray menu and in Settings → Desktop, where you can
          also turn this off.
        </DialogDescription>
        <p className="mt-3 text-[13px] text-ink-muted">
          Reminders arrive while the computer is awake and Orbit is running. Nothing fires while it
          is asleep or Orbit is not running; those catch up when Orbit can run again.
        </p>
        <DialogFooter>
          <Link
            to="/settings#desktop"
            onClick={onCancel}
            className="mr-auto text-[13px] text-ink-muted underline"
          >
            Change in Settings
          </Link>
          <Button variant="ghost" onClick={onQuit}>
            Quit instead
          </Button>
          <Button variant="primary" onClick={onHide} autoFocus>
            Hide to tray
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
