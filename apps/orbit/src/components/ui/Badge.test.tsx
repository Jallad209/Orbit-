import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ENTITY_LABELS, TypeBadge, type EntityKind } from './Badge';

const KINDS = Object.keys(ENTITY_LABELS) as EntityKind[];

describe('TypeBadge', () => {
  it('renders the right label and a distinct class per entity kind', () => {
    render(
      <>
        {KINDS.map((k) => (
          <TypeBadge key={k} kind={k} />
        ))}
      </>,
    );
    const classes = new Set<string>();
    for (const kind of KINDS) {
      const el = screen.getByText(ENTITY_LABELS[kind]);
      expect(el).toHaveAttribute('data-kind', kind);
      classes.add(el.className);
    }
    expect(classes.size).toBe(KINDS.length);
  });
});
