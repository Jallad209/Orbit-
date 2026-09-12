// Generates the PWA icons deterministically (no native deps, no downloads).
// Usage: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const OUT = new URL('../apps/orbit/public/icons/', import.meta.url);
const NAV = [0x1c, 0x1b, 0x1a];
const LIME = [0xc6, 0xf1, 0x35];
const GOLD = [0xd4, 0xa9, 0x3a];
const SS = 4; // supersampling factor per axis

function sample(u, v, maskable) {
  // u, v in [0, 1]. Returns [r, g, b, a] or null for transparent.
  const cx = u - 0.5;
  const cy = v - 0.5;

  // Background: full bleed for maskable, rounded square otherwise.
  if (!maskable) {
    const r = 0.22;
    const ax = Math.abs(cx) - (0.5 - r);
    const ay = Math.abs(cy) - (0.5 - r);
    const outside = Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) > r;
    if (outside) return null;
  }
  const scale = maskable ? 0.72 : 0.86;

  // Orbit ring: rotated ellipse.
  const angle = -Math.PI / 6;
  const rx = 0.34 * scale;
  const ry = 0.2 * scale;
  const x = cx * Math.cos(-angle) - cy * Math.sin(-angle);
  const y = cx * Math.sin(-angle) + cy * Math.cos(-angle);
  const rad = Math.hypot(x / rx, y / ry);
  const ringWidth = 0.075 * scale;
  const localScale = Math.hypot(
    Math.cos(Math.atan2(y / ry, x / rx)) * rx,
    Math.sin(Math.atan2(y / ry, x / rx)) * ry,
  );
  const onRing = Math.abs(rad - 1) * localScale < ringWidth / 2;

  // Planet in the centre.
  const planet = Math.hypot(cx, cy) < 0.13 * scale;

  // Gold moon sitting on the ring.
  const t = Math.PI * 0.15;
  const mx = rx * Math.cos(t);
  const my = ry * Math.sin(t);
  const moonX = mx * Math.cos(angle) - my * Math.sin(angle);
  const moonY = mx * Math.sin(angle) + my * Math.cos(angle);
  const moon = Math.hypot(cx - moonX, cy - moonY) < 0.055 * scale;

  if (moon) return [...GOLD, 255];
  if (planet || onRing) return [...LIME, 255];
  return [...NAV, 255];
}

function render(size, maskable) {
  const png = new PNG({ width: size, height: size });
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          const c = sample(u, v, maskable);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += c[3];
          }
        }
      }
      const n = SS * SS;
      const idx = (py * size + px) * 4;
      const alpha = a / n;
      // Premultiply-free average: weight colour by coverage.
      const cov = a > 0 ? a / 255 : 1;
      png.data[idx] = Math.round(r / cov);
      png.data[idx + 1] = Math.round(g / cov);
      png.data[idx + 2] = Math.round(b / cov);
      png.data[idx + 3] = Math.round(alpha);
    }
  }
  return PNG.sync.write(png);
}

mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];
for (const [name, size, maskable] of files) {
  writeFileSync(new URL(name, OUT), render(size, maskable));
  console.log(`wrote icons/${name}`);
}
