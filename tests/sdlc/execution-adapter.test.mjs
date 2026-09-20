import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CommandExecutionAdapter } from '../../src/sdlc/execution-adapter.mjs';

test('provider-neutral command adapter runs a bounded coding agent and captures immutable evidence', async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'orgward-agent-adapter-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const fixture = fileURLToPath(new URL('./fixtures/reference-agent.mjs', import.meta.url));
  const adapter = new CommandExecutionAdapter({ executable: process.execPath, args: [fixture], name: 'reference-process-coding-agent' });
  const result = await adapter.execute(
    { id: 'WORK-REFERENCE', objective: 'Implement a bounded reference change' },
    { id: 'context-1', requirements: ['REQ-FUN-1'], exclusions: ['production credentials'], contentHash: 'fixture' },
    { workspace },
  );
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /implemented WORK-REFERENCE/);
  assert.deepEqual(result.changedArtifacts.map((entry) => entry.path), ['src/bounded-change.json']);
  assert.equal(result.evidenceHash.length, 64);
});

test('command adapter rejects PATH lookup and therefore cannot invoke an ambiguous executable', () => {
  assert.throws(() => new CommandExecutionAdapter({ executable: 'node' }), /absolute path/);
});
