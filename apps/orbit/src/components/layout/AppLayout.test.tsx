import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppRoutes } from '@/routes';
import { DESTINATIONS } from './NavRail';
import { renderWithProviders } from '@/test/render';

describe('AppLayout', () => {
  it('renders the primary navigation with every destination', () => {
    renderWithProviders(<AppRoutes />, { route: '/today' });
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toBeInTheDocument();
    for (const d of DESTINATIONS) {
      expect(screen.getByRole('link', { name: new RegExp(`^${d.label}`) })).toHaveAttribute(
        'href',
        d.to,
      );
    }
  });

  it('marks the active route with aria-current', () => {
    renderWithProviders(<AppRoutes />, { route: '/inbox' });
    expect(screen.getByRole('link', { name: /^Inbox/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Today/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inbox');
  });

  it('redirects the root to /today', () => {
    renderWithProviders(<AppRoutes />, { route: '/' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^(Today|Tomorrow)$/);
  });

  it('has a skip link that targets main content', () => {
    renderWithProviders(<AppRoutes />);
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('navigates with "g" sequences from the keyboard', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/today' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^(Today|Tomorrow)$/);

    await user.keyboard('gi');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Inbox');

    await user.keyboard('gp');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Projects');

    await user.keyboard('gt');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^(Today|Tomorrow)$/);
  });

  it('shows a visible focus ring when tabbing to a link', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />);
    await user.tab(); // skip link
    await user.tab(); // search and commands
    await user.tab(); // first nav link
    const link = screen.getByRole('link', { name: /^Today/ });
    expect(link).toHaveFocus();
    expect(link.className).toContain('focus-visible:outline-lime-2');
  });
});
