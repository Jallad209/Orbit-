# Hosting the Orbit PWA

Orbit's web build is a folder of static files. There is no server component and no account. Anything that can serve files over HTTPS can host it, including your own machine on the local network.

## Build

```bash
pnpm --filter orbit run build
```

The output is `apps/orbit/dist/`. It contains `index.html`, the JS/CSS bundles, the bundled fonts, `manifest.webmanifest`, the icons, and the service worker `sw.js`. The CI workflow `.github/workflows/pwa.yml` uploads this folder as the `orbit-pwa` artifact on every push to `main`.

## Preview on your phone over the LAN

Service workers require HTTPS or `localhost`. For a phone on the same Wi-Fi you need a certificate the phone trusts. The simplest route is `mkcert`:

1. Install mkcert (`winget install FiloSottile.mkcert`), then run `mkcert -install` once.
2. Find your PC's LAN IP (`ipconfig`, e.g. `192.168.1.20`) and create a cert:

   ```bash
   mkcert 192.168.1.20 localhost
   ```

3. Serve the build with HTTPS:

   ```bash
   pnpm run preview:lan
   ```

   This runs Vite preview bound to all interfaces on port 4173. Set `ORBIT_TLS_CERT` and `ORBIT_TLS_KEY` to the files mkcert produced to enable HTTPS (see `apps/orbit/vite.config.ts`).

4. On the phone, install the mkcert root CA (`mkcert -CAROOT` shows where it is; AirDrop or email the `rootCA.pem` to the phone and install it under certificate settings), then open `https://192.168.1.20:4173`.
5. Use the browser's "Add to Home Screen" / "Install". Turn on airplane mode and reopen Orbit: it loads from the precache.

Without HTTPS the app still works in the browser tab; only installation and offline caching are unavailable.

## Self-hosting for real use

Any static host works: a folder behind Nginx or Caddy on a home server, a NAS web share, GitHub Pages on a private repo (needs a paid plan), or a static hosting service. Requirements:

- Serve `dist/` at the site root (or set Vite's `base` if you use a subpath).
- Serve `index.html` for unknown paths so client-side routes like `/today` load on refresh.
- Send `Cache-Control: no-cache` for `sw.js` and `index.html` so updates are noticed; hashed assets can be cached forever.
- HTTPS.

Example Caddyfile:

```
orbit.example.lan {
  root * /srv/orbit/dist
  try_files {path} /index.html
  header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'"
  header /sw.js Cache-Control "no-cache"
  header /index.html Cache-Control "no-cache"
  file_server
}
```

## What is not hosted

Your data. It stays in the browser's IndexedDB on each device. Use Settings → Export to move it, and the desktop app (week 7) for a durable file on disk.
