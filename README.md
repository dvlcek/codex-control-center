# Codex Control Center

**A lightweight desktop companion for OpenAI Codex.**

Monitor your active Codex session, context usage, recent activity and output without constantly switching windows.

> Unofficial community project. Not affiliated with, endorsed by, or sponsored by OpenAI.

## Download

### [Download the latest release](../../releases/latest)

**Windows**

* **Setup `.exe`** — recommended for most users
* **Portable `.exe`** — run without installation

The application is currently unsigned, so Windows SmartScreen may display an **Unknown publisher** warning.

---

## Why Codex Control Center?

Codex works well inside your development workflow, but it can be difficult to see what is happening while a task is running.

Codex Control Center gives you a small desktop window that stays out of the way while showing the information you actually need.

It can sit next to VS Code, Cursor, your browser, terminal, or any other development environment.

---

## Features

* Monitor the latest local Codex task
* See the current task phase and elapsed time
* Monitor context usage when available
* View rate-limit information when available
* See recent Codex activity
* View the latest completed response
* Copy the latest Codex output
* Copy the current Git diff
* Send a follow-up to the same Codex thread
* Queue follow-ups while Codex is still working
* Compact mode
* Always-on-top mode
* System tray support
* Optional launch at login
* Completion notifications
* Custom Codex data directory
* Optional VS Code integration
* No account required
* No telemetry
* No cloud backend

---

## Quick controls

| Action                     | Shortcut         |
| -------------------------- | ---------------- |
| Show / hide Control Center | `Ctrl + Alt + C` |
| Show / hide on macOS       | `Cmd + Alt + C`  |

You can also control the app from the system tray.

---

## Local-first

Codex Control Center is designed to work locally.

The application reads Codex session information from the local Codex data directory, normally:

```text
~/.codex
```

There is:

* no analytics;
* no telemetry;
* no remote database;
* no Codex session upload;
* no Codex account login handled by this app.

Your Codex data stays on your machine.

---

## Optional VS Code integration

**VS Code is not required.**

Codex Control Center can monitor Codex directly from local session data.

The optional VS Code bridge adds:

* more accurate workspace detection;
* active filename information;
* the **Open Codex** action.

You can install or remove it directly from:

```text
Settings → Optional integration
```

The bridge **does not automatically start Codex Control Center when VS Code starts.**

After installing or removing the bridge, reload VS Code once.

---

## Installation

### Windows

Go to:

**[Latest Release](../../releases/latest)**

Download either:

```text
Codex-Control-Center-Setup-*.exe
```

for a normal installation, or:

```text
Codex-Control-Center-*-portable.exe
```

for the portable version.

The Setup version is recommended for most users.

### macOS

When a macOS build is available, use the `.dmg` package from GitHub Releases.

### Linux

When a Linux build is available, use the `.AppImage` package from GitHub Releases.

> Builds are currently unsigned. Windows SmartScreen or macOS Gatekeeper may therefore display a warning.

---

## Settings

Codex Control Center includes settings for:

* Launch at login
* Completion notifications
* Close to tray
* Custom Codex data directory
* Codex CLI diagnostics
* Optional VS Code bridge
* Quit Codex Control Center

**Launch at login is disabled by default.**

---

## Run from source

### Requirements

* Node.js 24+
* Codex CLI installed
* Git for Git-related functionality

Clone the repository:

```bash
git clone https://github.com/dvlcek/codex-control-center.git
cd codex-control-center
```

Install dependencies:

```bash
npm install
```

Verify the project:

```bash
npm run verify
```

Start the application:

```bash
npm start
```

---

## Build

Install dependencies first:

```bash
npm install
npm run verify
```

### Windows

```bash
npm run dist:win
```

### macOS

```bash
npm run dist:mac
```

### Linux

```bash
npm run dist:linux
```

Build artifacts are written to:

```text
release/
```

---

## GitHub Releases

The repository includes a GitHub Actions release workflow under:

```text
.github/workflows/release.yml
```

To create a release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The release workflow can build platform packages and attach them to the GitHub Release.

---

## Privacy

The optional VS Code bridge stores a small workspace-state file locally under:

```text
~/.codex-control-center/bridge/vscode.json
```

Application preferences are stored using Electron's standard per-user application data directory.

Codex Control Center does not include its own remote backend.

---

## Security

The Electron renderer uses:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
```

The application also uses:

* a restrictive Content Security Policy;
* a narrow preload IPC interface;
* denied renderer permission requests;
* blocked popup windows;
* blocked non-local renderer navigation.

Follow-up prompts are executed through the locally installed Codex CLI.

On Windows, prompts are passed to PowerShell through a temporary file instead of being interpolated directly into a shell command.

For security issues, see [`SECURITY.md`](SECURITY.md).

---

## Project structure

```text
.
├── assets/
├── scripts/
│   ├── runner.ps1
│   └── verify.js
│
├── src/
│   ├── main.js
│   ├── preload.js
│   ├── session-monitor.js
│   └── renderer/
│
├── vscode-bridge/
├── .github/
│   └── workflows/
│
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

---

## Contributing

Contributions, bug reports and feature suggestions are welcome.

If you find a bug, open an issue with:

* your operating system;
* Codex Control Center version;
* what you expected to happen;
* what actually happened;
* reproduction steps where possible.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for more information.

---

## Disclaimer

Codex Control Center is an independent open-source community project.

It is **not an official OpenAI product** and is not affiliated with, endorsed by, or sponsored by OpenAI.

Codex and OpenAI are trademarks of their respective owners.

---

## License

Released under the [MIT License](LICENSE).
