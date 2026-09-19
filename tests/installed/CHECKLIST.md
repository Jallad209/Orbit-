# Orbit 1.0 installed-build checklist

Sandbox pass run 19 September 2026 against `Orbit_0.1.0-alpha.2_x64-setup.exe` (SHA-256
`AF05DA3BCE43DEFC8B1B89BAE7845F02DAEB3D5CF413AC8FAB0C26AA58441991`, source tree `1a2dc6a`); evidence
in `docs/testing/release-1.0/installed/`. Scenarios 12–14 still need the host account.

Run only in Windows Sandbox or the disposable `OrbitTest` host account. Record PASS, FAIL, or
NOT RUN; never convert a missing environment into PASS. Candidate hashes belong in
`C:\OrbitHarness\evidence\candidate.json`.

## Sandbox scenarios

|   # | Scenario                                                                                                      | Result                                                                          | Required evidence                                                           |
| --: | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
|   1 | Fresh silent NSIS install; product name/icon and executable are correct                                       | PASS                                                                            | `installed-state.json`, Apps screenshot                                     |
|   2 | Foreign `orbit://` handler survives install and Orbit reports that it is not owner                            | FAIL on alpha.2 (installer PASS; app status implemented afterwards — re-verify) | `foreign-handler-before-install.json`, registry export, Settings screenshot |
|   3 | Owned protocol command is exactly quoted and dispatches the exact task/bill/commitment while Orbit is visible | PASS                                                                            | registry export, three destination screenshots, one-process count           |
|   4 | Protocol/notification click while hidden restores the existing main window and exact record                   | PASS                                                                            | process count, destination screenshot                                       |
|   5 | Protocol/notification click while exited cold-starts exactly one process and opens the exact current record   | PASS                                                                            | process count, destination screenshot, shell log                            |
|   6 | Duplicate manual launch activates the existing installed instance                                             | PASS                                                                            | before/after process counts and focused-window screenshot                   |
|   7 | Forced termination produces exactly one honest unclean-run report after relaunch                              | PASS                                                                            | `last-run.json`, recovery screenshot                                        |
|   8 | Candidate A → B upgrade preserves data, protocol ownership, login opt-in, and refreshes executable targets    | PASS                                                                            | both hashes, before/after registry exports, data counts                     |
|   9 | Uninstall removes only Orbit-owned protocol/login keys and preserves data/backups; a foreign handler remains  | PASS                                                                            | `after-uninstall.json`, registry exports, data-folder listing               |
|  10 | Notification submission failure stays retryable; Focus Assist suppression is described honestly               | PASS                                                                            | reminder row/log and Windows Settings screenshots                           |
|  11 | Installed notifications carry the Orbit name and icon                                                         | PASS                                                                            | notification-centre screenshot                                              |

Use `checks.ps1 -Action snapshot`, `-Action foreign-handler`, `-Action protocol
-ExpectedRecordUri orbit://task/<uuid>`, and `-Action uninstall-snapshot` to capture the
automatable portions. Copy screenshots and redacted logs into `C:\OrbitHarness\evidence` (mapped
to `tests/installed/evidence` on the host) before closing Sandbox; the session is destroyed on
close.

## Disposable host-account scenarios

These cannot be proved in Sandbox because Sandbox cannot reboot or sleep.

|   # | Scenario                                                                            | Result  | Required evidence                                                 |
| --: | ----------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
|  12 | Enable login launch → reboot → Orbit initializes hidden → due reminder is delivered | NOT RUN | Run key, boot time, process/window state, notification screenshot |
|  13 | Disable login launch → reboot → Orbit does not start                                | NOT RUN | absent Run value and post-boot process query                      |
|  14 | Sleep across a due time → resume → one delivery, no duplicate                       | NOT RUN | sleep/resume times, reminder row/log, notification screenshot     |

After the pass, copy the results into `docs/RESIDENT-BEHAVIOUR.md` and
`docs/testing/release-1.0/REPORT.md`, including candidate commit and SHA-256.
