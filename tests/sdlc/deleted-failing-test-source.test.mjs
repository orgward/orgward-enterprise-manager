import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { T91_DELETED_FAILING_TEST_SOURCE } from '../fixtures/t91-deleted-failing-test-source.mjs';

test('the exact source-snapshot fixture is a failing test before candidate deletion', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'orgward-t91-deleted-failing-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'learning.test.mjs');
  writeFileSync(file, T91_DELETED_FAILING_TEST_SOURCE);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', timeout: 20_000, env });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /pinned criterion fails on the candidate/);
  assert.match(result.stdout, /1 !== 2/);
});
