const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const stateDir = path.join(os.homedir(), '.codex-control-center', 'bridge');
const stateFile = path.join(stateDir, 'vscode.json');
let heartbeat = null;

function writeSnapshot() {
  const folders = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
  const editor = vscode.window.activeTextEditor;
  const data = {
    updatedAt: Date.now(),
    workspaceName: vscode.workspace.name || (folders[0] ? path.basename(folders[0]) : 'VS Code'),
    workspaceFolders: folders,
    activeFile: editor?.document?.uri?.scheme === 'file' ? editor.document.uri.fsPath : '',
    languageId: editor?.document?.languageId || '',
    windowFocused: vscode.window.state.focused,
    remoteName: vscode.env.remoteName || null,
    vscodeVersion: vscode.version
  };

  fs.mkdirSync(stateDir, { recursive: true });
  const temp = `${stateFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  try { fs.unlinkSync(stateFile); } catch {}
  fs.renameSync(temp, stateFile);
}

async function openCodex() {
  try {
    await vscode.commands.executeCommand('chatgpt.openSidebar');
    return true;
  } catch (error) {
    vscode.window.showWarningMessage(`Could not open the Codex sidebar: ${error.message}`);
    return false;
  }
}

function activate(context) {
  writeSnapshot();
  heartbeat = setInterval(writeSnapshot, 2000);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(writeSnapshot),
    vscode.window.onDidChangeWindowState(writeSnapshot),
    vscode.workspace.onDidChangeWorkspaceFolders(writeSnapshot),
    vscode.commands.registerCommand('codexControlCenter.openCodex', openCodex),
    vscode.commands.registerCommand('codexControlCenter.refreshBridge', writeSnapshot),
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path === '/open-codex') return openCodex();
        if (uri.path === '/new-chat') return vscode.commands.executeCommand('chatgpt.newChat');
        return undefined;
      }
    })
  );
}

function deactivate() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

module.exports = { activate, deactivate };
