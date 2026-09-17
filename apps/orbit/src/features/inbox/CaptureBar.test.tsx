import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixedClock, parseCapture } from '@orbit/core';
import { renderWithProviders } from '@/test/render';
import { CaptureBar } from './CaptureBar';

// Saturday 12 Sep 2026, 09:00 local.
const clock = fixedClock(new Date(2026, 8, 12, 9, 0, 0));

describe('CaptureBar', () => {
  it('shows a Task chip and a date token for "Submit my report next Friday"', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaptureBar clock={clock} />);
    await user.type(
      screen.getByRole('textbox', { name: 'Capture' }),
      'Submit my report next Friday',
    );

    const type = screen.getByTestId('capture-type');
    expect(type.querySelector('[data-kind="task"]')).not.toBeNull();
    expect(screen.getByTestId('token-date')).toHaveTextContent('Fri 18 Sep');
  });

  it('Tab cycles through the alternatives in order; Shift+Tab goes back', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaptureBar clock={clock} />);
    const input = screen.getByRole('textbox', { name: 'Capture' });
    await user.type(input, 'Dentist tomorrow at 3pm');
    const alts = parseCapture('Dentist tomorrow at 3pm', { now: clock.now() }).alternatives;
    const kind = () =>
      screen.getByTestId('capture-type').querySelector('[data-kind]')?.getAttribute('data-kind');

    expect(kind()).toBe(alts[0]!.type);
    await user.keyboard('{Tab}');
    expect(kind()).toBe(alts[1]!.type);
    await user.keyboard('{Tab}');
    expect(kind()).toBe(alts[2]!.type);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(kind()).toBe(alts[1]!.type);
    expect(input).toHaveFocus(); // Tab never leaves the field
  });

  it('Enter saves a capture and clears the bar', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const { repository } = renderWithProviders(<CaptureBar clock={clock} onSaved={onSaved} />);
    const input = screen.getByRole('textbox', { name: 'Capture' });
    await user.type(input, 'Pay electricity bill every month{Enter}');

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(input).not.toBeDisabled();
    const captures = await repository.captures.list();
    expect(captures).toHaveLength(1);
    expect(captures[0]?.type).toBe('bill');
    expect(captures[0]?.status).toBe('inbox');
    expect((captures[0]?.fields as { title: string }).title).toBe('Pay electricity bill');
  });

  it('removing a token edits the text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CaptureBar clock={clock} />);
    const input = screen.getByRole('textbox', { name: 'Capture' });
    await user.type(input, 'Submit my report next Friday');
    await user.click(screen.getByRole('button', { name: 'Remove Fri 18 Sep' }));
    expect(input).toHaveValue('Submit my report');
    expect(screen.queryByTestId('token-date')).not.toBeInTheDocument();
  });

  it('saves the type chosen with Tab, not the guess', async () => {
    const user = userEvent.setup();
    const { repository } = renderWithProviders(<CaptureBar clock={clock} />);
    const input = screen.getByRole('textbox', { name: 'Capture' });
    await user.type(input, 'Buy milk');
    await user.keyboard('{Tab}');
    const chosen = screen
      .getByTestId('capture-type')
      .querySelector('[data-kind]')
      ?.getAttribute('data-kind');
    await user.keyboard('{Enter}');
    await waitFor(async () => expect(await repository.captures.count()).toBe(1));
    expect((await repository.captures.list())[0]?.type).toBe(chosen);
  });

  it('offers to create a person named by an unknown mention', async () => {
    const user = userEvent.setup();
    const { repository } = renderWithProviders(<CaptureBar clock={clock} />);
    await user.type(screen.getByRole('textbox', { name: 'Capture' }), 'Call @Sarah tomorrow');

    await user.click(screen.getByRole('button', { name: 'Create Sarah?' }));
    await waitFor(async () => expect(await repository.people.count()).toBe(1));
    expect((await repository.people.list())[0]?.name).toBe('Sarah');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Create Sarah?' })).not.toBeInTheDocument(),
    );
  });
});
