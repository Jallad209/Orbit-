import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Toaster } from './Toast';
import { toast, useToastStore } from './toastStore';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders inside a polite live region and auto-dismisses', () => {
    render(<Toaster />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');

    act(() => {
      toast({ title: 'Saved', durationMs: 1000 });
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('keeps sticky toasts until dismissed and runs the action', () => {
    render(<Toaster />);
    const onClick = vi.fn();
    act(() => {
      toast({ title: 'Moved 3 blocks', durationMs: 0, action: { label: 'Undo', onClick } });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Moved 3 blocks')).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'Undo' }).click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('replaces a toast with the same id instead of stacking', () => {
    act(() => {
      toast({ id: 'pwa', title: 'First' });
      toast({ id: 'pwa', title: 'Second' });
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.title).toBe('Second');
  });

  it('caps the visible stack', () => {
    act(() => {
      for (let i = 0; i < 6; i++) toast({ title: `t${i}` });
    });
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(['t2', 't3', 't4', 't5']);
  });
});
