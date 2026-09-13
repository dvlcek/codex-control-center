const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const required = [
  'package.json',
  'LICENSE',
  'README.md',
  'src/main.js',
  'src/preload.js',
  'src/session-monitor.js',
  'src/renderer/index.html',
  'src/renderer/app.js',
  'src/renderer/styles.css',
  'vscode-bridge/package.json',
  'vscode-bridge/extension.js',
  'scripts/runner.ps1',
  'assets/icon.png',
  'assets/icon.ico'
];

for (const rel of required) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) throw new Error(`Missing required file: ${rel}`);
}

for (const rel of [
  'src/main.js',
  'src/preload.js',
  'src/session-monitor.js',
  'src/renderer/app.js',
  'vscode-bridge/extension.js'
]) {
  execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'inherit' });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== '1.0.0') throw new Error('Expected package version 1.0.0');
if (pkg.build?.appId !== 'io.codexcontrolcenter.desktop') throw new Error('Unexpected appId');

console.log('Verification PASS: required files present and JavaScript syntax is valid.');
