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
  installationId = '123', oversizedResponse = false, tokenResponse = null,
  discoveryTokenResponse = null,
  installationResponse = null, oauthTokenResponse = null, userResponse = null, membershipResponse = null } = {}) {
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
      if (url.pathname === `/app/installations/${installationId}`) return json(response, 200, installationResponse ?? {
        id: Number(installationId), app_id: 123, account: { id: 456, login: 'fixture-org', type: 'Organization' },
      });
      if (url.pathname === '/login/oauth/access_token') return json(response, 200, oauthTokenResponse ?? {
        access_token: 'fixture-user-access-token', token_type: 'bearer', scope: '',
      });
      if (url.pathname === '/user') return json(response, 200, userResponse ?? { id: 789, login: 'fixture-admin' });
      if (url.pathname === '/user/memberships/orgs/fixture-org') return json(response, 200, membershipResponse ?? {
        state: 'active', role: 'admin', organization: { id: 456, login: 'fixture-org' },
      });
      if (url.pathname === `/app/installations/${installationId}/access_tokens`) {
        const tokenRequest = JSON.parse(call.body);
        const discoveryRequest = Object.keys(tokenRequest.permissions ?? {}).length === 1
          && tokenRequest.permissions.metadata === 'read' && tokenRequest.repository_ids === undefined;
        return json(response, 201, (discoveryRequest ? discoveryTokenResponse : tokenResponse) ?? (discoveryRequest ? {
          token: 'fixture-discovery-token', expires_at: '2099-01-01T00:00:00Z', permissions: { metadata: 'read' },
        } : {
          token: 'fixture-installation-token', expires_at: '2099-01-01T00:00:00Z',
          permissions: { metadata: 'read', contents: 'read' }, repository_selection: 'selected',
          repositories: [{ id: repositoryIds[0], name: 'service', owner: { login: 'fixture-org' } }],
        }));
      }
      if (url.pathname === '/installation/repositories') {
        if (oversizedResponse) {
          response.writeHead(200, { 'content-type': 'application/json' });
          return response.end(Buffer.alloc(10_000_001, 0x20));
        }
        if (call.auth !== 'Bearer fixture-discovery-token') return json(response, 401, { message: 'installation token required' });
        const page = Number(url.searchParams.get('page') ?? '1');
        const pageIds = repositoryIds.slice((page - 1) * 100, page * 100);
        return json(response, 200, { total_count: repositoryIds.length,
          repositories: pageIds.map((id) => ({ id, name: 'service', full_name: 'fixture-org/service',
            default_branch: 'main', private: true, owner: { login: 'fixture-org' } })) });
      }
      if (url.pathname === '/installation/token' && request.method === 'DELETE') {
        response.writeHead(204);
        return response.end();
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
    assert.ok(['https://api.github.com', 'https://github.com'].includes(apiUrl.origin), 'service uses only fixed GitHub API/OAuth hosts');
    if (apiUrl.origin === 'https://github.com') assert.equal(options.headers.accept, 'application/json');
    else assert.equal(options.headers.accept, 'application/vnd.github+json');
    const response = await fetch(`http://127.0.0.1:${port}${apiUrl.pathname}${apiUrl.search}`, {
      ...options, redirect: 'manual',
    });
    if (calls.length) calls.at(-1).providerOrigin = apiUrl.origin;
    return new Proxy(response, { get(target, property) {
      if (property === 'url') return '';
      return Reflect.get(target, property, target);
    } });
  };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { fetchImpl, calls, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

test('installation repository discovery returns bounded safe metadata through its installation access token', async (t) => {
  const setup = await fixture(t);
  const ingestion = new GitHubSourceIngestion({ config: { appId: '123', privateKey: setup.privateKey }, fetchImpl: setup.fetchImpl });
  const repositories = await ingestion.listInstallationRepositories('123');
  assert.deepEqual(repositories, [{ repositoryId: '987654', name: 'service', fullName: 'fixture-org/service',
    ownerLogin: 'fixture-org', defaultBranch: 'main', private: true }]);
  assert.deepEqual(setup.calls.map(({ method, url }) => [method, url.pathname]), [
    ['POST', '/app/installations/123/access_tokens'], ['GET', '/installation/repositories'], ['DELETE', '/installation/token'],
  ]);
  assert.match(setup.calls[0].auth, /^Bearer eyJ/, 'the App JWT is used only to mint a metadata-only installation token');
  assert.deepEqual(JSON.parse(setup.calls[0].body), { permissions: { metadata: 'read' } });
  assert.equal(setup.calls[1].auth, 'Bearer fixture-discovery-token');
  assert.equal(setup.calls[2].auth, 'Bearer fixture-discovery-token', 'the discovery token is revoked after listing');
  assert.doesNotMatch(JSON.stringify(repositories), /fixture-discovery-token|fixture-installation-token|BEGIN PRIVATE KEY/);
  await assert.rejects(ingestion.listInstallationRepositories('9007199254740992'), /GitHub installation ID/);
});

test('installation repository discovery accepts exactly 1,000 repositories across ten pages', async (t) => {
  const setup = await fixture(t, { repositoryIds: Array.from({ length: 1000 }, (_, index) => String(index + 1)) });
  const ingestion = new GitHubSourceIngestion({ config: { appId: '123', privateKey: setup.privateKey }, fetchImpl: setup.fetchImpl });
  const repositories = await ingestion.listInstallationRepositories('123');
  assert.equal(repositories.length, 1000);
  assert.equal(setup.calls.filter((call) => call.url.pathname === '/installation/repositories').length, 10);
  assert.equal(setup.calls.at(-1).url.pathname, '/installation/token');
  const overLimit = await fixture(t, { repositoryIds: Array.from({ length: 1001 }, (_, index) => String(index + 1)) });
  const overLimitIngestion = new GitHubSourceIngestion({ config: { appId: '123', privateKey: overLimit.privateKey }, fetchImpl: overLimit.fetchImpl });
  await assert.rejects(overLimitIngestion.listInstallationRepositories('123'), /1,000 repository limit/);
  assert.equal(overLimit.calls.at(-1).url.pathname, '/installation/token', 'the token is revoked when the list exceeds its cap');
});

test('repository discovery rejects any token permission beyond metadata read and revokes that token', async (t) => {
  const setup = await fixture(t, { discoveryTokenResponse: {
    token: 'fixture-discovery-token', permissions: { metadata: 'read', contents: 'read' },
  } });
  const ingestion = new GitHubSourceIngestion({ config: { appId: '123', privateKey: setup.privateKey }, fetchImpl: setup.fetchImpl });
  await assert.rejects(ingestion.listInstallationRepositories('123'), { code: 'GITHUB_SOURCE_INVALID' });
  assert.equal(setup.calls.some((call) => call.url.pathname === '/installation/repositories'), false,
    'a broader token is never used for listing');
  assert.equal(setup.calls.at(-1).url.pathname, '/installation/token', 'the rejected token is revoked');
});

test('GitHub capture uses a one-repository read token and returns only pinned immutable content metadata', async (t) => {
  const fixtureData = await fixture(t);
  const ingestion = new GitHubSourceIngestion({ config: { appId: '123', privateKey: fixtureData.privateKey }, fetchImpl: fixtureData.fetchImpl });
  const captured = await ingestion.capture({ installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' });
  assert.equal(captured.repositoryId, '987654');
  assert.equal(captured.snapshot.commitOid, 'a'.repeat(40));
  assert.equal(captured.snapshot.treeOid, 'b'.repeat(40));
  assert.equal(captured.snapshot.fileCount, 1);
  assert.equal(Buffer.from(captured.snapshot.files[0].contentBase64, 'base64').toString(), 'fixture README\n');
  const mint = fixtureData.calls.find((call) => call.url.pathname.endsWith('/access_tokens')
    && JSON.parse(call.body).repository_ids);
  assert.deepEqual(JSON.parse(mint.body), { repository_ids: [987654], permissions: { metadata: 'read', contents: 'read' } });
  const discoveryMint = fixtureData.calls.find((call) => call.url.pathname.endsWith('/access_tokens')
    && JSON.parse(call.body).repository_ids === undefined);
  assert.deepEqual(JSON.parse(discoveryMint.body), { permissions: { metadata: 'read' } });
  assert.equal(fixtureData.calls.find((call) => call.url.pathname === '/installation/repositories').auth,
    'Bearer fixture-discovery-token');
  assert.equal(fixtureData.calls.filter((call) => call.url.pathname === '/installation/token').length, 2,
    'both temporary installation tokens are revoked when their work ends');
  assert.ok(fixtureData.calls.filter((call) => call.url.pathname.includes('/git/')).every((call) => call.auth === 'Bearer fixture-installation-token'));
  assert.ok(fixtureData.calls.filter((call) => call.url.pathname.startsWith('/app/installations/')).every((call) => call.auth?.startsWith('Bearer eyJ')));
  assert.equal(JSON.stringify(captured).includes('fixture-discovery-token'), false);
  assert.equal(JSON.stringify(captured).includes('fixture-installation-token'), false);
});

test('GitHub installation verification checks exact installation and configured App IDs with the fixed App API', async (t) => {
  const fixtureData = await fixture(t);
  const config = { appId: '123', privateKey: fixtureData.privateKey, appSlug: 'orgward-fixture',
    clientId: 'Iv1.fixture-client', clientSecret: 'fixture-oauth-client-secret',
    oauthRedirectUri: 'https://orgward.example/api/execution/github-installation/oauth-callback' };
  const ingestion = new GitHubSourceIngestion({ config, fetchImpl: fixtureData.fetchImpl });
  assert.equal(ingestion.installationFlowConfigured, true);
  const verified = await ingestion.verifyInstallation('123');
  assert.deepEqual(verified, { installationId: '123', appId: '123', accountId: '456', accountLogin: 'fixture-org', accountType: 'Organization' });
  const verificationCall = fixtureData.calls[0];
  assert.equal(verificationCall.providerOrigin, 'https://api.github.com', 'the injected transport observes the fixed API URL independently of its loopback fixture');
  assert.equal(verificationCall.url.pathname, '/app/installations/123');
  assert.match(verificationCall.auth, /^Bearer eyJ/);
  assert.equal(JSON.stringify(verified).includes('fixture-installation-token'), false);

  const wrongApp = await fixture(t, { installationResponse: { id: 123, app_id: 999, account: { login: 'fixture-org', type: 'Organization' } } });
  const wrongAppIngestion = new GitHubSourceIngestion({ config: { ...config, privateKey: wrongApp.privateKey }, fetchImpl: wrongApp.fetchImpl });
  await assert.rejects(wrongAppIngestion.verifyInstallation('123'), { code: 'GITHUB_INSTALLATION_APP_MISMATCH' });
  const wrongInstallation = await fixture(t, { installationResponse: { id: 124, app_id: 123, account: { login: 'fixture-org', type: 'Organization' } } });
  const wrongInstallationIngestion = new GitHubSourceIngestion({ config: { ...config, privateKey: wrongInstallation.privateKey }, fetchImpl: wrongInstallation.fetchImpl });
  await assert.rejects(wrongInstallationIngestion.verifyInstallation('123'), { code: 'GITHUB_INSTALLATION_APP_MISMATCH' });
});

test('GitHub installation binding proof requires the matching personal owner or an active organization admin', async (t) => {
  const setup = await fixture(t);
  const config = { appId: '123', privateKey: setup.privateKey, appSlug: 'orgward-fixture',
    clientId: 'Iv1.fixture-client', clientSecret: 'fixture-oauth-client-secret',
    oauthRedirectUri: 'https://orgward.example/api/execution/github-installation/oauth-callback' };
  const ingestion = new GitHubSourceIngestion({ config, fetchImpl: setup.fetchImpl });
  const installation = await ingestion.verifyInstallation('123');
  const proof = await ingestion.verifyOAuthInstallationAccess({ code: 'fixture-code', installation });
  assert.deepEqual(proof, { githubUserId: '789', githubUserLogin: 'fixture-admin' });
  assert.equal(setup.calls.find((call) => call.url.pathname === '/login/oauth/access_token').providerOrigin, 'https://github.com');
  assert.ok(setup.calls.filter((call) => call.url.pathname === '/user' || call.url.pathname.startsWith('/user/memberships/'))
    .every((call) => call.auth === 'Bearer fixture-user-access-token'));
  assert.equal(JSON.stringify(proof).includes('fixture-user-access-token'), false);

  const personalOwner = await fixture(t, { installationResponse: {
    id: 123, app_id: 123, account: { id: 456, login: 'fixture-account', type: 'User' },
  }, userResponse: { id: 456, login: 'fixture-account' } });
  const personalOwnerIngestion = new GitHubSourceIngestion({ config: { ...config, privateKey: personalOwner.privateKey }, fetchImpl: personalOwner.fetchImpl });
  const personalOwnerInstallation = await personalOwnerIngestion.verifyInstallation('123');
  assert.deepEqual(await personalOwnerIngestion.verifyOAuthInstallationAccess({ code: 'fixture-code', installation: personalOwnerInstallation }),
    { githubUserId: '456', githubUserLogin: 'fixture-account' });

  for (const membershipResponse of [
    { state: 'active', role: 'member', organization: { id: 456, login: 'fixture-org' } },
    { state: 'pending', role: 'admin', organization: { id: 456, login: 'fixture-org' } },
    { state: 'active', role: 'admin', organization: { id: 999, login: 'fixture-org' } },
  ]) {
    const denied = await fixture(t, { membershipResponse });
    const deniedIngestion = new GitHubSourceIngestion({ config: { ...config, privateKey: denied.privateKey }, fetchImpl: denied.fetchImpl });
    const deniedInstallation = await deniedIngestion.verifyInstallation('123');
    await assert.rejects(deniedIngestion.verifyOAuthInstallationAccess({ code: 'fixture-code', installation: deniedInstallation }),
      { code: 'GITHUB_INSTALLATION_USER_AUTHORIZATION_DENIED' });
  }
  const wrongPersonalOwner = await fixture(t, { installationResponse: {
    id: 123, app_id: 123, account: { id: 456, login: 'fixture-owner', type: 'User' },
  }, userResponse: { id: 789, login: 'other-user' } });
  const personalIngestion = new GitHubSourceIngestion({ config: { ...config, privateKey: wrongPersonalOwner.privateKey }, fetchImpl: wrongPersonalOwner.fetchImpl });
  const personalInstallation = await personalIngestion.verifyInstallation('123');
  await assert.rejects(personalIngestion.verifyOAuthInstallationAccess({ code: 'fixture-code', installation: personalInstallation }),
    { code: 'GITHUB_INSTALLATION_USER_AUTHORIZATION_DENIED' });
  await assert.rejects(ingestion.verifyOAuthInstallationAccess({ code: 'fixture-code', installation: {
    ...installation, accountType: 'Enterprise',
  } }), { code: 'GITHUB_INSTALLATION_USER_AUTHORIZATION_DENIED' });
});

test('GitHub capture rejects ungranted repositories, noncanonical refs, redirects, truncation and entry-limit overflow', async (t) => {
  const missing = await fixture(t, { repositoryIds: ['1'] });
  const source = new GitHubSourceIngestion({ config: { appId: '123', privateKey: missing.privateKey }, fetchImpl: missing.fetchImpl });
  await assert.rejects(source.capture({ installationId: '123', repositoryId: '987654', branchRef: 'refs/heads/main' }), /does not currently grant/);
  assert.equal(missing.calls.some((call) => call.url.pathname.endsWith('/access_tokens')
    && JSON.parse(call.body).repository_ids), false, 'an ungranted ID never gets a repository-content token');
  await assert.rejects(source.capture({ installationId: '123', repositoryId: '987654', branchRef: 'main' }), /canonical full/);
  assert.equal(missing.calls.length, 3, 'invalid refs fail before any provider request');

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
  assert.equal(setup.calls.filter((call) => call.url.pathname === '/installation/repositories').length, 1,
    'capture cancels an oversized repository response without pagination');
  assert.equal(setup.calls.at(-1).url.pathname, '/installation/token', 'the discovery token is revoked after the failed listing');
});

test('GitHub numeric IDs preserve the maximum exactly representable provider integer and reject larger values before requests', async (t) => {
  const max = String(Number.MAX_SAFE_INTEGER);
  const setup = await fixture(t, { repositoryIds: [max], installationId: max });
  const source = new GitHubSourceIngestion({ config: { appId: max, privateKey: setup.privateKey }, fetchImpl: setup.fetchImpl });
  const captured = await source.capture({ installationId: max, repositoryId: max, branchRef: 'refs/heads/main' });
  assert.equal(captured.installationId, max);
  assert.equal(captured.repositoryId, max);
  assert.deepEqual(JSON.parse(setup.calls.find((call) => call.url.pathname.endsWith('/access_tokens')
    && JSON.parse(call.body).repository_ids).body), {
    repository_ids: [Number.MAX_SAFE_INTEGER], permissions: { metadata: 'read', contents: 'read' },
  });
  const beforeInvalid = setup.calls.length;
  await assert.rejects(source.capture({ installationId: max, repositoryId: '9007199254740992', branchRef: 'refs/heads/main' }), /numeric GitHub IDs/);
  assert.equal(setup.calls.length, beforeInvalid);
});
