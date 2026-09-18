# Releasing Orbit

One checklist, in order. A release is a git tag; the Release workflow does the building,
signing, and attaching, and leaves a **draft** on GitHub for you to read and publish.

## Channels

| Tag              | Marked as   | Installers | When                         |
| ---------------- | ----------- | ---------- | ---------------------------- |
| `v0.1.0-alpha.N` | pre-release | NSIS       | trying things out            |
| `v0.1.0-beta.N`  | pre-release | NSIS       | ready for the trusted circle |
| `v1.0.0`         | release     | NSIS       | stable                       |

MSI is deferred until its installer cleanup and upgrade behaviour has its own release gate.

**Builds are unsigned by decision** (week 9): Orbit is for its author and people who trust
them, so a code-signing certificate is not worth its cost yet. Windows shows a SmartScreen
"unknown publisher" warning on first run — _More info → Run anyway_ — and the release notes
say so. The workflow still knows how to sign (see the last section) should that change.

## Before tagging

1. **Green on `main`.** `pnpm format && pnpm lint && pnpm type-check && pnpm test:coverage`,
   then `pnpm --filter orbit run build && pnpm check:bundle && pnpm exec playwright test`.
   From PowerShell: `cargo fmt --check`, `cargo clippy -- -D warnings` in `apps/orbit/src-tauri`.
2. **Schema bumped?** If a store or a migration changed this cycle: `pnpm run make:fixture`,
   commit the new fixture files (never edit or delete old versions), and `pnpm run test:migrations`
   must pass every path (IndexedDB v1→current, SQLite v1→current, every export version).
3. **Data safety.** `pnpm run verify:backup` and `pnpm run test:roundtrip` pass.
4. **Benchmarks.** `pnpm run bench` stays inside the baseline (`bench/baseline.json`).
5. **Desktop e2e.** From the user's external, **non-elevated** PowerShell terminal, build the
   exact candidate with `pnpm run tauri:build:bin`, then run `pnpm run e2e:desktop` and
   `pnpm run e2e:desktop:cold`. The cold suite includes the 50k startup, scheduled backup,
   CSP, and zero-network checks. Both harnesses attach to WebView2 through the
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` override, which WebView2 ignores when the host
   process is elevated: Orbit starts normally, no debug port opens, and every launch times out
   with `could not attach over CDP`. The cold harness refuses to start in an Administrator shell;
   `tests/e2e/desktop/probe-launch.ps1` shows the browser command line if it ever recurs.
6. **Docs.** The week's task docs are updated; `docs/HOSTING.md` and `SETUP.md` still describe
   what ships. Re-read `docs/SECURITY.md` and `docs/PRIVACY.md`; attach the dependency-audit
   and zero-network evidence under `docs/testing/release-1.0/`.

## Cut the release

7. **Bump** every version file together:

   ```bash
   pnpm run bump -- 1.0.0
   ```

   (`package.json` ×2, `tauri.conf.json`, `Cargo.toml`.)

8. **Changelog.** Insert the section for the tag from the Conventional Commits since the last tag,
   then edit it by hand — the generator gives the skeleton, the notes say what changed for a user:

   ```bash
   pnpm run changelog:release -- v1.0.0
   ```

   Fold anything under `[Unreleased]` into the new section and delete the empty heading.

9. **Commit and tag:**

   ```bash
   git commit -am "chore: release v1.0.0"
   git tag v1.0.0
   git push && git push --tags
   ```

## While the workflow runs (about 15 minutes)

10. Watch **Actions → Release**. It builds the shell on `windows-latest`, signs `orbit.exe` and each
    installer through `trusted-signing-cli` when the secrets are present, verifies every signature
    with `Get-AuthenticodeSignature` (the job fails if one is not `Valid`), zips the PWA build,
    writes `SHA256SUMS.txt`, and edits the draft release body with the changelog section plus
    install notes.

## Verify the draft

11. Open the draft release. Attached: `Orbit_<version>_x64-setup.exe`,
    `orbit-pwa-<tag>.zip`, `SHA256SUMS.txt`.
12. **Installed pass.** Open `tests/installed/orbit-sandbox.wsb`, follow
    `tests/installed/CHECKLIST.md`, run `checks.ps1` inside Sandbox, and copy evidence to the
    mapped folder before closing it. Expect the SmartScreen warning because builds are unsigned.
    Run the three reboot/sleep cases under the disposable `OrbitTest` host account.
13. **Install check.** Record every scenario PASS, FAIL, or NOT RUN. First run creates
    `%APPDATA%\app.orbit.desktop\data\orbit.db`; Settings → Data reports integrity ok. Do not
    publish while an installed release gate is NOT RUN.
14. **PWA check.** Unzip the bundle, serve it (`npx serve dist` or any static server), open it,
    confirm the install prompt and that it works offline after the first load.
15. **Checksums.** `Get-FileHash` on a downloaded file matches `SHA256SUMS.txt`.
16. Read the release notes once more; fix wording in the draft if needed (and in `CHANGELOG.md`
    with a follow-up `docs:` commit).

## Publish

17. Publish the draft. Pre-release tags stay marked as pre-release.
18. Announce: link the release, paste the "Added" bullets, say which channel it is.

## If signing is ever wanted

Skipped for now by decision. Should Orbit go to strangers, Azure Trusted Signing is the route
(about $10 a month, no hardware token, works in CI, earns SmartScreen reputation over time;
an OV certificate ships on a token now and is awkward in CI; self-signed does nothing for
SmartScreen). The workflow switches signing on by itself when the `AZURE_CLIENT_ID` secret
exists and verifies every signature; nothing in the code needs to change:

1. Azure account → **Trusted Signing** resource → submit **identity validation** (this is the
   slow part; days). Then create a **certificate profile** (public trust).
2. An **app registration** with a client secret, given the _Trusted Signing Certificate Profile
   Signer_ role on the account.
3. Repository secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
   `AZURE_ENDPOINT` (for example `https://weu.codesigning.azure.net`), `AZURE_ACCOUNT` (the
   Trusted Signing account name), `AZURE_PROFILE` (the certificate profile name).
4. Dry run: push a `-beta.0` tag, confirm the **Verify signatures** step passes and the Digital
   Signatures tab on the downloaded installer lists your name. Delete the draft afterwards.

Local builds never sign (`bundle.windows.signCommand` is passed only in CI as a `--config`
overlay). `pnpm run tauri:build` on a pre-release version fails at the MSI step by design; use
`pnpm run tauri:build:bin` for the binary or `pnpm run tauri build -- --bundles nsis`.

## If something goes wrong

- **Workflow failed before the draft existed:** fix, delete the tag locally and remotely
  (`git tag -d v… && git push origin :refs/tags/v…`), re-tag the fixed commit.
- **Draft exists but an artifact is wrong:** delete the draft, fix, re-tag.
- **Published by mistake:** un-publish is not possible; publish a `.N+1` with the fix and mark
  the bad one as pre-release with a note.
