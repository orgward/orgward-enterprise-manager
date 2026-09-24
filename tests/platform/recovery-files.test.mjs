import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertRootsDisjoint, verifyManifestFiles } from '../../ops/recovery-files.mjs';

test('recovery paths detect overlap through symlinked parent aliases', async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'orgward-recovery-paths-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const actual = path.join(temporary, 'actual');
  await mkdir(path.join(actual, 'live'), { recursive: true });
  const alias = path.join(temporary, 'alias');
  await symlink(actual, alias, 'dir');

  await assert.rejects(assertRootsDisjoint(
    [{ name: 'workspace', sourcePath: path.join(actual, 'live') }],
    path.join(alias, 'live', 'restore'),
  ), { code: 'FILESYSTEM_TARGET_INVALID' });
  await assert.rejects(assertRootsDisjoint(
    [
      { name: 'one', sourcePath: path.join(actual, 'live') },
      { name: 'two', sourcePath: path.join(alias, 'live', 'nested') },
    ],
    path.join(temporary, 'separate'),
  ), { code: 'FILESYSTEM_TARGET_INVALID' });
});

test('recovery manifests enforce one total byte limit across all four roots', async () => {
  const names = ['projects', 'sdlc', 'execution-runs', 'execution-workspaces'];
  const fileSize = 512 * 1024 * 1024;
  const filesPerRoot = 52;
  const roots = names.map((name) => ({ name, present: true, fileCount: filesPerRoot, bytes: fileSize * filesPerRoot }));
  const entries = names.flatMap((root) => Array.from({ length: filesPerRoot }, (_, index) => ({
    root, path: `file-${index}.bin`, size: fileSize, sha256: 'a'.repeat(64),
  })));
  await assert.rejects(verifyManifestFiles(roots, entries, []), { code: 'BACKUP_INVALID' });
});
