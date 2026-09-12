import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineEdit } from './InlineEdit';

describe('InlineEdit', () => {
  it('commits on Enter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<InlineEdit value="Draft" onCommit={onCommit} aria-label="Title" />);
    await user.click(screen.getByRole('button', { name: /Title: Draft/ }));
    const input = screen.getByRole('textbox', { name: 'Title' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'Draft v2{Enter}');
    expect(onCommit).toHaveBeenCalledWith('Draft v2');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('cancels on Escape without committing', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<InlineEdit value="Draft" onCommit={onCommit} onCancel={onCancel} aria-label="Title" />);
    await user.click(screen.getByRole('button'));
    await user.type(screen.getByRole('textbox'), ' changed{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button')).toHaveTextContent('Draft');
  });

  it('commits on blur and rejects empty values when required', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <>
        <InlineEdit value="Draft" onCommit={onCommit} aria-label="Title" />
        <button>Elsewhere</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: /Title/ }));
    await user.clear(screen.getByRole('textbox'));
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Title/ })).toHaveTextContent('Draft');
  });

  it('does not commit an unchanged value', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<InlineEdit value="Same" onCommit={onCommit} aria-label="Title" />);
    await user.click(screen.getByRole('button'));
    await user.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
