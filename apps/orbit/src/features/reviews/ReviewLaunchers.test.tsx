import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { EVENING_FALLBACK_MIN, ReviewLaunchers } from './ReviewLaunchers';

const EVENING = 1080; // 18:00

describe('ReviewLaunchers', () => {
  it('offers the morning briefing while the day has no commitment', () => {
    renderWithProviders(
      <ReviewLaunchers
        date="2026-09-14"
        now={new Date(2026, 8, 14, 8, 0)}
        hasCommitment={false}
        eveningStartMin={EVENING}
      />,
    );
    expect(screen.getByRole('link', { name: 'Start morning briefing' })).toHaveAttribute(
      'href',
      '/review/morning?date=2026-09-14',
    );
    expect(screen.queryByRole('link', { name: 'Evening shutdown' })).not.toBeInTheDocument();
  });

  it('offers the evening shutdown once the evening hour has passed', () => {
    renderWithProviders(
      <ReviewLaunchers
        date="2026-09-15"
        now={new Date(2026, 8, 14, 18, 5)}
        hasCommitment={true}
        eveningStartMin={EVENING}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Start morning briefing' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Evening shutdown' })).toHaveAttribute(
      'href',
      '/review/evening?date=2026-09-14',
    );
  });

  it('renders nothing mid-day once the plan is accepted, and falls back to 17:00', () => {
    const { container } = renderWithProviders(
      <ReviewLaunchers
        date="2026-09-14"
        now={new Date(2026, 8, 14, 12, 0)}
        hasCommitment={true}
        eveningStartMin={EVENING}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(EVENING_FALLBACK_MIN).toBe(17 * 60);
    renderWithProviders(
      <ReviewLaunchers
        date="2026-09-14"
        now={new Date(2026, 8, 14, 17, 30)}
        hasCommitment={true}
      />,
    );
    expect(screen.getByRole('link', { name: 'Evening shutdown' })).toBeInTheDocument();
  });
});
