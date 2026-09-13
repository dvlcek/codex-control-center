const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  clipboard,
  Notification,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  dialog,
  session
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { SessionMonitor } = require('./session-monitor');

app.setName('Codex Control Center');

const WINDOW_WIDTH = 430;
const EXPANDED_HEIGHT = 690;
const COMPACT_HEIGHT = 190;
const DEFAULT_HOTKEY = 'CommandOrControl+Alt+C';
const BRIDGE_EXTENSION_ID = 'codexcontrolcenter.codex-control-center-bridge';
const BRIDGE_FOLDER_PREFIX = `${BRIDGE_EXTENSION_ID}-`;

let win = null;
let tray = null;
let monitor = null;
let timer = null;
let runner = null;
let previousStatus = 'idle';
let queuedPrompt = '';
let quitRequested = false;
let settings = null;
let settingsFile = '';
let bridgeStateFile = '';
let legacyBridgeStateFile = '';
let saveTimer = null;

const launchArgs = new Set(process.argv.slice(1));

const DEFAULT_SETTINGS = Object.freeze({
  alwaysOnTop: true,
  compactMode: false,
  notifications: true,
  closeToTray: true,
  launchAtLogin: false,
  codexHome: '',
  windowPosition: null
});

function initializePaths() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  bridgeStateFile = path.join(os.homedir(), '.codex-control-center', 'bridge', 'vscode.json');
  legacyBridgeStateFile = path.join(os.homedir(), '.codex-overlay', 'vscode.json');
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadSettings() {
  const saved = safeReadJson(settingsFile) || {};
  const merged = { ...DEFAULT_SETTINGS, ...saved };

  if (!safeReadJson(settingsFile)) {
    const legacyWindowState = safeReadJson(path.join(os.homedir(), '.codex-overlay', 'window.json'));
    if (legacyWindowState) {
      if (typeof legacyWindowState.alwaysOnTop === 'boolean') merged.alwaysOnTop = legacyWindowState.alwaysOnTop;
      if (typeof legacyWindowState.compactMode === 'boolean') merged.compactMode = legacyWindowState.compactMode;
      if (Number.isFinite(legacyWindowState.bounds?.x) && Number.isFinite(legacyWindowState.bounds?.y)) {
        merged.windowPosition = { x: legacyWindowState.bounds.x, y: legacyWindowState.bounds.y };
      }
    }
  }

  return merged;
}

function saveSettingsNow() {
  if (!settingsFile || !settings) return;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temp = `${settingsFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8');
  try { fs.unlinkSync(settingsFile); } catch {}
  fs.renameSync(temp, settingsFile);
}

function scheduleSettingsSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettingsNow, 180);
}

function persistWindowPosition() {
  if (!win || win.isDestroyed() || !settings) return;
  const { x, y } = win.getBounds();
  settings.windowPosition = { x, y };
  scheduleSettingsSave();
}

function getCodexHome() {
  return settings?.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function createMonitor() {
  monitor = new SessionMonitor({
    codexHome: getCodexHome(),
    bridgeFile: bridgeStateFile,
    legacyBridgeFile: legacyBridgeStateFile
  });
}

function applyAlwaysOnTop(enabled, { persist = true } = {}) {
  if (!settings) return false;
  settings.alwaysOnTop = Boolean(enabled);

  if (win && !win.isDestroyed()) {
    if (settings.alwaysOnTop) {
      win.setAlwaysOnTop(true, process.platform === 'win32' ? 'screen-saver' : 'floating');
      try { win.moveTop(); } catch {}
    } else {
      win.setAlwaysOnTop(false);
    }
    win.webContents?.send('pin-state', { pinned: settings.alwaysOnTop });
  }

  if (persist) scheduleSettingsSave();
  rebuildTrayMenu();
  return Boolean(win && !win.isDestroyed() ? win.isAlwaysOnTop() : settings.alwaysOnTop);
}

function applyCompactMode(enabled, { persist = true } = {}) {
  if (!settings) return false;
  settings.compactMode = Boolean(enabled);

  if (win && !win.isDestroyed()) {
    const current = win.getBounds();
    const targetHeight = settings.compactMode ? COMPACT_HEIGHT : EXPANDED_HEIGHT;

    win.setResizable(false);
    if (targetHeight >= current.height) {
      win.setMaximumSize(WINDOW_WIDTH, targetHeight);
      win.setMinimumSize(WINDOW_WIDTH, targetHeight);
    } else {
      win.setMinimumSize(WINDOW_WIDTH, targetHeight);
      win.setMaximumSize(WINDOW_WIDTH, targetHeight);
    }
    win.setBounds({
      x: current.x,
      y: current.y,
      width: WINDOW_WIDTH,
      height: targetHeight
    }, true);

    if (settings.alwaysOnTop) applyAlwaysOnTop(true, { persist: false });
    win.webContents?.send('compact-state', { compact: settings.compactMode });
  }

  if (persist) scheduleSettingsSave();
  rebuildTrayMenu();
  return settings.compactMode;
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  win.show();
  if (settings?.alwaysOnTop) applyAlwaysOnTop(true, { persist: false });
  win.focus();
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else showWindow();
}

function requestQuit() {
  quitRequested = true;
  app.quit();
}

function getAppIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  const image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) return image.resize({ width: 20, height: 20 });

  const fallback = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#12171d"/><path d="M21 10c-1.5-1.8-3.4-2.7-5.8-2.7-4.7 0-8 3.4-8 8.7s3.3 8.7 8 8.7c2.4 0 4.3-.9 5.8-2.7" fill="none" stroke="#f3f6f9" stroke-width="3" stroke-linecap="round"/></svg>'
  )}`;
  return nativeImage.createFromDataURL(fallback);
}

function rebuildTrayMenu() {
  if (!tray || !settings) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Codex Control Center', click: showWindow },
    { label: settings.compactMode ? 'Expand' : 'Compact', click: () => applyCompactMode(!settings.compactMode) },
    { type: 'separator' },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: Boolean(settings.alwaysOnTop),
      click: item => applyAlwaysOnTop(item.checked)
    },
    { type: 'separator' },
    { label: 'Quit', click: requestQuit }
  ]));
}

function createTray() {
  tray = new Tray(getAppIcon());
  tray.setToolTip('Codex Control Center');
  tray.on('click', toggleWindow);
  tray.on('double-click', showWindow);
  rebuildTrayMenu();
}

function createWindow() {
  const targetHeight = settings.compactMode ? COMPACT_HEIGHT : EXPANDED_HEIGHT;
  const pos = settings.windowPosition || {};
  const bounds = {
    ...(Number.isFinite(pos.x) ? { x: pos.x } : {}),
    ...(Number.isFinite(pos.y) ? { y: pos.y } : {}),
    width: WINDOW_WIDTH,
    height: targetHeight
  };

  win = new BrowserWindow({
    ...bounds,
    minWidth: WINDOW_WIDTH,
    maxWidth: WINDOW_WIDTH,
    minHeight: targetHeight,
    maxHeight: targetHeight,
    frame: false,
    transparent: false,
    show: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    backgroundColor: '#0b0e12',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    applyCompactMode(settings.compactMode, { persist: false });
    applyAlwaysOnTop(settings.alwaysOnTop, { persist: false });
    win.webContents.send('compact-state', { compact: settings.compactMode });

    if (launchArgs.has('--hidden') || launchArgs.has('--ensure')) win.hide();
    else showWindow();
  });

  win.on('show', () => {
    if (settings.alwaysOnTop) applyAlwaysOnTop(true, { persist: false });
  });
  win.on('restore', () => {
    if (settings.alwaysOnTop) applyAlwaysOnTop(true, { persist: false });
  });
  win.on('always-on-top-changed', (_event, pinned) => {
    win?.webContents.send('pin-state', { pinned: Boolean(pinned) });
  });
  win.on('move', persistWindowPosition);
  win.on('close', event => {
    persistWindowPosition();
    if (quitRequested) return;
    event.preventDefault();
    if (settings.closeToTray) win.hide();
    else requestQuit();
  });
}

async function notifyDone(snapshot) {
  if (!settings.notifications || !Notification.isSupported()) return;
  const body = snapshot.error || snapshot.lastCompleted?.message || snapshot.title || 'Codex task finished';
  new Notification({
    title: snapshot.status === 'failed' ? 'Codex task failed' : 'Codex task done',
    body: body.slice(0, 180),
    silent: false
  }).show();
}

function getRunnerScript() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'runner.ps1');
  return path.join(__dirname, '..', 'scripts', 'runner.ps1');
}

function findCodexCli() {
  try {
    const resolver = process.platform === 'win32' ? 'where.exe' : 'which';
    const raw = execFileSync(resolver, ['codex'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2500
    });
    return raw.split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
  } catch {
    return '';
  }
}

function runFollowup(snapshot, prompt) {
  return new Promise(resolve => {
    if (!snapshot?.id) return resolve({ ok: false, error: 'No Codex thread is available.' });
    if (runner) return resolve({ ok: false, error: 'A follow-up is already running.' });

    const runDir = snapshot.cwd || snapshot.workspace || process.cwd();
    const tempDir = path.join(os.tmpdir(), 'codex-control-center');
    fs.mkdirSync(tempDir, { recursive: true });
    const promptFile = path.join(tempDir, `prompt-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    fs.writeFileSync(promptFile, prompt, 'utf8');

    const env = {
      ...process.env,
      CCC_THREAD_ID: snapshot.id,
      CCC_PROMPT_FILE: promptFile,
      CCC_CWD: runDir
    };

    let child;
    if (process.platform === 'win32') {
      child = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', getRunnerScript()
      ], { cwd: runDir, env, windowsHide: true });
    } else {
      const codex = findCodexCli() || 'codex';
      child = spawn(codex, ['exec', '--json', 'resume', snapshot.id, prompt], {
        cwd: runDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    }

    runner = child;
    let stderr = '';
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', data => { stderr += data.toString(); });
    child.on('error', err => {
      runner = null;
      try { fs.unlinkSync(promptFile); } catch {}
      resolve({ ok: false, error: err.message });
    });
    child.on('close', code => {
      runner = null;
      try { fs.unlinkSync(promptFile); } catch {}
      resolve(code === 0
        ? { ok: true }
        : { ok: false, error: stderr.trim().slice(-700) || `Codex exited with code ${code}` });
    });
  });
}

async function processQueuedIfReady(snapshot) {
  if (!queuedPrompt || runner || snapshot.status === 'running') return;
  const prompt = queuedPrompt;
  queuedPrompt = '';
  win?.webContents.send('queue-changed', { queuedPrompt: '' });
  const result = await runFollowup(snapshot, prompt);
  if (!result.ok) {
    await clipboard.writeText(prompt);
    win?.webContents.send('send-error', {
      error: `${result.error}\nPrompt copied to clipboard as fallback.`
    });
  }
}

function snapshotForCopy() {
  try { return monitor?.snapshot() || null; } catch { return null; }
}

async function copyLastOutput() {
  const snapshot = snapshotForCopy();
  const text = snapshot?.lastCompleted?.fullMessage
    || snapshot?.lastAgentMessageFull
    || snapshot?.lastCompleted?.message
    || snapshot?.lastAgentMessage
    || '';

  if (!text.trim()) return { ok: false, error: 'No Codex output is available yet.' };
  await clipboard.writeText(text.trim());
  return { ok: true, chars: text.trim().length };
}

function runGit(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 12000
  }).trim();
}

async function buildChangesReport() {
  const snapshot = snapshotForCopy();
  const cwd = snapshot?.cwd || snapshot?.workspace || '';
  if (!cwd) return { ok: false, error: 'No workspace found for this Codex session.' };

  try {
    const root = runGit(cwd, ['rev-parse', '--show-toplevel']);
    const status = runGit(root, ['status', '--short']);
    const unstagedStat = runGit(root, ['diff', '--stat']);
    const stagedStat = runGit(root, ['diff', '--cached', '--stat']);
    const unstagedDiff = runGit(root, ['diff', '--no-ext-diff', '--unified=3']);
    const stagedDiff = runGit(root, ['diff', '--cached', '--no-ext-diff', '--unified=3']);

    if (!status && !unstagedDiff && !stagedDiff) {
      return { ok: false, error: 'Git reports no local changes.' };
    }

    const parts = [
      `PROJECT: ${snapshot?.project || path.basename(root)}`,
      `PATH: ${root}`,
      '',
      'CHANGED FILES',
      status || '(none)',
      '',
      'DIFF STAT',
      [unstagedStat, stagedStat].filter(Boolean).join('\n') || '(no tracked diff stat)',
      '',
      'DIFF',
      [
        unstagedDiff && `--- UNSTAGED ---\n${unstagedDiff}`,
        stagedDiff && `--- STAGED ---\n${stagedDiff}`
      ].filter(Boolean).join('\n\n') || '(only untracked files; contents are not copied automatically)'
    ];

    const text = parts.join('\n').trim();
    await clipboard.writeText(text);
    return { ok: true, chars: text.length, root };
  } catch (err) {
    const detail = err?.stderr?.toString?.().trim() || err.message || 'Git command failed.';
    return { ok: false, error: `Could not read Git changes: ${detail.slice(0, 300)}` };
  }
}

function bridgeExtensionSource() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'vscode-bridge')
    : path.join(__dirname, '..', 'vscode-bridge');
}

function vscodeExtensionRoot() {
  const stable = path.join(os.homedir(), '.vscode', 'extensions');
  const insiders = path.join(os.homedir(), '.vscode-insiders', 'extensions');
  if (fs.existsSync(stable)) return stable;
  if (fs.existsSync(insiders)) return insiders;
  return stable;
}

function bridgeDirectories() {
  const roots = [
    path.join(os.homedir(), '.vscode', 'extensions'),
    path.join(os.homedir(), '.vscode-insiders', 'extensions')
  ];
  const out = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      const pkg = safeReadJson(path.join(full, 'package.json'));
      const isCurrent = name.startsWith(BRIDGE_FOLDER_PREFIX);
      const isLegacy = pkg?.name === 'codex-overlay-bridge' || pkg?.displayName === 'Codex Overlay Bridge';
      if (isCurrent || isLegacy) out.push(full);
    }
  }
  return out;
}

function getBridgeStatus() {
  const dirs = bridgeDirectories();
  let version = '';
  let installed = false;
  let legacyInstalled = false;

  for (const dir of dirs) {
    const pkg = safeReadJson(path.join(dir, 'package.json'));
    if (pkg?.publisher === 'codexcontrolcenter' && pkg?.name === 'codex-control-center-bridge') {
      installed = true;
      version = pkg.version || version;
    } else if (pkg?.name === 'codex-overlay-bridge' || pkg?.displayName === 'Codex Overlay Bridge') {
      legacyInstalled = true;
    }
  }

  return { installed, legacyInstalled, version, locations: dirs };
}

function installVsCodeBridge() {
  const source = bridgeExtensionSource();
  if (!fs.existsSync(path.join(source, 'package.json'))) {
    return { ok: false, error: 'The bundled VS Code bridge is missing.' };
  }

  const pkg = safeReadJson(path.join(source, 'package.json'));
  const version = pkg?.version || app.getVersion();
  const root = vscodeExtensionRoot();
  const target = path.join(root, `${BRIDGE_FOLDER_PREFIX}${version}`);

  try {
    fs.mkdirSync(root, { recursive: true });
    for (const dir of bridgeDirectories()) fs.rmSync(dir, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
    return { ok: true, target, version, restartRequired: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function uninstallVsCodeBridge() {
  try {
    for (const dir of bridgeDirectories()) fs.rmSync(dir, { recursive: true, force: true });
    try { fs.rmSync(bridgeStateFile, { force: true }); } catch {}
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function openCodex() {
  const bridge = getBridgeStatus();
  if (!bridge.installed) {
    return {
      ok: false,
      error: 'Install the optional VS Code bridge in Settings to open the Codex sidebar directly.'
    };
  }

  try {
    await shell.openExternal(`vscode://${BRIDGE_EXTENSION_ID}/open-codex`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not open VS Code: ${err.message}` };
  }
}

function loginItemSupported() {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
}

function applyLaunchAtLogin(enabled) {
  const desired = Boolean(enabled);
  settings.launchAtLogin = desired;

  if (!loginItemSupported()) {
    scheduleSettingsSave();
    return { ok: false, supported: false, enabled: false };
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: desired,
      path: process.execPath,
      args: desired ? ['--hidden'] : []
    });
    const actual = Boolean(app.getLoginItemSettings().openAtLogin);
    settings.launchAtLogin = actual;
    scheduleSettingsSave();
    return { ok: true, supported: true, enabled: actual };
  } catch (err) {
    return { ok: false, supported: true, enabled: false, error: err.message };
  }
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(DEFAULT_HOTKEY, toggleWindow);
  return ok;
}

function publicSettings() {
  return {
    alwaysOnTop: Boolean(settings.alwaysOnTop),
    compactMode: Boolean(settings.compactMode),
    notifications: Boolean(settings.notifications),
    closeToTray: Boolean(settings.closeToTray),
    launchAtLogin: Boolean(settings.launchAtLogin),
    codexHome: settings.codexHome || '',
    defaultCodexHome: path.join(os.homedir(), '.codex'),
    hotkey: DEFAULT_HOTKEY
  };
}

function getDiagnostics() {
  const bridgeState = monitor?.getBridgeState?.() || {};
  const bridgeAlive = bridgeState.updatedAt ? Date.now() - bridgeState.updatedAt < 10000 : false;
  const bridge = getBridgeStatus();
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    codexHome: getCodexHome(),
    codexHomeExists: fs.existsSync(getCodexHome()),
    codexCliPath: findCodexCli(),
    bridgeInstalled: bridge.installed,
    bridgeLegacyInstalled: bridge.legacyInstalled,
    bridgeVersion: bridge.version,
    bridgeAlive,
    loginItemSupported: loginItemSupported(),
    loginItemEnabled: loginItemSupported() ? Boolean(app.getLoginItemSettings().openAtLogin) : false
  };
}

function updateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return publicSettings();

  if (Object.prototype.hasOwnProperty.call(patch, 'alwaysOnTop')) applyAlwaysOnTop(Boolean(patch.alwaysOnTop));
  if (Object.prototype.hasOwnProperty.call(patch, 'compactMode')) applyCompactMode(Boolean(patch.compactMode));
  if (Object.prototype.hasOwnProperty.call(patch, 'notifications')) settings.notifications = Boolean(patch.notifications);
  if (Object.prototype.hasOwnProperty.call(patch, 'closeToTray')) settings.closeToTray = Boolean(patch.closeToTray);
  if (Object.prototype.hasOwnProperty.call(patch, 'launchAtLogin')) applyLaunchAtLogin(Boolean(patch.launchAtLogin));

  if (typeof patch.codexHome === 'string') {
    const value = patch.codexHome.trim();
    if (!value) {
      settings.codexHome = '';
      createMonitor();
    } else {
      const resolved = path.resolve(value);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error('The selected Codex data folder does not exist.');
      }
      settings.codexHome = resolved;
      createMonitor();
    }
  }

  scheduleSettingsSave();
  return publicSettings();
}

async function selectCodexHome() {
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Codex data folder',
    defaultPath: getCodexHome(),
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const selected = result.filePaths[0];
  updateSettings({ codexHome: selected });
  return { ok: true, path: selected };
}

function tick() {
  let snapshot;
  try {
    snapshot = monitor.snapshot();
  } catch (err) {
    snapshot = {
      connected: false,
      status: 'idle',
      phase: 'Monitor error',
      title: err.message,
      usage: {},
      activities: [],
      bridgeAlive: false
    };
  }

  snapshot.queuedPrompt = queuedPrompt;
  snapshot.runnerActive = Boolean(runner);
  snapshot.compactMode = settings.compactMode;
  win?.webContents.send('snapshot', snapshot);

  if (previousStatus === 'running' && snapshot.status !== 'running') notifyDone(snapshot);
  previousStatus = snapshot.status;
  processQueuedIfReady(snapshot);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const args = new Set(commandLine);
    if (args.has('--toggle')) return toggleWindow();
    showWindow();
  });

  app.whenReady().then(() => {
    initializePaths();
    settings = loadSettings();

    if (loginItemSupported()) {
      try { settings.launchAtLogin = Boolean(app.getLoginItemSettings().openAtLogin); } catch {}
    }

    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    createMonitor();
    createWindow();
    createTray();
    registerHotkey();
    tick();
    timer = setInterval(tick, 900);
    saveSettingsNow();
  });
}

app.on('activate', showWindow);
app.on('window-all-closed', () => {
  if (!tray && process.platform !== 'darwin') requestQuit();
});
app.on('before-quit', () => {
  quitRequested = true;
  if (timer) clearInterval(timer);
  if (saveTimer) clearTimeout(saveTimer);
  persistWindowPosition();
  saveSettingsNow();
  globalShortcut.unregisterAll();
});

ipcMain.handle('get-snapshot', () => {
  const snapshot = monitor.snapshot();
  snapshot.queuedPrompt = queuedPrompt;
  snapshot.runnerActive = Boolean(runner);
  snapshot.compactMode = settings.compactMode;
  return snapshot;
});

ipcMain.handle('window-action', (_event, action) => {
  const allowed = new Set([
    'close', 'minimize', 'toggle-pin', 'pin-on', 'pin-off',
    'toggle-compact', 'compact-on', 'compact-off', 'show'
  ]);
  if (!allowed.has(action) || !win) return false;

  if (action === 'close') {
    if (settings.closeToTray) win.hide();
    else requestQuit();
    return true;
  }
  if (action === 'minimize') { win.minimize(); return true; }
  if (action === 'show') { showWindow(); return true; }
  if (action === 'toggle-pin') return applyAlwaysOnTop(!settings.alwaysOnTop);
  if (action === 'pin-on') return applyAlwaysOnTop(true);
  if (action === 'pin-off') return applyAlwaysOnTop(false);
  if (action === 'toggle-compact') return applyCompactMode(!settings.compactMode);
  if (action === 'compact-on') return applyCompactMode(true);
  if (action === 'compact-off') return applyCompactMode(false);
  return false;
});

ipcMain.handle('get-window-state', () => ({
  pinned: Boolean(win && !win.isDestroyed() && win.isAlwaysOnTop()),
  desiredPinned: Boolean(settings.alwaysOnTop),
  compact: Boolean(settings.compactMode)
}));

ipcMain.handle('get-settings', () => publicSettings());
ipcMain.handle('get-diagnostics', () => getDiagnostics());
ipcMain.handle('update-settings', (_event, patch) => updateSettings(patch));
ipcMain.handle('select-codex-home', () => selectCodexHome());
ipcMain.handle('install-vscode-bridge', () => installVsCodeBridge());
ipcMain.handle('uninstall-vscode-bridge', () => uninstallVsCodeBridge());
ipcMain.handle('quit-app', () => { requestQuit(); return true; });
ipcMain.handle('open-codex', () => openCodex());
ipcMain.handle('copy-last-output', () => copyLastOutput());
ipcMain.handle('copy-changes', () => buildChangesReport());

ipcMain.handle('submit-prompt', async (_event, prompt) => {
  const text = String(prompt || '').trim();
  if (!text) return { ok: false, error: 'Prompt is empty.' };
  if (text.length > 100000) return { ok: false, error: 'Prompt is too large.' };

  const snapshot = monitor.snapshot();
  if (snapshot.status === 'running' || runner) {
    queuedPrompt = text;
    return { ok: true, queued: true };
  }

  runFollowup(snapshot, text).then(async result => {
    if (!result.ok) {
      await clipboard.writeText(text);
      win?.webContents.send('send-error', {
        error: `${result.error}\nPrompt copied to clipboard as fallback.`
      });
    }
  });
  return { ok: true, queued: false, started: true };
});

ipcMain.handle('clear-queue', () => {
  queuedPrompt = '';
  return true;
});
