# Changelog

## 1.0.1

- Fixed session status flickering between running, done and interrupted states.
- Terminal events now affect only the Codex turn they belong to by matching `turn_id`.
- Delayed completion/abort events from older turns can no longer overwrite a newer active turn.
- Late `response_item` records can no longer replace a final Done/Interrupted/Failed phase.
- Candidate session mtimes are refreshed on every monitor tick so the active session switches cleanly without stale 5-second windows.
- Added regression tests for Codex turn lifecycle parsing.
- Renamed the interrupted status label from `STOPPED` to `INTERRUPTED` for clarity.
- Fixed Windows packaging so Setup and Portable builds use distinct filenames.
- Cleaned GitHub Releases so only user-facing installers/packages are attached.

## 1.0.0

- Converted the project from a VS Code-started helper into a standalone desktop application.
- Removed the bridge's automatic desktop-app startup behavior.
- Added system tray controls and an explicit Quit action.
- Added Settings with launch-at-login, notifications, close-to-tray and Codex data-folder controls.
- Added optional in-app VS Code bridge installation/removal.
- Moved app settings to Electron's per-user application data directory.
- Kept backward-compatible reading of the old bridge state during migration.
- Updated clipboard handling for Electron 44's asynchronous clipboard API.
- Added a restrictive CSP, permission denial, popup denial and narrow preload IPC surface.
- Added Windows, macOS and Linux electron-builder targets.
- Added GitHub Actions release automation.
- Added application icons, MIT license and public-project documentation.
