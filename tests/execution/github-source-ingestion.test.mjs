import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { GitHubSourceIngestion } from '../../src/execution/github-source-ingestion.mjs';

function sha1Blob(bytes) { return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function fixture(t, { tree = null, repositoryIds = ['987654'], content = Buffer.from('fixture README\n'), redirect = false,
  installationId = '123', oversizedResponse = false, tokenResponse = null } = {}) {
  const blobSha = sha1Blob(content);
  const commitSha = 'a'.repeat(40);
  const treeSha = 'b'.repeat(40);
  const calls = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    calls.push({ url, method: request.method, auth: request.headers.authorization, body: '' });
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const call = calls.at(-1);
      call.body = Buffer.concat(chunks).toString();
      if (url.pathname === `/app/installations/${installationId}/repositories`) {
        if (oversizedResponse) {
          response.writeHead(200, { 'content-type': 'application/json' });
          return response.end(Buffer.alloc(10_000_001, 0x20));
        }
        return json(response, 200, { repositories: repositoryIds.map((id) => ({ id, name: 'service', owner: { login: 'fixture-org' } })) });
      }
      if (url.pathname === `/app/installations/${installationId}/access_tokens`) {
        return json(response, 201, tokenResponse ?? {
          token: 'fixture-installation-token', expires_at: '2099-01-01T00:00:00Z',
          permissions: { metadata: 'read', contents: 'read' }, repository_selection: 'selected',
          repositories: [{ id: repositoryIds[0], name: 'service', owner: { login: 'fixture-org' } }],
        });
      }
      if (url.pathname === '/repos/fixture-org/service/git/ref/heads/main') {
        if (redirect) { response.writeHead(302, { location: 'https://attacker.invalid/steal' }); return response.end(); }
        return json(response, 200, { ref: 'refs/heads/main', object: { type: 'commit', sha: commitSha } });
      }
      if (url.pathname === `/repos/fixture-org/service/git/commits/${commitSha}`) return json(response, 200, { sha: commitSha, tree: { sha: treeSha } });
      if (url.pathname === `/repos/fixture-org/service/git/trees/${treeSha}`) return json(response, 200, tree ?? {
        sha: treeSha, truncated: false, tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blobSha, size: content.length }],
      });
      if (url.pathname === `/repos/fixture-org/service/git/blobs/${blobSha}`) return json(response, 200, {
        sha: blobSha, encoding: 'base64', content: `${content.toString('base64')}\n`,
      });
      return json(response, 404, { message: 'fixture route missing' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const fetchImpl = async (apiUrl, options) => {
    assert.equal(apiUrl.origin, 'https://api.github.com', 'service always constructs the fixed provider host');
    const response = await fetch(`http://127.0.0.1:${port}${apiUrl.pathname}${apiUrl.search}`, {
      ...options, redirect: 'manual',
    });
    return new Proxy(response, { get(target, property) {
      if (property === 'url') return '';
      return Reflect.get(target, property, target);
    } });
  };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { fetchImpl, calls, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

test('GitHub capture uses a one-repository read token and returns only pinned immutable content metadata', async (t) => {
  const fixtureData = await fixture(t);
  const ingestion = new GitHubSourceIngestion({ config: { appId: '123', privateKey: fixtureData.privateKey }, fetchImpl: fixtureData.fetchImpl });
  const captured = await ingestion.capture({ installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' });
  assert.equal(captured.repositoryId, '987654');
  assert.equal(captured.snapshot.commitOid, 'a'.repeat(40));
  assert.equal(captured.snapshot.treeOid, 'b'.repeat(40));
  assert.equal(captured.snapshot.fileCount, 1);
  assert.equal(Buffer.from(captured.snapshot.files[0].contentBase64, 'base64').toString(), 'fixture README\n');
  const mint = fixtureData.calls.find((call) => call.url.pathname.endsWith('/access_tokens'));
  assert.deepEqual(JSON.parse(mint.body), { repository_ids: [987654], permissions: { metadata: 'read', contents: 'read' } });
  assert.ok(fixtureData.calls.filter((call) => call.url.pathname.includes('/git/')).every((call) => call.auth === 'Bearer fixture-installation-token'));
  assert.ok(fixtureData.calls.filter((call) => call.url.pathname.includes('/app/installations/')).every((call) => call.auth?.startsWith('Bearer eyJ')));
  assert.equal(JSON.stringify(captured).includes('fixture-installation-token'), false);
});

test('GitHub capture rejects ungranted repositories, noncanonical refs, redirects, truncation and entry-limit overflow', async (t) => {
  const missing = await fixture(t, { repositoryIds: ['1'] });
  const source = new GitHubSourceIngestion({ config: { appId: '123', privateKey: missing.privateKey }, fetchImpl: missing.fetchImpl });
  await assert.rejects(source.capture({ installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' }), /does not currently grant/);
  assert.equal(missing.calls.some((call) => call.url.pathname.endsWith('/access_tokens')), false);
  await assert.rejects(source.capture({ installationId: '123', repositoryId: '987654', branchRef: 'main' }), /canonical full/);
  assert.equal(missing.calls.length, 1, 'invalid refs fail before any provider request');

  const redirected = await fixture(t, { redirect: true });
  const redirectedSource = new GitHubSourceIngestion({ config: { appId: '123', privateKey: redirected.privateKey }, fetchImpl: redirected.fetchImpl });
  await assert.rejects(redirectedSource.capture({ installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' }), /redirects are rejected/);

  const truncated = await fixture(t, { tree: { sha: 'b'.repeat(40), truncated: true, tree: [] } });
  const truncatedSource = new GitHubSourceIngestion({ config: { appId: '123', privateKey: truncated.privateKey }, fetchImpl: truncated.fetchImpl });
  await assert.rejects(truncatedSource.capture({ installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' }), /truncated/);

  const oversized = await fixture(t, { tree: { sha: 'b'.repeat(40), truncated: false, tree: Array.from({ length: 501 }, (_, index) => ({
    path: `file-${index}`, mode: '100644', type: 'blob', sha: 'c'.repeat(40), size: 1,
  })) } });
  const oversizedSource = new GitHubSourceIngestion({ config: { appId: '123', privateKey: oversized.privateKey }, fetchImpl: oversized.fetchImpl });
  await assert.rejects(oversizedSource.capture({ installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' }), /unsupported entry or exceeds/);
});

test('GitHub capture refuses submodules, symlinks and unsafe paths before fetching blob content', async (t) => {
  for (const entry of [
    { path: 'link', mode: '120000', type: 'blob', sha: 'c'.repeat(40), size: 1 },
    { path: 'submodule', mode: '160000', type: 'commit', sha: 'c'.repeat(40), size: 0 },
    { path: '../outside', mode: '100644', type: 'blob', sha: 'c'.repeat(40), size: 1 },
  ]) {
    const setup = await fixture(t, { tree: { sha: 'b'.repeat(40), truncated: false, tree: [entry] } });
    const source = new GitHubSourceIngestion({ config: { appId: '123', privateKey: setup.privateKey }, fetchImpl: setup.fetchImpl });
    await assert.rejects(source.capture({ installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' }));
  }
});

test('GitHub capture rejects token responses with missing or broader permissions or missing/wrong repository scope', async (t) => {
  const tokenResponseCases = [
    { token: 'fixture-installation-token', repositories: [{ id: '987654' }] },
    { token: 'fixture-installation-token', permissions: { metadata: 'read', contents: 'read' } },
    { token: 'fixture-installation-token', permissions: { metadata: 'read', contents: 'read', issues: 'write' }, repositories: [{ id: '987654' }] },
    { token: 'fixture-installation-token', permissions: { metadata: 'read', contents: 'read' }, repositories: [{ id: '111111' }] },
  ];
  for (const tokenResponse of tokenResponseCases) {
    const setup = await fixture(t, { tokenResponse });
    const source = new GitHubSourceIngestion({ config: { appId: '123', privateKey: setup.privateKey }, fetchImpl: setup.fetchImpl });
    await assert.rejects(source.capture({ installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' }), {
      code: 'GITHUB_SOURCE_INVALID',
    });
    assert.equal(setup.calls.some((call) => call.url.pathname.includes('/git/')), false,
      'a token with unverifiable or broader scope is never used for repository reads');
  }
});

test('GitHub response byte limit is enforced while streaming with missing Content-Length', async (t) => {
  const setup = await fixture(t, { oversizedResponse: true });
  const source = new GitHubSourceIngestion({ config: { appId: '123', privateKey: setup.privateKey }, fetchImpl: setup.fetchImpl });
  await assert.rejects(source.capture({ installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' }), {
    code: 'GITHUB_SOURCE_RESPONSE_TOO_LARGE',
  });
  assert.equal(setup.calls.length, 1, 'capture cancels an oversized response before making another request');
});

test('GitHub numeric IDs preserve the maximum exactly representable provider integer and reject larger values before requests', async (t) => {
  const max = String(Number.MAX_SAFE_INTEGER);
  const setup = await fixture(t, { repositoryIds: [max], installationId: max });
  const source = new GitHubSourceIngestion({ config: { appId: max, privateKey: setup.privateKey }, fetchImpl: setup.fetchImpl });
  const captured = await source.capture({ installationId: max, repositoryId: max, branchRef: 'refs/heads/main' });
  assert.equal(captured.installationId, max);
  assert.equal(captured.repositoryId, max);
  assert.deepEqual(JSON.parse(setup.calls.find((call) => call.url.pathname.endsWith('/access_tokens')).body), {
    repository_ids: [Number.MAX_SAFE_INTEGER], permissions: { metadata: 'read', contents: 'read' },
  });
  const beforeInvalid = setup.calls.length;
  await assert.rejects(source.capture({ installationId: max, repositoryId: '9007199254740992', branchRef: 'refs/heads/main' }), /numeric GitHub IDs/);
  assert.equal(setup.calls.length, beforeInvalid);
});
