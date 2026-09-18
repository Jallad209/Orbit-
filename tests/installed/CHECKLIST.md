# Orbit 1.0 installed-build checklist

Run only in Windows Sandbox or the disposable `OrbitTest` host account. Record PASS, FAIL, or
NOT RUN; never convert a missing environment into PASS. Candidate hashes belong in
`C:\OrbitEvidence\candidate.json`.

## Sandbox scenarios

|   # | Scenario                                                                                                      | Result  | Required evidence                                                           |
| --: | ------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
|   1 | Fresh silent NSIS install; product name/icon and executable are correct                                       | NOT RUN | `installed-state.json`, Apps screenshot                                     |
|   2 | Foreign `orbit://` handler survives install and Orbit reports that it is not owner                            | NOT RUN | `foreign-handler-before-install.json`, registry export, Settings screenshot |
|   3 | Owned protocol command is exactly quoted and dispatches the exact task/bill/commitment while Orbit is visible | NOT RUN | registry export, three destination screenshots, one-process count           |
|   4 | Protocol/notification click while hidden restores the existing main window and exact record                   | NOT RUN | process count, destination screenshot                                       |
|   5 | Protocol/notification click while exited cold-starts exactly one process and opens the exact current record   | NOT RUN | process count, destination screenshot, shell log                            |
|   6 | Duplicate manual launch activates the existing installed instance                                             | NOT RUN | before/after process counts and focused-window screenshot                   |
|   7 | Forced termination produces exactly one honest unclean-run report after relaunch                              | NOT RUN | `last-run.json`, recovery screenshot                                        |
|   8 | Candidate A → B upgrade preserves data, protocol ownership, login opt-in, and refreshes executable targets    | NOT RUN | both hashes, before/after registry exports, data counts                     |
|   9 | Uninstall removes only Orbit-owned protocol/login keys and preserves data/backups; a foreign handler remains  | NOT RUN | `after-uninstall.json`, registry exports, data-folder listing               |
|  10 | Notification submission failure stays retryable; Focus Assist suppression is described honestly               | NOT RUN | reminder row/log and Windows Settings screenshots                           |
|  11 | Installed notifications carry the Orbit name and icon                                                         | NOT RUN | notification-centre screenshot                                              |

Use `checks.ps1 -Action snapshot`, `-Action foreign-handler`, `-Action protocol
-ExpectedRecordUri orbit://task/<uuid>`, and `-Action uninstall-snapshot` to capture the
automatable portions. Copy screenshots and redacted logs into `C:\OrbitEvidence` before closing
Sandbox; the session is destroyed on close.

## Disposable host-account scenarios

These cannot be proved in Sandbox because Sandbox cannot reboot or sleep.

|   # | Scenario                                                                            | Result  | Required evidence                                                 |
| --: | ----------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
|  12 | Enable login launch → reboot → Orbit initializes hidden → due reminder is delivered | NOT RUN | Run key, boot time, process/window state, notification screenshot |
|  13 | Disable login launch → reboot → Orbit does not start                                | NOT RUN | absent Run value and post-boot process query                      |
|  14 | Sleep across a due time → resume → one delivery, no duplicate                       | NOT RUN | sleep/resume times, reminder row/log, notification screenshot     |

After the pass, copy the results into `docs/RESIDENT-BEHAVIOUR.md` and
`docs/testing/release-1.0/REPORT.md`, including candidate commit and SHA-256.
