fn main() {
    use tauri_build::{AppManifest, Attributes};

    // Keep this list in sync with `generate_handler!` in src/lib.rs. Declaring an app
    // manifest makes Tauri enforce ACL permissions for local custom-command calls.
    const COMMANDS: &[&str] = &[
        "db_open",
        "db_close",
        "db_execute",
        "db_select",
        "db_exec",
        "db_begin",
        "db_finish",
        "data_dir_get",
        "data_dir_set",
        "data_dir_relocate",
        "data_dir_default",
        "data_dir_reveal",
        "data_backups",
        "data_backup_now",
        "data_quarantine",
        "data_restore",
        "data_restore_backup",
        "file_read_text",
        "file_write_text",
        "capture_show",
        "capture_hide",
        "diagnostics_last_run",
        "diagnostics_integrity",
        "diagnostics_log",
        "diagnostics_export",
        "prefs_get",
        "prefs_set",
        "prefs_migrate_legacy",
        "autostart_get",
        "autostart_set",
        "resident_status",
        "resident_ready",
        "resident_show_main",
        "resident_hide_main",
        "resident_quit",
        "resident_quit_ack",
        "resident_capture_subscribed",
        "resident_activation_pending",
        "resident_activation_subscribed",
        "resident_activation_unsubscribed",
        "scheduler_wake",
    ];

    tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(COMMANDS)))
        .expect("failed to build Tauri ACL manifest")
}
