import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { captureLocalRepositorySnapshot } from '../../src/execution/local-repository-snapshot.mjs';
import { parseGitHubBuildPlan } from '../../src/execution/github-build-plan.mjs';
import { runGitHubReproducibleBuilds } from '../../src/execution/service.mjs';

const buildConfig = (executable = '/usr/bin/node') => ({ id: 'fixture-build', version: '1.0.0', executable,
  args: ['/workspace/scripts/build.mjs', '--output=/build-output'], timeoutMs: 5_000,
  requiredOutputs: ['dist/app.js'] });

test('GitHub build plans pin a fixed command and an exact nonempty relative output manifest', () => {
  const plan = parseGitHubBuildPlan(buildConfig());
  assert.equal(plan.outputMount, '/build-output');
  assert.deepEqual(plan.requiredOutputs, ['dist/app.js']);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
  assert.equal(parseGitHubBuildPlan(plan).planHash, plan.planHash);
  for (const invalid of [
    { ...buildConfig(), requiredOutputs: [] },
    { ...buildConfig(), requiredOutputs: ['../escape'] },
    { ...buildConfig(), requiredOutputs: ['dist/app.js', 'dist/app.js'] },
    { ...buildConfig('/bin/sh'), args: ['-c', 'build'] },
    { ...buildConfig(), environment: { TOKEN: 'user-value' } },
  ]) assert.throws(() => parseGitHubBuildPlan(invalid));
});

test('two isolated GitHub builds persist bounded output bytes and distinguish matched, mismatched, and failed results', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-build-plan-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'scripts'), { recursive: true });
  await writeFile(path.join(source, 'README.md'), 'candidate bytes\n');
  await writeFile(path.join(source, 'scripts', 'build.mjs'), 'fixed build recipe\n');
  const candidateSnapshot = await captureLocalRepositorySnapshot(source);
  const candidateRoot = path.join(root, 'workspaces');
  const artifactRoot = path.join(root, 'durable-builds');
  await mkdir(candidateRoot, { mode: 0o700 });
  await mkdir(artifactRoot, { mode: 0o700 });

  const executePlan = async (runId, mode) => {
    let attempt = 0;
    return runGitHubReproducibleBuilds({ plan: parseGitHubBuildPlan(buildConfig()), candidateSnapshot,
      runId, candidateRoot, artifactRoot,
      commandAdapterFactory: (options) => ({ execute: async (_work, context, { workspace }) => {
        attempt += 1;
        assert.equal(options.sandbox.workspaceReadOnly, true);
        assert.deepEqual(options.sandbox.writableDirectories.map(({ target }) => target), ['/build-output']);
        assert.equal(context.candidateTreeDigest, candidateSnapshot.treeDigest);
        assert.equal(await readFile(path.join(workspace, 'README.md'), 'utf8'), 'candidate bytes\n');
        const outputDirectory = options.sandbox.writableDirectories[0].path;
        await mkdir(path.join(outputDirectory, 'dist'), { recursive: true });
        if (mode !== 'missing') {
          const contents = mode === 'mismatch' && attempt === 2 ? 'different output\n' : 'stable output\n';
          await writeFile(path.join(outputDirectory, 'dist', 'app.js'), contents);
        }
        if (mode === 'extra') await writeFile(path.join(outputDirectory, 'dist', 'extra.js'), 'unexpected output\n');
        if (mode === 'mutated-candidate' && attempt === 1) await writeFile(path.join(workspace, 'README.md'), 'changed during build');
        return { status: mode === 'failed' && attempt === 2 ? 'FAILED' : 'COMPLETED',
          exitCode: mode === 'failed' && attempt === 2 ? 1 : 0, stdout: `build ${attempt}`, stderr: '',
          stdoutTruncated: false, stderrTruncated: false };
      } }),
    });
  };

  const matched = await executePlan('matched-run', 'matched');
  assert.equal(matched.status, 'REPRODUCIBLE');
  assert.equal(matched.outputBytesEqual, true);
  assert.deepEqual(matched.runs.map((run) => run.status), ['BUILT', 'BUILT']);
  assert.equal(await readFile(path.join(artifactRoot, 'matched-run', 'build-1', 'dist', 'app.js'), 'utf8'), 'stable output\n');
  assert.equal(await readFile(path.join(artifactRoot, 'matched-run', 'build-2', 'dist', 'app.js'), 'utf8'), 'stable output\n');

  const mismatch = await executePlan('mismatch-run', 'mismatch');
  assert.equal(mismatch.status, 'MISMATCH');
  assert.equal(mismatch.outputBytesEqual, false);

  const failed = await executePlan('failed-run', 'failed');
  assert.equal(failed.status, 'FAILED');
  assert.deepEqual(failed.runs.map((run) => run.status), ['BUILT', 'FAILED']);

  const missing = await executePlan('missing-run', 'missing');
  assert.equal(missing.status, 'FAILED', 'a successful command that misses the output manifest is not a build pass');
  assert.ok(missing.runs.every((run) => run.reason === 'build_outputs_do_not_match_required_manifest'));

  const extra = await executePlan('extra-run', 'extra');
  assert.equal(extra.status, 'FAILED', 'unlisted build outputs fail the allowlisted manifest');

  const mutated = await executePlan('mutated-run', 'mutated-candidate');
  assert.equal(mutated.status, 'FAILED', 'a build that changes the read-only source candidate fails');
});
