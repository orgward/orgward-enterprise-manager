import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { activeTaskFromText } from '../ops/active-task.mjs';

const currentTasks = readFileSync(new URL('../TASKS.md', import.meta.url), 'utf8');

test('active implementation pointer matches the first open PR and rejects drift', () => {
  const current = activeTaskFromText(currentTasks);
  assert.match(current, /^PR-\d{2}$/);
  const stale = current === 'PR-01' ? 'PR-02' : 'PR-01';
  assert.throws(() => activeTaskFromText(currentTasks.replace(`Active cursor: ${current}.`, `Active cursor: ${stale}.`)),
    /Invalid task pointer/);
  assert.throws(() => activeTaskFromText(currentTasks.replace(`- [ ] ${current} —`, `- [x] ${current} —`)),
    /Invalid task pointer/);
  assert.throws(() => activeTaskFromText(`${currentTasks}\n- [ ] ${current} — duplicate\n`),
    /Invalid task pointer/);
  const allDone = currentTasks.replace(/^- \[ \] (PR-\d{2})\s+—/gm, '- [x] $1 —')
    .replace(/^Active cursor: PR-\d{2}\./m, 'Active cursor: COMPLETE.');
  assert.equal(activeTaskFromText(allDone), null);
});
