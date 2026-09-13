# Changelog

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
