const fs = require('fs');
const os = require('os');
const path = require('path');
const { SessionMonitor } = require('../src/session-monitor');

function jsonl(record) {
  return `${JSON.stringify(record)}\n`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-control-center-test-'));
const sessionsDir = path.join(root, 'sessions', '2026', '09', '13');
fs.mkdirSync(sessionsDir, { recursive: true });

try {
  const firstId = '11111111-1111-1111-1111-111111111111';
  const firstFile = path.join(sessionsDir, `rollout-2026-09-13T10-00-00-${firstId}.jsonl`);

  fs.writeFileSync(firstFile, [
    jsonl({ type: 'session_meta', payload: { id: firstId, cwd: '/tmp/project' } }),
    jsonl({ timestamp: '2026-09-13T10:00:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'new-turn' } }),
    jsonl({ timestamp: '2026-09-13T10:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'Keep working' } }),
    jsonl({ timestamp: '2026-09-13T10:00:02Z', type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'old-turn' } })
  ].join(''));

  const monitor = new SessionMonitor({
    codexHome: root,
    bridgeFile: path.join(root, 'missing-bridge.json')
  });

  let snapshot = monitor.snapshot();
  assert(snapshot.status === 'running', 'An abort from an older turn must not stop the active turn.');

  fs.appendFileSync(firstFile,
    jsonl({ timestamp: '2026-09-13T10:00:03Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'old-turn', last_agent_message: 'old' } })
  );
  snapshot = monitor.snapshot();
  assert(snapshot.status === 'running', 'A completion from an older turn must not complete the active turn.');

  fs.appendFileSync(firstFile,
    jsonl({ timestamp: '2026-09-13T10:00:04Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'new-turn', last_agent_message: 'done' } }) +
    jsonl({ timestamp: '2026-09-13T10:00:05Z', type: 'response_item', payload: { type: 'function_call', name: 'shell' } })
  );
  snapshot = monitor.snapshot();
  assert(snapshot.status === 'completed', 'The matching task_complete must complete the active turn.');
  assert(snapshot.phase === 'Done', 'Late response items must not replace the final Done phase.');

  fs.appendFileSync(firstFile,
    jsonl({ timestamp: '2026-09-13T10:00:06Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'third-turn' } }) +
    jsonl({ timestamp: '2026-09-13T10:00:07Z', type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'third-turn' } })
  );
  snapshot = monitor.snapshot();
  assert(snapshot.status === 'interrupted', 'A matching abort must interrupt the active turn.');

  const secondId = '22222222-2222-2222-2222-222222222222';
  const secondFile = path.join(sessionsDir, `rollout-2026-09-13T10-01-00-${secondId}.jsonl`);
  fs.writeFileSync(secondFile,
    jsonl({ type: 'session_meta', payload: { id: secondId, cwd: '/tmp/other' } }) +
    jsonl({ timestamp: '2026-09-13T10:01:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'second-turn' } })
  );

  const now = Date.now() / 1000;
  fs.utimesSync(firstFile, now - 10, now - 10);
  fs.utimesSync(secondFile, now, now);
  monitor.candidatesAt = 0;
  snapshot = monitor.snapshot();
  assert(snapshot.id === secondId, 'The newest session must be selected after candidate discovery.');

  fs.appendFileSync(firstFile,
    jsonl({ timestamp: '2026-09-13T10:01:01Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'fourth-turn' } })
  );
  fs.utimesSync(firstFile, now + 1, now + 1);
  snapshot = monitor.snapshot();
  assert(snapshot.id === firstId, 'Cached candidate mtimes must refresh without waiting for a full rescan.');
  assert(snapshot.status === 'running', 'The newly active session must report running.');

  console.log('Session lifecycle regression tests PASS.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
