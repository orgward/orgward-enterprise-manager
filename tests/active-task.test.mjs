import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { activeTaskFromText } from '../ops/active-task.mjs';

const currentTasks = readFileSync(new URL('../TASKS.md', import.meta.url), 'utf8');

test('active implementation pointer matches the first open PR and rejects drift', () => {
  const actual = activeTaskFromText(currentTasks);
  const openTasks = actual ? currentTasks : currentTasks
    .replace('- [x] PR-01 —', '- [ ] PR-01 —')
    .replace('Active cursor: COMPLETE.', 'Active cursor: PR-01.');
  const current = activeTaskFromText(openTasks);
  assert.match(current, /^PR-\d{2}$/);
  const stale = current === 'PR-01' ? 'PR-02' : 'PR-01';
  assert.throws(() => activeTaskFromText(openTasks.replace(`Active cursor: ${current}.`, `Active cursor: ${stale}.`)),
    /Invalid task pointer/);
  assert.throws(() => activeTaskFromText(openTasks.replace(`- [ ] ${current} —`, `- [x] ${current} —`)),
    /Invalid task pointer/);
  assert.throws(() => activeTaskFromText(`${openTasks}\n- [ ] ${current} — duplicate\n`),
    /Invalid task pointer/);
  assert.throws(() => activeTaskFromText(openTasks.replace(/^- \[([ x])\] PR-18\s+—/m, '- [$1] PR-19 —')),
    /Invalid task pointer/);
  assert.throws(() => activeTaskFromText(openTasks.replace(/^- \[[ x]\] PR-18\s+—.*\n/m, '')),
    /Invalid task pointer/);
  const allDone = openTasks.replace(/^- \[ \] (PR-\d{2})\s+—/gm, '- [x] $1 —')
    .replace(/^Active cursor: PR-\d{2}\./m, 'Active cursor: COMPLETE.');
  assert.equal(activeTaskFromText(allDone), null);
});
