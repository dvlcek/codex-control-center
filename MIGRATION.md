# Migrating from v0.4

v1.0 is a standalone desktop app. The old VS Code bridge used to start the desktop project automatically with `npm start`; v1.0 intentionally removes that behavior.

## Recommended upgrade

1. Start v1.0 once.
2. Open **Settings → Optional integration**.
3. Choose **Install / update** if you want VS Code integration, or **Remove** if you want standalone mode only.
4. Reload VS Code once.

Installing the v1 bridge removes detected legacy `Codex Overlay Bridge` copies before installing the new bridge. Removing the bridge removes both current and detected legacy bridge copies.

The desktop app can continue to read the old bridge state file during migration, but all new bridge state is written under `~/.codex-control-center/bridge/`.

Old v0.4 window preferences are imported on first run when possible. New preferences are stored in Electron's normal per-user application data directory.
