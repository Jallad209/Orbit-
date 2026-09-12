import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from './Dialog';

function Example() {
  return (
    <>
      <Button>Before</Button>
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Archive project?</DialogTitle>
          <DialogDescription>Tasks stay searchable.</DialogDescription>
          <DialogFooter>
            <Button>Cancel</Button>
            <Button variant="danger">Archive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('opens with an accessible name, traps focus, and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    const dialog = await screen.findByRole('dialog', { name: 'Archive project?' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription('Tasks stay searchable.');

    // Focus stays inside the dialog while tabbing around.
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Focus returns to the trigger.
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('has a close button', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
