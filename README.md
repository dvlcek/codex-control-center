# Codex Control Center

A small, local-first desktop companion for monitoring Codex sessions while you work.

> Unofficial community project. Not affiliated with, endorsed by, or sponsored by OpenAI.

## What it does

- Shows the latest local Codex task, phase and elapsed time.
- Displays context and rate-limit usage when those values are available in local Codex session logs.
- Shows recent task activity and the last completed response.
- Copies the latest Codex output or the current Git diff.
- Sends a follow-up to the same Codex thread, or queues it until the current turn finishes.
- Supports compact mode and always-on-top mode.
- Lives in the system tray and can be toggled with `Ctrl+Alt+C` (`Cmd+Alt+C` on macOS).
- Can optionally start hidden at login.
- Works without VS Code by reading local Codex session data directly.

## Optional VS Code bridge

The desktop app does **not** require the bridge.

The optional bridge only provides:

- more accurate workspace matching;
- the active filename;
- the **Open Codex** button.

The bridge **never starts the desktop app automatically**. Install or remove it from **Settings → Optional integration**. After installing or removing it, reload VS Code once.

## Install for normal users

Download the build for your platform from GitHub Releases.

### Windows

Use the NSIS installer for a normal installation. A portable `.exe` is also produced.

### macOS

Use the `.dmg` build.

### Linux

Use the `.AppImage` build.

The project is currently unsigned. Windows SmartScreen or macOS Gatekeeper may therefore show a warning until official code signing is configured.

## Run from source

Requirements:

- Node.js 24+
- Codex CLI installed and available in `PATH`
- Git, if you want to use **Copy Git changes**

```bash
git clone <your-repository-url>
cd codex-control-center
npm install
npm run verify
npm start
```

## Build locally

```bash
npm install
npm run verify
```

Windows:

```bash
npm run dist:win
```

macOS:

```bash
npm run dist:mac
```

Linux:

```bash
npm run dist:linux
```

Build artifacts are written to `release/`.

## GitHub Releases

The workflow in `.github/workflows/release.yml` builds Windows, macOS and Linux artifacts.

To create a release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build the platform packages and attach them to the GitHub release.

## Local data and privacy

Codex Control Center is local-first. It reads session information from the user's local Codex data directory, normally:

```text
~/.codex
```

The optional VS Code bridge writes a small local workspace-state file under:

```text
~/.codex-control-center/bridge/vscode.json
```

App preferences are stored in Electron's normal per-user application-data directory.

The application does not include analytics, telemetry or a remote backend.

## Settings

The Settings panel includes:

- launch at login;
- completion notifications;
- close-to-tray behavior;
- custom Codex data directory;
- Codex CLI diagnostics;
- optional VS Code bridge installation/removal;
- explicit **Quit Codex Control Center** action.

`Launch at login` is off by default and is only available in packaged Windows/macOS builds.

## Security model

The Electron renderer runs with:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- restrictive Content Security Policy
- a narrow preload IPC API
- denied renderer permission requests
- denied popup windows and non-local navigation

Follow-up prompts are executed through the local Codex CLI. On Windows the prompt is passed to PowerShell through a temporary file rather than interpolated into a shell command.

## Project structure

```text
.
├── assets/                 App icons
├── scripts/
│   ├── runner.ps1          Safe Windows Codex follow-up runner
│   └── verify.js           Source verification
├── src/
│   ├── main.js             Electron main process
│   ├── preload.js          Narrow renderer bridge
│   ├── session-monitor.js  Local Codex session parser
│   └── renderer/           UI
├── vscode-bridge/          Optional VS Code integration
└── .github/workflows/      Cross-platform release build
```

## License

MIT. See `LICENSE`.
