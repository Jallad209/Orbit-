# Privacy

Orbit has no account, telemetry, analytics, advertising, cloud sync, or automatic update
check. It does not send your records anywhere. The web app contacts only the origin from which
you chose to load it; the desktop app uses local Tauri IPC. A link you explicitly open is handed
to the operating system and may then use your normal browser or mail client.

## Files and storage

- Web records live in that browser profile's IndexedDB. A device-local export watermark and
  session-only banner dismissals live in browser storage.
- Desktop records live in `orbit.db` in the folder you chose. `backups/` contains rotating daily,
  weekly, manual, and before-restore plaintext copies.
- Desktop preferences and bounded, redacted operational logs live in Orbit's app-data folder.
- JSON/Markdown exports and diagnostics bundles go only to a location you select.

None of these files is encrypted by Orbit. Use OS disk encryption and protect exports and
backups as you would the live database. Uninstall does not delete your chosen data folder,
exports, or backups.

## Diagnostics

Orbit creates a diagnostics bundle only when you press **Save diagnostics bundle**. It includes
app/runtime/schema versions, capabilities, storage and integrity outcomes, record counts,
search backend, previous-run status, and redacted error kinds/logs. It excludes titles, note and
journal bodies, names, contacts, queries, SQL, data-folder paths, and export contents. The bundle
is saved locally and is never uploaded automatically.

The optional updater was not selected. Orbit never checks, downloads, or installs an update on
its own.
