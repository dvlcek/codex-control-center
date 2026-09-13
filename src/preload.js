const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('codexControl', Object.freeze({
  getSnapshot: () => ipcRenderer.invoke('get-snapshot'),
  windowAction: action => ipcRenderer.invoke('window-action', action),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),
  updateSettings: patch => ipcRenderer.invoke('update-settings', patch),
  selectCodexHome: () => ipcRenderer.invoke('select-codex-home'),
  installVsCodeBridge: () => ipcRenderer.invoke('install-vscode-bridge'),
  uninstallVsCodeBridge: () => ipcRenderer.invoke('uninstall-vscode-bridge'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  openCodex: () => ipcRenderer.invoke('open-codex'),
  copyLastOutput: () => ipcRenderer.invoke('copy-last-output'),
  copyChanges: () => ipcRenderer.invoke('copy-changes'),
  submitPrompt: prompt => ipcRenderer.invoke('submit-prompt', prompt),
  clearQueue: () => ipcRenderer.invoke('clear-queue'),
  onSnapshot: callback => on('snapshot', callback),
  onQueueChanged: callback => on('queue-changed', callback),
  onSendError: callback => on('send-error', callback),
  onPinState: callback => on('pin-state', callback),
  onCompactState: callback => on('compact-state', callback)
}));
