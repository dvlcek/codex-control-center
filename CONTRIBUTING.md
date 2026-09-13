# Contributing

Thanks for helping improve Codex Control Center.

## Development

```bash
npm install
npm run verify
npm start
```

Keep changes small and focused. Before opening a pull request, run `npm run verify` and manually test the affected desktop behavior.

## Principles

- Keep the app local-first.
- Do not add analytics or remote data collection without an explicit product decision and clear user consent.
- Keep the VS Code bridge optional.
- Never make an editor extension silently start the desktop app.
- Prefer narrow IPC methods over exposing generic Node/Electron APIs to the renderer.
- Avoid shell interpolation for user-provided text.
