import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { List, ListRow } from './List';

function Example({ onActivate }: { onActivate?: (id: string) => void }) {
  return (
    <List aria-label="Tasks" onActivate={onActivate}>
      <ListRow id="a">Alpha</ListRow>
      <ListRow id="b">Beta</ListRow>
      <ListRow id="c">Gamma</ListRow>
    </List>
  );
}

describe('List', () => {
  it('selects on click and moves with j / k / arrows, activating on Enter', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<Example onActivate={onActivate} />);

    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('j');
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('j'); // clamps at the end
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('k');
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith('b');
  });

  it('exposes listbox semantics', () => {
    render(<Example />);
    expect(screen.getByRole('listbox', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
});
