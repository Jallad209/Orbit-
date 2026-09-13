# Releasing Orbit

One checklist, in order. A release is a git tag; the Release workflow does the building,
signing, and attaching, and leaves a **draft** on GitHub for you to read and publish.

## Channels

| Tag              | Marked as   | Installers | Signed                      | When                                  |
| ---------------- | ----------- | ---------- | --------------------------- | ------------------------------------- |
| `v0.1.0-alpha.N` | pre-release | NSIS       | no                          | internal builds, before signing works |
| `v0.1.0-beta.N`  | pre-release | NSIS       | yes (Azure Trusted Signing) | public testing                        |
| `v0.1.0`         | release     | NSIS + MSI | yes                         | stable                                |

Any tag with a hyphen is a pre-release and ships NSIS only: the MSI's version field cannot
carry a pre-release identifier. Signing switches on by itself when the `AZURE_CLIENT_ID`
secret exists in the repository; without it the workflow builds unsigned and says so in the
release notes.

## Before tagging

1. **Green on `main`.** `pnpm format && pnpm lint && pnpm type-check && pnpm test:coverage`,
   then `pnpm --filter orbit run build && pnpm check:bundle && pnpm exec playwright test`.
   From PowerShell: `cargo fmt --check`, `cargo clippy -- -D warnings` in `apps/orbit/src-tauri`.
2. **Schema bumped?** If a store or a migration changed this cycle: `pnpm run make:fixture`,
   commit the new fixture files (never edit or delete old versions), and `pnpm run test:migrations`
   must pass every path (IndexedDB v1→current, SQLite v1→current, every export version).
3. **Data safety.** `pnpm run verify:backup` and `pnpm run test:roundtrip` pass.
4. **Benchmarks.** `pnpm run bench` stays inside the baseline (`bench/baseline.json`).
5. **Desktop e2e.** `pnpm run tauri:build:bin && pnpm run e2e:desktop` (PowerShell).
6. **Docs.** The week's task docs are updated; `docs/HOSTING.md` and `SETUP.md` still describe
   what ships.

## Cut the release

7. **Bump** every version file together:

   ```bash
   pnpm run bump -- 0.1.0-beta.1
   ```

   (`package.json` ×2, `tauri.conf.json`, `Cargo.toml`.)

8. **Changelog.** Insert the section for the tag from the Conventional Commits since the last tag,
   then edit it by hand — the generator gives the skeleton, the notes say what changed for a user:

   ```bash
   pnpm run changelog:release -- v0.1.0-beta.1
   ```

   Fold anything under `[Unreleased]` into the new section and delete the empty heading.

9. **Commit and tag:**

   ```bash
   git commit -am "chore: release v0.1.0-beta.1"
   git tag v0.1.0-beta.1
   git push && git push --tags
   ```

## While the workflow runs (about 15 minutes)

10. Watch **Actions → Release**. It builds the shell on `windows-latest`, signs `orbit.exe` and each
    installer through `trusted-signing-cli` when the secrets are present, verifies every signature
    with `Get-AuthenticodeSignature` (the job fails if one is not `Valid`), zips the PWA build,
    writes `SHA256SUMS.txt`, and edits the draft release body with the changelog section plus
    install notes.

## Verify the draft

11. Open the draft release. Attached: `Orbit_<version>_x64-setup.exe` (and the `.msi` on a stable
    tag), `orbit-pwa-<tag>.zip`, `SHA256SUMS.txt`.
12. **Signature check on a machine that has never seen Orbit** (a clean VM is best): download the
    installer, right-click → Properties → **Digital Signatures**. The signer must be your Trusted
    Signing identity and the status "This digital signature is OK". Run it: no SmartScreen
    "unknown publisher" warning. Note that a brand-new certificate can still trigger SmartScreen
    until it has reputation; that clears with downloads, not with configuration.
13. **Install check.** First run creates the data folder (`%APPDATA%\app.orbit.desktop\data`) with
    `orbit.db`; Settings → Data shows the integrity check as ok.
14. **PWA check.** Unzip the bundle, serve it (`npx serve dist` or any static server), open it,
    confirm the install prompt and that it works offline after the first load.
15. **Checksums.** `Get-FileHash` on a downloaded file matches `SHA256SUMS.txt`.
16. Read the release notes once more; fix wording in the draft if needed (and in `CHANGELOG.md`
    with a follow-up `docs:` commit).

## Publish

17. Publish the draft. Pre-release tags stay marked as pre-release.
18. Announce: link the release, paste the "Added" bullets, say which channel it is.

## Signing setup (once)

Azure Trusted Signing (recommended over an OV certificate: no hardware token, works in CI,
earns SmartScreen reputation over time):

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
