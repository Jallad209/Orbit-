# Security

## Threat model

Orbit is a single-user, offline application with no account and no server. It protects one
local user's records from accidental loss, untrusted web content, and privilege crossing
between its main and Quick Capture windows. It does not claim to protect an unlocked Windows
account from its owner, malware running as that user, or someone who can read the disk.

## Data at rest

The SQLite data file, its `backups/` directory, browser IndexedDB, exports, preferences, and
diagnostics files are plaintext. Database encryption is not selected for 1.0: Orbit relies on
OS full-disk encryption such as BitLocker and preserves portable, independently verifiable
SQLite backups. Export files must be protected like the original data. Desktop logs are
bounded and their writer redacts string content; diagnostics reports contain counts and
outcomes, never record bodies or paths.

## Desktop isolation

Tauri's application manifest declares every custom command, which turns ACL enforcement on
for local app commands. `capabilities/main.json` grants the main window the data, settings,
backup, diagnostics, and lifecycle commands it uses. `capabilities/capture.json` grants Quick
Capture only repository access, the recovery commands required when it opens the database
first, diagnostics logging, scheduler wakeup, dragging, and capture/quit acknowledgements.
It cannot write arbitrary files, restore a selected backup, change the data directory, export
diagnostics, change native preferences, or quit the process.

No HTTP or shell plugin is exposed. File reads and writes are main-window commands whose paths
come from native open/save dialogs. External `http`, `https`, and `mailto` links are validated
and require a user action before Orbit hands them to the OS.

## Content security policy

The desktop response policy is:

```text
default-src 'self' ipc: http://ipc.localhost; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; media-src 'none'
```

The web build injects the same policy without the two IPC sources. Hosts should add
`frame-ancestors 'none'` as an HTTP response header. Inline script is forbidden. Inline style
remains allowed because Radix's scroll-lock implementation creates a runtime style element;
bundled fonts and user-created local image blobs require the listed data/blob sources.

## Network and dependencies

Orbit has no network feature and no updater. The PWA service worker reads the origin hosting
the app; desktop IPC is local. Opening an external link is a deliberate OS hand-off, not an
in-app fetch. Dependency audits and the recorded browser/desktop zero-network walks are release
gates; their evidence belongs under `docs/testing/release-1.0/`.

The Windows dependency policy in `deny.toml` rejects HTTP and TLS client crates from the
compiled graph and allowlists licences and registries. Five unmaintained `rust-unic` advisories
are accepted with pinned reasons because they arrive through Tauri 2.11.5's `urlpattern`
dependency and RustSec offers no safe compatible upgrade. They remain visible in every audit and
must be removed when Tauri supplies a replacement.

The production JavaScript tree has no known high-severity advisory. The full development tree
has the accepted Q-002 advisories in WDIO/Mocha (`extract-zip` and `serialize-javascript`),
including two `extract-zip` advisories for which pnpm reports no patched version. Those packages
are test tooling and are not bundled into Orbit. CI therefore blocks on the production audit,
publishes the full audit as evidence, and rechecks both nightly.

## Distribution and reporting

Current NSIS builds are unsigned by decision, so Windows can show an unknown-publisher warning.
MSI is not a 1.0 target; it needs its own cleanup verification before returning. Report a
suspected vulnerability privately to the repository owner with the Orbit version, runtime,
reproduction steps, and a redacted diagnostics bundle. Do not include a real data file or
unencrypted export unless the owner explicitly requests and provides a safe channel.
