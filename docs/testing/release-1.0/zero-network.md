# Zero-network evidence

Date: 18 September 2026  
Baseline HEAD: `19888d239a355e55489174768d80e114545f42ad`  
State: uncommitted Week 13 working tree on Windows 11 x64

Orbit has no network feature. Browser tests allow only the Vite preview origin; desktop tests
allow only `http://tauri.localhost` application resources and local Tauri IPC.

| Layer                | Result  | Method / limitation                                                                                                                                    |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chromium PWA         | PASS    | Auto fixture monitored the whole browser context, including workers; shell, Search, Insights, and registered workers stayed on `http://localhost:4517` |
| Firefox PWA          | PASS    | Same production-build route and context-wide request check                                                                                             |
| WebKit PWA           | PASS    | Same check; WebKit may expose service workers without resolving `navigator.serviceWorker.ready`, so the test inspects registrations without blocking   |
| Web CSP              | PASS    | Chromium, Firefox, and WebKit loaded the production policy without a violation event                                                                   |
| Desktop WebView2     | NOT RUN | Cold-launch request-capture test implemented; requires a fresh release binary                                                                          |
| Windows process tree | NOT RUN | `scripts/net-watch.ps1` implemented; must observe the release candidate and all WebView2 descendants                                                   |

Every Playwright spec imports the auto fixture, so an off-origin page, worker, or service-worker
request fails the scenario that caused it. CI enables Playwright's experimental service-worker
network events. The three focused browser gates passed 9/9, with the WebKit zero-network case
rerun after replacing an unbounded service-worker readiness wait. The desktop CDP attachment
happens after first paint, so the initial application
asset requests are not captured; those resources are same-origin by construction. The separate
Windows process-tree watch is required once per release to cover WebView2 activity outside CDP.
