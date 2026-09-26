# Zero-network evidence

Date: 18 September 2026; desktop and process-tree layers 26 September 2026  
Baseline HEAD: `19888d239a355e55489174768d80e114545f42ad`  
State: uncommitted Week 13 working tree on Windows 11 x64

Orbit has no network feature. Browser tests allow only the Vite preview origin; desktop tests
allow only `http://tauri.localhost` application resources and local Tauri IPC.

| Layer                | Result                    | Method / limitation                                                                                                                                           |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium PWA         | PASS                      | Auto fixture monitored the whole browser context, including workers; shell, Search, Insights, and registered workers stayed on `http://localhost:4517`        |
| Firefox PWA          | PASS                      | Same production-build route and context-wide request check                                                                                                    |
| WebKit PWA           | PASS                      | Same check; WebKit may expose service workers without resolving `navigator.serviceWorker.ready`, so the test inspects registrations without blocking          |
| Web CSP              | PASS                      | Chromium, Firefox, and WebKit loaded the production policy without a violation event                                                                          |
| Desktop WebView2     | PASS                      | `zero-network.e2e.ts` on the cold harness, 26 September: every request from the main and capture pages was `http://tauri.localhost` or `http://ipc.localhost` |
| Windows process tree | PASS, with a caveat below | `net-watch.ps1`, 26 September, 60 s over a driven session: `orbit.exe` itself opened no socket; two connections came from the embedded WebView2 runtime       |

## What the process-tree watch found

Watching `orbit.exe` and every process it spawns for 60 seconds, while the app was driven
through first run and the main screens, produced two established TCP connections. Neither was
Orbit:

| Process              | Parent               | Role                           | Remote                     |
| -------------------- | -------------------- | ------------------------------ | -------------------------- |
| `msedgewebview2.exe` | `orbit.exe`          | the WebView2 browser process   | `2603:1046:c12:c00::2:443` |
| `msedgewebview2.exe` | `msedgewebview2.exe` | `network.mojom.NetworkService` | `2620:1ec:33::11:443`      |

Both addresses are Microsoft's. This is the WebView2 runtime doing its own background work —
component updates and Edge services — and it is the runtime Windows installs and updates, not
anything Orbit ships or calls. Orbit's own process opened no socket, and no request from the
app's pages left `tauri.localhost`.

The honest form of the claim is therefore: **Orbit sends nothing, and the component Microsoft
supplies to render it talks to Microsoft.** A user who needs that silenced too can block
`msedgewebview2.exe` at the firewall; the app keeps working, because it never wanted the
network. Passing `--disable-background-networking` to the webview would stop most of it at the
source, and is worth considering after 1.0 — it is not done now because the same channel is how
the desktop test harness attaches a debugger, and changing it deserves its own verification
rather than a change made on release day.

Every Playwright spec imports the auto fixture, so an off-origin page, worker, or service-worker
request fails the scenario that caused it. CI enables Playwright's experimental service-worker
network events. The three focused browser gates passed 9/9, with the WebKit zero-network case
rerun after replacing an unbounded service-worker readiness wait. The desktop CDP attachment
happens after first paint, so the initial application
asset requests are not captured; those resources are same-origin by construction. The separate
Windows process-tree watch is required once per release to cover WebView2 activity outside CDP.
