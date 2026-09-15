# Cold activation loss — mechanism evidence

Real release binary `orbit.exe` sha256 `6f4405cf…b8e207` (built this session from the working
tree at HEAD 68982ff + uncommitted Week-12 activation work). Isolated per launch: throwaway
`ORBIT_DATA_DIR`, throwaway `WEBVIEW2_USER_DATA_FOLDER`, fake autostart file. Driven directly
(argv passed verbatim) over WebView2 CDP; see `tests/campaign/desktop/coldLaunch.ts`.

## Reproduction rates (each launch: fresh install → finish first run → relaunch cold with a URI)

| Harness                                                     | Opened target | Lost (→ /today)                      |
| ----------------------------------------------------------- | ------------- | ------------------------------------ |
| race, session reused, no wait (`cold-activation-race`, 20×) | 17            | 3 (runs 7, 11, 14, 19 across passes) |
| race, wait-for-exit (`cold-activation-race`, 20×)           | 17            | 3                                    |
| fully isolated per launch (`cold-activation-isolated`, 12×) | 11            | 1 (run 6)                            |

A loss is not a reuse/profile artifact: it survives full per-launch isolation and a
wait-for-process-exit barrier.

## The two sequences (shell log, one JSON object per line)

Delivered (normal):

```
op=start   process
op=launch  resident  {"launch":"activate"}
op=activate resident {"kind":"bill","queued":true}      <- phase Booting, URI QUEUED
op=open    db
op=ready   resident  {"queuedActivation":1,...}          <- drains queue, emits orbit:activate
op=app:activation:open webview                            <- frontend received it
```

Lost:

```
op=start   process
op=launch  resident  {"launch":"activate"}
op=activate resident {"kind":"bill","queued":false}      <- phase ALREADY Ready, emitted at once
op=ready   resident  {"queuedActivation":0,...}          <- nothing to drain
(no app:activation:open — the frontend never received it)
```

## Interpretation

`resident::apply_launch_policy` runs `activate()` at the end of Tauri `setup()`. On a fast
boot the frontend can reach `mark_ready` (DB open + reminder reconcile + `resident_ready`)
_before_ `setup()` gets to `apply_launch_policy`. When it does, `activate()` observes
`phase == Ready` and takes the immediate branch: a single fire-and-forget
`emit_to(MAIN_WINDOW, "orbit:activate", uri)` with no queue and no replay. That emit races
the main window's `orbit:activate` listener registration in `ResidentBridge`, and when it
loses the race the activation is dropped silently — Orbit opens on Today instead of the
record the notification named. The queued path is safe only because `mark_ready` emits the
drained queue after readiness, by which time the listener is reliably attached.
