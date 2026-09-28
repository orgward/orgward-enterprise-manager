import assert from 'node:assert/strict';
import { chmod, link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureLocalRepositorySnapshot, localRepositoryDiff, materializeLocalRepositorySnapshot } from '../../src/execution/local-repository-snapshot.mjs';

test('local repository snapshot pins bytes and executable modes, materializes safely, and captures full candidate diff', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orgward-local-repository-'));
  const source = path.join(root, 'source');
  const workspace = path.join(root, 'workspace');
  await mkdir(path.join(source, 'src'), { recursive: true, mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  await writeFile(path.join(source, 'src', 'change.js'), 'before\n');
  await chmod(path.join(source, 'src', 'change.js'), 0o755);
  await writeFile(path.join(source, 'remove.txt'), 'remove me');
  await mkdir(path.join(source, '.git'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const before = await captureLocalRepositorySnapshot(source);
  assert.equal(before.files.length, 2);
  assert.equal(before.files.find((file) => file.path === 'src/change.js').mode, '100755');
  await materializeLocalRepositorySnapshot(before, workspace);
  assert.equal(await readFile(path.join(workspace, 'src/change.js'), 'utf8'), 'before\n');
  await writeFile(path.join(workspace, 'src', 'change.js'), 'after\n');
  await chmod(path.join(workspace, 'src', 'change.js'), 0o644);
  await rm(path.join(workspace, 'remove.txt'));
  await writeFile(path.join(workspace, 'added.txt'), 'new file');
  const after = await captureLocalRepositorySnapshot(workspace);
  assert.deepEqual(localRepositoryDiff(before, after).map((change) => [change.path, change.change]), [
    ['added.txt', 'added'], ['remove.txt', 'deleted'], ['src/change.js', 'modified'],
  ]);
  const modeOnlyBefore = { files: [{ path: 'same', mode: '100644', contentHash: 'a'.repeat(64), size: 1 }] };
  const modeOnlyAfter = { files: [{ path: 'same', mode: '100755', contentHash: 'a'.repeat(64), size: 1 }] };
  assert.equal(localRepositoryDiff(modeOnlyBefore, modeOnlyAfter)[0].change, 'mode_changed');
});

test('local repository snapshot rejects links and special path components', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orgward-local-repository-denial-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'safe.txt'), 'safe');
  await symlink('/etc/passwd', path.join(root, 'link.txt'));
  await assert.rejects(captureLocalRepositorySnapshot(root), { code: 'LOCAL_REPOSITORY_INVALID' });
});

test('local repository snapshot rejects hard links and over-limit trees', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orgward-local-repository-limits-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const linked = path.join(root, 'linked');
  await mkdir(linked);
  await writeFile(path.join(linked, 'one.txt'), 'one');
  await link(path.join(linked, 'one.txt'), path.join(linked, 'two.txt'));
  await assert.rejects(captureLocalRepositorySnapshot(linked), { code: 'LOCAL_REPOSITORY_INVALID' });
  const crowded = path.join(root, 'crowded');
  await mkdir(crowded);
  await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(path.join(crowded, `${index}.txt`), 'x')));
  await assert.rejects(captureLocalRepositorySnapshot(crowded), { code: 'LOCAL_REPOSITORY_INVALID' });
});
