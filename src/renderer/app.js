const $ = id => document.getElementById(id);
let latest = null;
let toastTimer = null;
let compactMode = false;
let currentSettings = null;

function fmtNum(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status) {
  const map = { running: 'RUNNING', completed: 'DONE', failed: 'FAILED', interrupted: 'INTERRUPTED', idle: 'IDLE' };
  return map[status] || String(status || 'IDLE').toUpperCase();
}

function clampPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

function usedToLeft(value) {
  const used = clampPct(value);
  return used == null ? null : 100 - used;
}

function showToast(text) {
  if (!text) return;
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4200);
}

function setCompactUI(enabled) {
  compactMode = Boolean(enabled);
  document.body.classList.toggle('compact', compactMode);
  const btn = $('compactBtn');
  btn.classList.toggle('active', compactMode);
  btn.title = compactMode ? 'Expand Control Center' : 'Compact mode';
  btn.setAttribute('aria-pressed', compactMode ? 'true' : 'false');
}

function renderPinState(pinned) {
  const btn = $('pinBtn');
  const active = Boolean(pinned);
  btn.classList.toggle('active', active);
  btn.title = active ? 'Always on top: ON' : 'Always on top: OFF';
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function render(snapshot) {
  latest = snapshot;
  $('projectName').textContent = snapshot.project || 'Codex';
  $('taskTitle').textContent = snapshot.title || 'No active Codex task';
  $('phaseText').textContent = snapshot.runnerActive ? 'Sending follow-up…' : (snapshot.phase || 'Idle');

  const status = snapshot.runnerActive ? 'running' : (snapshot.status || 'idle');
  $('statusPill').className = `status-pill ${status}`;
  $('statusText').textContent = snapshot.runnerActive ? 'SENDING' : statusLabel(status);

  const elapsedMs = status === 'running' && snapshot.startedAt
    ? Date.now() - snapshot.startedAt
    : snapshot.lastCompleted?.durationMs || 0;
  $('elapsed').textContent = fmtDuration(elapsedMs);
  $('liveProgress').className = `live-progress ${status}`;

  $('bridgeState').textContent = snapshot.bridgeAlive ? 'VS CODE LIVE' : 'STANDALONE';
  $('bridgeState').className = `bridge-state ${snapshot.bridgeAlive ? 'online' : ''}`;
  $('activeFile').textContent = snapshot.activeFile ? snapshot.activeFile.split(/[\\/]/).pop() : '';

  const u = snapshot.usage || {};
  const contextUsedPct = u.contextPct == null ? null : clampPct(u.contextPct);
  const contextLeftPct = contextUsedPct == null ? null : usedToLeft(contextUsedPct);
  const primaryLeftPct = u.primaryUsedPct == null ? null : usedToLeft(u.primaryUsedPct);
  const secondaryLeftPct = u.secondaryUsedPct == null ? null : usedToLeft(u.secondaryUsedPct);

  $('contextPct').textContent = contextLeftPct == null ? '—' : String(Math.round(contextLeftPct));
  const barPct = contextLeftPct ?? 0;
  $('contextBar').style.width = `${barPct}%`;
  $('contextBar').className = `progress-bar ${barPct <= 10 ? 'bad' : barPct <= 25 ? 'warn' : ''}`;

  const contextTokenText = (u.contextTokens != null && u.contextWindow != null)
    ? `${fmtNum(u.contextTokens)} / ${fmtNum(u.contextWindow)}`
    : '—';
  $('sessionTokens').textContent = contextTokenText;
  $('contextTokenInline').textContent = contextTokenText;
  $('outputTokens').textContent = fmtNum(u.outputTokens);
  $('primaryLimit').textContent = primaryLeftPct == null ? '—' : `${Math.round(primaryLeftPct)}%`;
  $('secondaryLimit').textContent = secondaryLeftPct == null ? '—' : `${Math.round(secondaryLeftPct)}%`;

  $('compactContext').textContent = contextLeftPct == null ? '—' : `${Math.round(contextLeftPct)}%`;
  $('compact5h').textContent = primaryLeftPct == null ? '—' : `${Math.round(primaryLeftPct)}%`;
  $('compact7d').textContent = secondaryLeftPct == null ? '—' : `${Math.round(secondaryLeftPct)}%`;

  const activity = $('activityList');
  activity.replaceChildren();
  const items = snapshot.activities || [];
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No activity yet';
    activity.appendChild(empty);
  } else {
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'activity-item';
      const dot = document.createElement('span');
      dot.className = 'activity-dot';
      const label = document.createElement('span');
      label.className = 'activity-label';
      label.textContent = item.label;
      const time = document.createElement('span');
      time.className = 'activity-time';
      time.textContent = item.ts ? fmtTime(Date.parse(item.ts)) : '';
      row.append(dot, label, time);
      activity.appendChild(row);
    });
  }

  const result = snapshot.lastCompleted;
  $('resultTime').textContent = result?.completedAt ? fmtTime(result.completedAt) : '—';
  $('resultText').textContent = snapshot.error || result?.error || result?.message || 'Nothing completed in this session yet.';
  $('resultText').className = `result-text ${(snapshot.error || result?.error) ? 'error' : ''}`;

  const queued = Boolean(snapshot.queuedPrompt);
  $('queueBadge').classList.toggle('hidden', !queued);
  $('clearQueueBtn').classList.toggle('hidden', !queued);
  $('sendBtn').textContent = status === 'running' || snapshot.runnerActive ? 'Queue after done' : 'Send follow-up';
  $('sendHint').textContent = queued
    ? 'Your follow-up will run automatically when the current task finishes.'
    : 'If Codex is busy, this will queue automatically.';
}

async function submit() {
  const input = $('promptInput');
  const prompt = input.value.trim();
  if (!prompt) return;
  $('sendBtn').disabled = true;
  try {
    const result = await window.codexControl.submitPrompt(prompt);
    if (result.ok) {
      input.value = '';
      showToast(result.queued ? 'Follow-up queued.' : 'Follow-up sent to the same Codex thread.');
    } else {
      showToast(result.error || 'Could not send follow-up.');
    }
  } catch (error) {
    showToast(error?.message || 'Could not send follow-up.');
  } finally {
    $('sendBtn').disabled = false;
  }
}

function setChip(el, text, ok) {
  el.textContent = text;
  el.classList.toggle('ok', Boolean(ok));
}

async function refreshSettingsPanel() {
  const [settings, diagnostics] = await Promise.all([
    window.codexControl.getSettings(),
    window.codexControl.getDiagnostics()
  ]);
  currentSettings = settings;

  $('launchAtLoginToggle').checked = Boolean(settings.launchAtLogin);
  $('launchAtLoginToggle').disabled = !diagnostics.loginItemSupported;
  $('notificationsToggle').checked = Boolean(settings.notifications);
  $('closeToTrayToggle').checked = Boolean(settings.closeToTray);
  $('codexHomeValue').textContent = diagnostics.codexHome;
  setChip($('codexHomeStatus'), diagnostics.codexHomeExists ? 'READY' : 'MISSING', diagnostics.codexHomeExists);
  $('codexCliStatus').textContent = diagnostics.codexCliPath || 'Not found in PATH';
  $('hotkeyValue').textContent = settings.hotkey.replace('CommandOrControl', navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl');
  const bridgeLabel = diagnostics.bridgeInstalled
    ? (diagnostics.bridgeAlive ? 'LIVE' : `INSTALLED ${diagnostics.bridgeVersion || ''}`.trim())
    : (diagnostics.bridgeLegacyInstalled ? 'LEGACY BRIDGE' : 'NOT INSTALLED');
  setChip($('bridgeInstallStatus'), bridgeLabel, diagnostics.bridgeInstalled);
  $('removeBridgeBtn').disabled = !(diagnostics.bridgeInstalled || diagnostics.bridgeLegacyInstalled);
  $('appVersion').textContent = diagnostics.appVersion;
  $('appMode').textContent = diagnostics.packaged ? 'Installed build' : 'Development';
  $('closeBtn').title = settings.closeToTray ? 'Hide to tray' : 'Quit';
}

async function openSettings() {
  if (compactMode) {
    await window.codexControl.windowAction('compact-off');
    setCompactUI(false);
  }
  $('settingsPanel').classList.remove('hidden');
  try {
    await refreshSettingsPanel();
  } catch (error) {
    showToast(error?.message || 'Could not load settings.');
  }
}

function closeSettings() {
  $('settingsPanel').classList.add('hidden');
}

async function updateSetting(key, value) {
  try {
    currentSettings = await window.codexControl.updateSettings({ [key]: value });
    await refreshSettingsPanel();
  } catch (error) {
    showToast(error?.message || 'Could not save setting.');
  }
}

$('copyOutputBtn').addEventListener('click', async () => {
  const result = await window.codexControl.copyLastOutput();
  showToast(result.ok ? 'Last Codex output copied.' : result.error);
});

$('copyChangesBtn').addEventListener('click', async () => {
  const result = await window.codexControl.copyChanges();
  showToast(result.ok ? 'Git changes copied.' : result.error);
});

$('settingsBtn').addEventListener('click', openSettings);
$('settingsCloseBtn').addEventListener('click', closeSettings);

$('compactBtn').addEventListener('click', async () => {
  const compact = await window.codexControl.windowAction('toggle-compact');
  setCompactUI(Boolean(compact));
});

$('pinBtn').addEventListener('click', async () => {
  const pinned = await window.codexControl.windowAction('toggle-pin');
  renderPinState(Boolean(pinned));
});

$('minBtn').addEventListener('click', () => window.codexControl.windowAction('minimize'));
$('closeBtn').addEventListener('click', () => window.codexControl.windowAction('close'));
$('openCodexBtn').addEventListener('click', async () => {
  const result = await window.codexControl.openCodex();
  if (!result.ok) showToast(result.error);
});
$('sendBtn').addEventListener('click', submit);
$('clearQueueBtn').addEventListener('click', async () => {
  await window.codexControl.clearQueue();
  showToast('Queued follow-up cleared.');
});
$('promptInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    submit();
  }
});

$('launchAtLoginToggle').addEventListener('change', event => updateSetting('launchAtLogin', event.target.checked));
$('notificationsToggle').addEventListener('change', event => updateSetting('notifications', event.target.checked));
$('closeToTrayToggle').addEventListener('change', event => updateSetting('closeToTray', event.target.checked));

$('chooseCodexHomeBtn').addEventListener('click', async () => {
  const result = await window.codexControl.selectCodexHome();
  if (result.ok) {
    showToast('Codex data folder updated.');
    await refreshSettingsPanel();
  }
});

$('resetCodexHomeBtn').addEventListener('click', async () => {
  await updateSetting('codexHome', '');
  showToast('Using the default Codex data folder.');
});

$('installBridgeBtn').addEventListener('click', async () => {
  const result = await window.codexControl.installVsCodeBridge();
  showToast(result.ok ? 'VS Code bridge installed. Reload VS Code once.' : result.error);
  await refreshSettingsPanel();
});

$('removeBridgeBtn').addEventListener('click', async () => {
  const result = await window.codexControl.uninstallVsCodeBridge();
  showToast(result.ok ? 'VS Code bridge removed.' : result.error);
  await refreshSettingsPanel();
});

$('quitAppBtn').addEventListener('click', () => window.codexControl.quitApp());

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('settingsPanel').classList.contains('hidden')) closeSettings();
});

window.codexControl.onSnapshot(render);
window.codexControl.onQueueChanged(({ queuedPrompt }) => {
  if (latest) render({ ...latest, queuedPrompt });
});
window.codexControl.onSendError(({ error }) => showToast(error));
window.codexControl.onPinState(({ pinned }) => renderPinState(Boolean(pinned)));
window.codexControl.onCompactState(({ compact }) => setCompactUI(Boolean(compact)));

window.codexControl.getWindowState().then(({ pinned, compact }) => {
  renderPinState(Boolean(pinned));
  setCompactUI(Boolean(compact));
}).catch(() => {});
window.codexControl.getSnapshot().then(render).catch(error => showToast(error.message));
window.codexControl.getSettings().then(settings => {
  currentSettings = settings;
  $('closeBtn').title = settings.closeToTray ? 'Hide to tray' : 'Quit';
}).catch(() => {});

setInterval(() => {
  if (latest?.status === 'running' && latest.startedAt) {
    $('elapsed').textContent = fmtDuration(Date.now() - latest.startedAt);
  }
}, 1000);
