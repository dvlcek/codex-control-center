const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_CANDIDATES = 80;
const TAIL_BYTES = 8 * 1024 * 1024;
const HEAD_BYTES = 128 * 1024;

function safeJson(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function normalizePath(input) {
  if (!input) return '';
  let p = path.resolve(input).replace(/[\\/]+$/, '');
  if (process.platform === 'win32') p = p.toLowerCase();
  return p;
}

function pathsRelated(a, b) {
  a = normalizePath(a);
  b = normalizePath(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const sep = path.sep;
  return a.startsWith(b + sep) || b.startsWith(a + sep);
}

function truncate(text, max = 110) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function readChunk(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const bytes = fs.readSync(fd, buf, 0, length, start);
    return buf.subarray(0, bytes).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readHead(file) {
  const stat = fs.statSync(file);
  return readChunk(file, 0, Math.min(HEAD_BYTES, stat.size));
}

function readTail(file) {
  const stat = fs.statSync(file);
  const length = Math.min(TAIL_BYTES, stat.size);
  const start = Math.max(0, stat.size - length);
  let text = readChunk(file, start, length);
  if (start > 0) {
    const firstNewline = text.indexOf('\n');
    if (firstNewline >= 0) text = text.slice(firstNewline + 1);
  }
  return text;
}

function getSessionMeta(file) {
  try {
    for (const line of readHead(file).split(/\r?\n/)) {
      const rec = safeJson(line);
      if (rec?.type === 'session_meta') return rec.payload || {};
    }
  } catch {}
  return {};
}

function listRollouts(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) {
        try {
          const stat = fs.statSync(full);
          out.push({ file: full, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch {}
      }
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, MAX_CANDIDATES);
}

function sessionIdFromFile(file) {
  const m = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i);
  return m ? m[1] : '';
}

function mapPhase(type, payload, recordType) {
  const t = String(type || '').toLowerCase();
  const name = String(payload?.name || payload?.tool_name || '').toLowerCase();
  if (t === 'user_message') return 'Prompt received';
  if (t === 'agent_message') return 'Writing response';
  if (t.includes('reason')) return 'Thinking';
  if (t.includes('compact')) return 'Compacting context';
  if (t.includes('error')) return 'Error';
  if (t.includes('request_user_input') || t.includes('approval')) return 'Waiting for input';
  if (t.includes('exec') || t.includes('shell') || t.includes('command') || name.includes('shell')) return 'Running command';
  if (t.includes('patch') || t.includes('file') || name.includes('patch')) return 'Editing files';
  if (t.includes('web') || name.includes('web')) return 'Browsing';
  if (t.includes('mcp') || t.includes('tool') || recordType === 'response_item') return name ? `Using ${name}` : 'Using tool';
  return '';
}

function parseSession(file, indexTitle) {
  const meta = getSessionMeta(file);
  const id = meta.id || meta.thread_id || sessionIdFromFile(file);
  let lines = [];
  try { lines = readTail(file).split(/\r?\n/).filter(Boolean); } catch {}

  let status = 'idle';
  let currentTurnId = '';
  let startedAt = null;
  let currentPrompt = '';
  let lastAgentMessage = '';
  let lastCompleted = null;
  let lastError = '';
  let usage = null;
  let rateLimits = null;
  let modelContextWindow = null;
  let phase = 'Idle';
  const activities = [];

  const addActivity = (label, ts) => {
    if (!label) return;
    const last = activities[activities.length - 1];
    if (last?.label === label) {
      last.ts = ts || last.ts;
      return;
    }
    activities.push({ label, ts: ts || null });
    if (activities.length > 8) activities.shift();
  };

  for (const line of lines) {
    const rec = safeJson(line);
    if (!rec) continue;
    const ts = rec.timestamp || null;

    if (rec.type === 'event_msg') {
      const p = rec.payload || {};
      const t = p.type || '';
      if (t === 'task_started' || t === 'turn_started') {
        status = 'running';
        currentTurnId = p.turn_id || p.turnId || '';
        startedAt = p.started_at ? p.started_at * 1000 : (ts ? Date.parse(ts) : Date.now());
        modelContextWindow = p.model_context_window || modelContextWindow;
        phase = 'Thinking';
        currentPrompt = '';
        lastError = '';
        addActivity('Task started', ts);
      } else if (t === 'user_message') {
        currentPrompt = p.message || currentPrompt;
        phase = 'Thinking';
        addActivity('Prompt received', ts);
      } else if (t === 'agent_message') {
        lastAgentMessage = p.message || lastAgentMessage;
        phase = 'Writing response';
        addActivity('Writing response', ts);
      } else if (t === 'token_count') {
        usage = p.info || usage;
        rateLimits = p.rate_limits || rateLimits;
        modelContextWindow = p.info?.model_context_window || modelContextWindow;
      } else if (t === 'error') {
        lastError = p.message || 'Unknown Codex error';
        phase = 'Error';
        addActivity('Error', ts);
      } else if (t === 'task_complete' || t === 'turn_complete' || t === 'turn_completed') {
        const terminalTurnId = p.turn_id || p.turnId || '';
        const belongsToCurrentTurn = !terminalTurnId || !currentTurnId || terminalTurnId === currentTurnId;

        // Codex can persist delayed terminal events from older turns. Never let an
        // old task_complete overwrite the state of a newer turn that is running.
        if (belongsToCurrentTurn) {
          const fullMessage = p.last_agent_message || lastAgentMessage || '';
          const terminalError = typeof p.error === 'string'
            ? p.error
            : (p.error?.message || '');
          const failed = Boolean(terminalError);

          lastCompleted = {
            turnId: terminalTurnId || currentTurnId || '',
            message: fullMessage,
            completedAt: p.completed_at ? p.completed_at * 1000 : (ts ? Date.parse(ts) : Date.now()),
            durationMs: p.duration_ms || null,
            error: terminalError || ''
          };
          status = failed ? 'failed' : 'completed';
          phase = failed ? 'Failed' : 'Done';
          lastError = terminalError || '';
          addActivity(failed ? 'Task failed' : 'Task completed', ts);
        }
      } else if (t === 'turn_aborted' || t === 'turn_interrupted' || t === 'interrupted') {
        const terminalTurnId = p.turn_id || p.turnId || '';
        const belongsToCurrentTurn = !terminalTurnId || !currentTurnId || terminalTurnId === currentTurnId;

        // Same rule as completion: an abort belonging to an older turn must not
        // mark a newer active turn as stopped.
        if (belongsToCurrentTurn) {
          status = 'interrupted';
          phase = 'Interrupted';
          addActivity('Task interrupted', ts);
        }
      } else {
        const mapped = mapPhase(t, p, rec.type);
        if (mapped) {
          phase = mapped;
          addActivity(mapped, ts);
        }
      }
    } else if (rec.type === 'response_item') {
      const p = rec.payload || {};

      // response_item records can be flushed after a terminal event. They are
      // useful for activity while a turn is active, but must not change a final
      // Done/Interrupted/Failed phase back into "Using tool" afterwards.
      if (status === 'running' || status === 'idle') {
        const mapped = mapPhase(p.type, p, rec.type);
        if (mapped) {
          phase = mapped;
          addActivity(mapped, rec.timestamp || null);
        }
        if (p.type === 'function_call') {
          const n = p.name || p.tool_name || 'tool';
          phase = `Using ${n}`;
        }
      }
    }
  }

  const stat = fs.statSync(file);

  const total = usage?.total_token_usage || null;
  const last = usage?.last_token_usage || null;
  const contextWindow = usage?.model_context_window || modelContextWindow || null;
  const contextTokens = last?.total_tokens ?? last?.input_tokens ?? null;
  const contextPct = contextWindow && contextTokens != null
    ? Math.min(100, Math.round((contextTokens / contextWindow) * 1000) / 10)
    : null;

  const primary = rateLimits?.primary || null;
  const secondary = rateLimits?.secondary || null;

  const title = indexTitle || truncate(currentPrompt, 76) || 'Codex task';
  return {
    id,
    file,
    cwd: meta.cwd || '',
    source: meta.source || meta.originator || '',
    title,
    status,
    phase,
    currentTurnId,
    startedAt,
    currentPrompt: truncate(currentPrompt, 220),
    lastAgentMessage: truncate(lastAgentMessage, 260),
    lastAgentMessageFull: lastAgentMessage || '',
    lastCompleted: lastCompleted ? {
      ...lastCompleted,
      fullMessage: lastCompleted.message || '',
      message: truncate(lastCompleted.message, 260)
    } : null,
    error: truncate(lastError, 220),
    updatedAt: stat.mtimeMs,
    activities: activities.slice(-5),
    usage: {
      contextPct,
      contextTokens,
      contextWindow,
      sessionTotalTokens: total?.total_tokens ?? null,
      inputTokens: total?.input_tokens ?? null,
      cachedInputTokens: total?.cached_input_tokens ?? null,
      outputTokens: total?.output_tokens ?? null,
      reasoningTokens: total?.reasoning_output_tokens ?? null,
      primaryUsedPct: primary?.used_percent ?? null,
      primaryWindowMin: primary?.window_minutes ?? null,
      primaryResetSec: primary?.resets_in_seconds ?? null,
      secondaryUsedPct: secondary?.used_percent ?? null,
      secondaryWindowMin: secondary?.window_minutes ?? null,
      secondaryResetSec: secondary?.resets_in_seconds ?? null
    }
  };
}

class SessionMonitor {
  constructor(options = {}) {
    this.codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    this.bridgeFile = options.bridgeFile || path.join(os.homedir(), '.codex-control-center', 'bridge', 'vscode.json');
    this.legacyBridgeFile = options.legacyBridgeFile || '';
    this.cachedCandidates = [];
    this.candidatesAt = 0;
  }

  getBridgeState() {
    const states = [];
    for (const file of [this.bridgeFile, this.legacyBridgeFile].filter(Boolean)) {
      try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (value && typeof value === 'object') states.push(value);
      } catch {}
    }
    states.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    return states[0] || {};
  }

  bridgeIsAlive(bridge) {
    return Boolean(bridge?.updatedAt && Date.now() - bridge.updatedAt < 10000);
  }

  getIndexMap() {
    const map = new Map();
    const file = path.join(this.codexHome, 'session_index.jsonl');
    try {
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const rec = safeJson(line);
        if (rec?.id) map.set(rec.id, rec.thread_name || rec.title || '');
      }
    } catch {}
    return map;
  }

  getCandidates() {
    // Discover new rollout files at a low frequency, but refresh mtimes for all
    // known candidates on every snapshot. Updating only candidate[0] can leave
    // an older session pinned for ~5 seconds and make the UI bounce between two
    // sessions from the same workspace.
    if (Date.now() - this.candidatesAt > 5000 || !this.cachedCandidates.length) {
      this.cachedCandidates = listRollouts(path.join(this.codexHome, 'sessions'));
      this.candidatesAt = Date.now();
    } else {
      const refreshed = [];
      for (const candidate of this.cachedCandidates) {
        try {
          const stat = fs.statSync(candidate.file);
          refreshed.push({ ...candidate, mtimeMs: stat.mtimeMs, size: stat.size });
        } catch {}
      }
      refreshed.sort((a, b) => b.mtimeMs - a.mtimeMs);
      this.cachedCandidates = refreshed;
    }
    return this.cachedCandidates;
  }

  pickSession(bridge = this.getBridgeState()) {
    const bridgeAlive = this.bridgeIsAlive(bridge);
    const workspaces = bridgeAlive && Array.isArray(bridge.workspaceFolders) ? bridge.workspaceFolders : [];
    const candidates = this.getCandidates();
    if (!candidates.length) return null;

    if (workspaces.length) {
      for (const candidate of candidates) {
        const meta = getSessionMeta(candidate.file);
        const cwd = meta.cwd || '';
        if (workspaces.some(ws => pathsRelated(ws, cwd))) return candidate;
      }
    }

    return candidates[0];
  }

  snapshot() {
    const bridge = this.getBridgeState();
    const bridgeAlive = this.bridgeIsAlive(bridge);
    const candidate = this.pickSession(bridge);

    if (!candidate) {
      return {
        connected: false,
        project: bridgeAlive ? (bridge.workspaceName || 'No workspace') : 'Codex',
        workspace: bridgeAlive ? (bridge.workspaceFolders?.[0] || '') : '',
        status: 'idle',
        phase: 'Waiting for Codex',
        title: 'No Codex sessions found',
        usage: {},
        activities: [],
        activeFile: bridgeAlive ? (bridge.activeFile || '') : '',
        bridgeAlive
      };
    }

    const id = getSessionMeta(candidate.file).id || sessionIdFromFile(candidate.file);
    const indexMap = this.getIndexMap();
    const parsed = parseSession(candidate.file, indexMap.get(id));
    const project = bridgeAlive
      ? (bridge.workspaceName || path.basename(parsed.cwd || '') || 'Codex')
      : (path.basename(parsed.cwd || '') || 'Codex');
    const workspace = bridgeAlive
      ? (bridge.workspaceFolders?.[0] || parsed.cwd || '')
      : (parsed.cwd || '');

    return {
      connected: true,
      project,
      workspace,
      activeFile: bridgeAlive ? (bridge.activeFile || '') : '',
      bridgeAlive,
      ...parsed
    };
  }
}

module.exports = { SessionMonitor };
