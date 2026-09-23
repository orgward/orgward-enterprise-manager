import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { digest } from '../../src/sdlc/contracts.mjs';
import { readWorkspaceArtifact } from '../../src/execution/artifact-file.mjs';

test('artifact traversal stays anchored when a parent directory becomes a symlink at open time', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orgward-artifact-fd-'));
  const runId = 'execution-run-11111111-1111-4111-8111-111111111111';
  const workspace = path.join(root, runId);
  const nested = path.join(workspace, 'nested');
  const moved = path.join(workspace, 'nested-held');
  const outside = path.join(root, 'outside');
  const canary = Buffer.from('outside artifact canary');
  await mkdir(nested, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(nested, 'result.txt'), 'workspace artifact');
  await writeFile(path.join(outside, 'result.txt'), canary);
  t.after(() => rm(root, { recursive: true, force: true }));

  const beforeRace = await readWorkspaceArtifact({
    configuredRoot: root, runId, segments: ['nested', 'result.txt'],
    expectedHash: digest(Buffer.from('workspace artifact')),
  });
  assert.equal(beforeRace.toString(), 'workspace artifact');

  let swapped = false;
  const raceOpen = async (filePath, flags) => {
    if (!swapped && filePath.endsWith('/nested')) {
      swapped = true;
      await rename(nested, moved);
      await symlink(outside, nested, 'dir');
    }
    return open(filePath, flags);
  };
  const escaped = await readWorkspaceArtifact({
    configuredRoot: root, runId, segments: ['nested', 'result.txt'], expectedHash: digest(canary),
  }, { openFile: raceOpen });
  assert.equal(swapped, true);
  assert.equal(escaped, null);
  assert.equal(canary.toString(), (await readFile(path.join(outside, 'result.txt'))).toString());
});
