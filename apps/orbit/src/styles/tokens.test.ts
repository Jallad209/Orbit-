import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cssPath = [
  resolve(process.cwd(), 'apps/orbit/src/styles/tokens.css'),
  resolve(process.cwd(), 'src/styles/tokens.css'),
].find((path) => existsSync(path))!;
const css = readFileSync(cssPath, 'utf8');

function token(name: string): string {
  const value = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  if (!value) throw new Error(`missing colour token ${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(foreground: string, background: string): number {
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (bright! + 0.05) / (dark! + 0.05);
}

describe('design token accessibility', () => {
  it('keeps every informational text/background pair at WCAG AA contrast', () => {
    const pairs = [
      ...['ink', 'ink-muted', 'ink-faint'].flatMap((foreground) =>
        ['surface', 'surface-2', 'surface-3'].map((background) => [foreground, background]),
      ),
      ['nav-fg', 'nav'],
      ['nav-muted', 'nav'],
      ['lime-ink', 'lime'],
      ['gold-ink', 'gold-2'],
      ['danger', 'danger-soft'],
      ['ok', 'surface'],
      ['ok', 'surface-2'],
      ['ok', 'surface-3'],
    ];

    for (const [foreground, background] of pairs) {
      expect(
        contrast(token(foreground!), token(background!)),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('disables CSS motion for both the OS preference and the in-app setting', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain(":root[data-motion='reduced'] *");
    expect(css).toMatch(/--animate-slide-in-right:\s*slide-in-right 180ms/);
  });
});
