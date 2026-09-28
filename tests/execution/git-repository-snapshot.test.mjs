import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, chmod, link, mkdir, mkdtemp, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureGitRepositorySnapshot, gitResourceLimitedInvocation } from '../../src/execution/git-repository-snapshot.mjs';

function git(directory, args, input) {
  return execFileSync('git', [`--git-dir=${directory}`, ...args], { input, encoding: 'utf8', env: {
    PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
  } }).trim();
}

function commitFile(repository, contents) {
  const blob = git(repository, ['hash-object', '-w', '--stdin'], Buffer.from(contents));
  const tree = git(repository, ['mktree'], `100644 blob ${blob}\tREADME.md\n`);
  return git(repository, ['commit-tree', tree, '-m', 'fixture'], undefined);
}

async function makeRepositoryPrivate(directory) {
  for (const name of await readdir(directory)) {
    const child = path.join(directory, name);
    const info = await stat(child);
    if (info.isDirectory()) { await makeRepositoryPrivate(child); await chmod(child, 0o755); }
    else if (info.isFile()) await chmod(child, 0o644);
  }
  await chmod(directory, 0o700);
}

test('Git snapshot resolves one allowlisted bare-repository commit into the immutable snapshot format', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-git-snapshot-'));
  const bare = path.join(root, 'repository.git');
  await mkdir(bare);
  await chmod(root, 0o700);
  await chmod(bare, 0o700);
  execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent' } });
  const firstOid = commitFile(bare, 'captured source\n');
  git(bare, ['update-ref', 'refs/heads/main', firstOid]);
  const binding = { id: 'reference-service', tenantId: 'tenant-a', projectId: 'project-12345678-1234-1234-1234-123456789012',
    kind: 'git', identity: 'reference-service', gitDirectory: bare,
    allowedRefs: [{ id: 'main', ref: 'refs/heads/main', label: 'main' }] };
  t.after(() => rm(root, { recursive: true, force: true }));
  await makeRepositoryPrivate(bare);

  const snapshot = await captureGitRepositorySnapshot(binding, 'main');
  assert.equal(snapshot.repositorySource.commitOid, firstOid);
  assert.equal(snapshot.repositorySource.ref, 'refs/heads/main');
  assert.equal(snapshot.treeDigest, snapshot.snapshotId.slice('sha256:'.length));
  assert.deepEqual(snapshot.files.map(({ path: relativePath, mode, size }) => [relativePath, mode, size]), [
    ['README.md', '100644', Buffer.byteLength('captured source\n')],
  ]);
  assert.equal(Buffer.from(snapshot.files[0].contentBase64, 'base64').toString(), 'captured source\n');

  const secondOid = commitFile(bare, 'moved branch\n');
  git(bare, ['update-ref', 'refs/heads/main', secondOid]);
  await makeRepositoryPrivate(bare);
  const current = await captureGitRepositorySnapshot(binding, 'main');
  assert.equal(current.repositorySource.commitOid, secondOid);
  assert.notEqual(current.treeDigest, snapshot.treeDigest);
  assert.equal(snapshot.repositorySource.commitOid, firstOid, 'the captured snapshot remains pinned after branch movement');
  assert.equal(Buffer.from(snapshot.files[0].contentBase64, 'base64').toString(), 'captured source\n');
  await assert.rejects(captureGitRepositorySnapshot(binding, 'not-allowed'), /allowed Git ref/);

  const unsafeBlob = git(bare, ['hash-object', '-w', '--stdin'], Buffer.from('../outside'));
  const unsafeTree = git(bare, ['mktree'], `120000 blob ${unsafeBlob}\tlink\n`);
  const unsafeCommit = git(bare, ['commit-tree', unsafeTree, '-m', 'unsafe symlink entry']);
  git(bare, ['update-ref', 'refs/heads/unsafe', unsafeCommit]);
  await makeRepositoryPrivate(bare);
  await assert.rejects(captureGitRepositorySnapshot({ ...binding,
    allowedRefs: [{ id: 'unsafe', ref: 'refs/heads/unsafe' }],
  }, 'unsafe'), /unsafe path, type, or mode/);
});

test('Git snapshot refuses promisor lazy fetch and rejects linked or writable source metadata', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-git-boundary-'));
  const bare = path.join(root, 'repository.git');
  const remote = path.join(root, 'promisor.git');
  await mkdir(bare);
  await mkdir(remote);
  await chmod(root, 0o700);
  await chmod(bare, 0o700);
  await chmod(remote, 0o700);
  execFileSync('git', ['init', '--bare', bare], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent' } });
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent' } });
  const content = Buffer.from('must not be fetched\n');
  const blob = git(remote, ['hash-object', '-w', '--stdin'], content);
  git(bare, ['hash-object', '-w', '--stdin'], content);
  const tree = git(bare, ['mktree'], `100644 blob ${blob}\tREADME.md\n`);
  const commit = git(bare, ['commit-tree', tree, '-m', 'promisor fixture']);
  git(bare, ['update-ref', 'refs/heads/main', commit]);
  const binding = { id: 'reference-service', tenantId: 'tenant-a', projectId: 'project-12345678-1234-1234-1234-123456789012',
    kind: 'git', identity: 'reference-service', gitDirectory: bare,
    allowedRefs: [{ id: 'main', ref: 'refs/heads/main', label: 'main' }] };
  t.after(() => rm(root, { recursive: true, force: true }));

  const objectPath = path.join(bare, 'objects', blob.slice(0, 2), blob.slice(2));
  await rm(objectPath);
  await writeFile(path.join(bare, 'config'), `[core]\n\trepositoryformatversion = 0\n\tbare = true\n[extensions]\n\tpartialClone = origin\n[remote "origin"]\n\turl = ${remote}\n\tpromisor = true\n`);
  await makeRepositoryPrivate(bare);
  await assert.rejects(captureGitRepositorySnapshot(binding, 'main'), /Partial, promisor, included, or alternate/);
  await assert.rejects(access(objectPath), 'the configured local promisor must not be contacted for lazy fetch');

  await writeFile(path.join(bare, 'config'), Buffer.alloc(64 * 1024 + 1, 0x20));
  await makeRepositoryPrivate(bare);
  await assert.rejects(captureGitRepositorySnapshot(binding, 'main'), /config is unsafe or exceeds the size limit/);

  await writeFile(path.join(bare, 'config'), '[core]\n\trepositoryformatversion = 0\n\tbare = true\n');
  await writeFile(path.join(bare, 'objects/info/http-alternates'), `${remote}\n`);
  await makeRepositoryPrivate(bare);
  await assert.rejects(captureGitRepositorySnapshot(binding, 'main'), /alternates and linked worktree/);
  await rm(path.join(bare, 'objects/info/http-alternates'));

  await writeFile(path.join(bare, 'refs/heads/main'), `${commit}\n`);
  await rm(path.join(bare, 'refs/heads/main'));
  await symlink(path.join(remote, 'HEAD'), path.join(bare, 'refs/heads/main'));
  await assert.rejects(captureGitRepositorySnapshot(binding, 'main'), /unsafe entry/);
  await rm(path.join(bare, 'refs/heads/main'));
  git(bare, ['update-ref', 'refs/heads/main', commit]);
  await makeRepositoryPrivate(bare);

  await link(path.join(remote, 'objects', blob.slice(0, 2), blob.slice(2)), objectPath);
  await assert.rejects(captureGitRepositorySnapshot(binding, 'main'), /unsafe entry/);
  await unlink(objectPath);

  const infoPath = path.join(bare, 'objects/info');
  const originalMode = (await stat(infoPath)).mode & 0o777;
  await chmod(infoPath, 0o775);
  await assert.rejects(captureGitRepositorySnapshot(binding, 'main'), /unsafe entry/);
  await chmod(infoPath, originalMode);
});

test('Git subprocess invocation enforces the OS address-space and CPU limits', () => {
  const invocation = gitResourceLimitedInvocation({ gitDirectory: '/srv/configured/repository.git' }, ['--version']);
  assert.equal(invocation.file, '/usr/bin/prlimit');
  assert.deepEqual(invocation.args.slice(0, 5), [
    '--as=536870912', '--cpu=5', '--', '/usr/bin/git', '--no-pager',
  ]);
  assert.equal(invocation.env.GIT_ALLOW_PROTOCOL, '', 'no Git transport protocol is enabled');
  assert.equal(invocation.env.GIT_NO_LAZY_FETCH, '1', 'Git cannot lazily fetch missing objects');
  const limited = spawnSync('/usr/bin/prlimit', [
    '--as=134217728', '--', '/usr/bin/python3', '-c', 'bytearray(268435456)',
  ], { encoding: 'utf8', timeout: 5_000 });
  assert.notEqual(limited.status, 0, 'an allocation above RLIMIT_AS fails inside a limited child process');
});
