# Dependency audit evidence

Date: 18 September 2026  
Baseline HEAD: `19888d239a355e55489174768d80e114545f42ad`  
State: uncommitted Week 13 working tree on Windows 11 x64

| Gate                                                               | Result                 | Observed                                                                              |
| ------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------- |
| `pnpm audit --prod --audit-level=high`                             | PASS                   | No known production vulnerabilities                                                   |
| `pnpm audit --audit-level=high`                                    | ACCEPTED DEV-ONLY RISK | 5 advisories (3 high, 1 moderate, 1 low), all in the WDIO/Mocha test toolchain; Q-002 |
| `cargo deny --manifest-path apps/orbit/src-tauri/Cargo.toml check` | PASS                   | advisories, bans, licences, and sources all OK                                        |
| `cargo audit --file apps/orbit/src-tauri/Cargo.lock`               | PASS WITH WARNINGS     | No vulnerabilities; 7 allowed warnings listed below                                   |
| CI audit job                                                       | NOT RUN                | Workflow implemented; requires a pushed commit/CI run                                 |

`deny.toml` evaluates the Windows MSVC graph and rejects HTTP/TLS client crates including
`reqwest`, `hyper`, `ureq`, `curl`, OpenSSL, native-tls, rustls, and ring. Cargo's Windows graph
contains none of them. The lockfile can still mention target-specific crates that are not
compiled into the Windows application.

Five RustSec “unmaintained” notices are explicitly accepted for the `rust-unic` family pulled
through `Tauri 2.11.5 → tauri-utils → urlpattern`. RustSec reports no safe compatible upgrade.
Each advisory ID and the reason are pinned in `deny.toml`; this is visible debt, not a claim that
the advisories do not exist. The dependency job runs nightly so a patched path or new advisory
is surfaced without waiting for a code change.

`cargo audit` reported no vulnerabilities and these seven warnings:

- `RUSTSEC-2024-0370`, unmaintained `proc-macro-error`;
- `RUSTSEC-2024-0429`, unsound `glib` iteration in the full lockfile's target-specific graph;
- `RUSTSEC-2025-0075`, `-0080`, `-0081`, `-0098`, and `-0100`, the five unmaintained
  `rust-unic` crates accepted in `deny.toml`.

The full JavaScript audit remains non-zero by design under Q-002. `serialize-javascript@6.0.2`
is reached through `@wdio/mocha-framework → mocha` (`GHSA-5c6j-r48x-rmvq`). `extract-zip` is
reached through the WDIO/Puppeteer browser tooling and has two high-severity advisories
(`GHSA-jmr9-qjv8-65gv`, `GHSA-7pqw-9j4j-h8q3`) with no patched version reported by pnpm. None
of these packages are present in the production dependency tree, which is why the production
audit is blocking while the full audit is retained as a report and tracked debt.
