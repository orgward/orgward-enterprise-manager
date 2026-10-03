import { createHash, createSign } from 'node:crypto';

const API = 'https://api.github.com';
const OAUTH = 'https://github.com';
const POLICY_VERSION = 'github-read-snapshot-v1';
const MAX_FILES = 500;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 8_000_000;
const MAX_TREE_ENTRIES = 5_000;
const MAX_RESPONSE_BYTES = 10_000_000;
const MAX_JOB_MS = 30_000;
const MAX_EXACT_GITHUB_ID = Number.MAX_SAFE_INTEGER;

function invalid(message, code = 'GITHUB_SOURCE_INVALID') {
  throw Object.assign(new Error(message), { statusCode: 400, code, retryable: false });
}

function safeRef(ref) {
  return typeof ref === 'string' && ref.length <= 255 && ref.startsWith('refs/heads/')
    && ref.split('/').every((segment) => segment && segment !== '.' && segment !== '..'
      && !segment.startsWith('.') && !segment.endsWith('.') && !segment.endsWith('.lock')
      && !segment.includes('..') && !segment.includes('@{') && !/[\x00-\x20\x7f~^:?*\\[]/.test(segment));
}

function safePath(value) {
  return typeof value === 'string' && value.length <= 1024 && !value.startsWith('/')
    && !value.includes('\\') && !/[\x00-\x1f\x7f:]/.test(value)
    && value.split('/').length <= 32 && value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function gitBlobSha(bytes) { return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
function encoded(value) { return encodeURIComponent(String(value)); }

function appJwt({ appId, privateKey, now = Date.now() }) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: Math.floor(now / 1000) - 30, exp: Math.floor(now / 1000) + 540, iss: appId })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  return `${unsigned}.${signer.sign(privateKey, 'base64url')}`;
}

export class GitHubSourceIngestion {
  constructor({ config = null, fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  get configured() { return Boolean(this.config?.appId && this.config?.privateKey); }
  get installationFlowConfigured() {
    return Boolean(this.configured && /^[a-z0-9-]{1,39}$/.test(this.config?.appSlug ?? '')
      && this.config?.clientId && this.config?.clientSecret && this.config?.oauthRedirectUri);
  }

  async verifyInstallation(installationId) {
    if (!this.configured) throw Object.assign(new Error('GitHub App repository onboarding is not configured.'), { statusCode: 503, code: 'GITHUB_SOURCE_UNCONFIGURED', retryable: false });
    if (!/^[1-9][0-9]{0,15}$/.test(String(installationId)) || !Number.isSafeInteger(Number(installationId))) {
      invalid('Provide a supported numeric GitHub installation ID.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAX_JOB_MS);
    try {
      const token = appJwt({ appId: this.config.appId, privateKey: this.config.privateKey, now: this.now() });
      const installation = await this.#json(`/app/installations/${encoded(installationId)}`, { token, signal: controller.signal });
      if (String(installation.id) !== String(installationId)
        || !Number.isSafeInteger(installation.app_id) || String(installation.app_id) !== String(this.config.appId)
        || !Number.isSafeInteger(installation.account?.id) || installation.account.id < 1
        || !/^[A-Za-z0-9_.-]{1,100}$/.test(installation.account?.login ?? '')
        || !['User', 'Organization', 'Enterprise'].includes(installation.account?.type)) {
        throw Object.assign(new Error('The returned GitHub installation is not owned by the configured GitHub App.'), {
          statusCode: 403, code: 'GITHUB_INSTALLATION_APP_MISMATCH', retryable: false,
        });
      }
      return { installationId: String(installation.id), appId: String(installation.app_id),
        accountId: String(installation.account.id), accountLogin: installation.account.login, accountType: installation.account.type };
    } finally { clearTimeout(timer); }
  }

  async listInstallationRepositories(installationId) {
    if (!this.configured) throw Object.assign(new Error('GitHub App repository onboarding is not configured.'), {
      statusCode: 503, code: 'GITHUB_SOURCE_UNCONFIGURED', retryable: false,
    });
    if (!/^[1-9][0-9]{0,15}$/.test(String(installationId))
      || !Number.isSafeInteger(Number(installationId)) || Number(installationId) > MAX_EXACT_GITHUB_ID) {
      invalid(`Provide a GitHub installation ID from 1 through ${MAX_EXACT_GITHUB_ID}.`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAX_JOB_MS);
    let installationToken = null;
    try {
      const appToken = appJwt({ appId: this.config.appId, privateKey: this.config.privateKey, now: this.now() });
      installationToken = await this.#mintInstallationToken(installationId, appToken, { permissions: { metadata: 'read' }, signal: controller.signal });
      const repositories = await this.#listInstallationRepositories(installationToken, controller.signal);
      return repositories.map((repository) => ({
        repositoryId: String(repository.id), name: repository.name,
        fullName: `${repository.owner.login}/${repository.name}`, ownerLogin: repository.owner.login,
        defaultBranch: repository.default_branch ?? null, private: repository.private === true,
      }));
    } finally {
      if (installationToken) await this.#revokeInstallationToken(installationToken);
      installationToken = null;
      clearTimeout(timer);
    }
  }

  async #mintInstallationToken(installationId, appToken, { permissions, repositoryId, signal }) {
    const body = { permissions, ...(repositoryId ? { repository_ids: [Number(repositoryId)] } : {}) };
    const minted = await this.#json(`/app/installations/${encoded(installationId)}/access_tokens`, {
      method: 'POST', token: appToken, body, signal,
    });
    const token = typeof minted.token === 'string' && minted.token.length <= 4096 ? minted.token : null;
    const expectedPermissions = permissions;
    const actualPermissions = minted.permissions;
    const exactPermissions = actualPermissions && Object.keys(actualPermissions).length === Object.keys(expectedPermissions).length
      && Object.entries(expectedPermissions).every(([name, value]) => actualPermissions[name] === value);
    const exactRepository = !repositoryId || (Array.isArray(minted.repositories) && minted.repositories.length === 1
      && String(minted.repositories[0]?.id) === String(repositoryId));
    if (!token || !exactPermissions || !exactRepository) {
      if (token) await this.#revokeInstallationToken(token);
      invalid('GitHub returned an installation token without exactly the requested repository and read permissions.');
    }
    return token;
  }

  async #revokeInstallationToken(token) {
    const url = new URL('/installation/token', API);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await this.fetchImpl(url, { method: 'DELETE', redirect: 'manual', signal: controller.signal,
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${token}` } });
      if ((response.url && new URL(response.url).origin !== API) || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel?.().catch(() => {});
        return;
      }
      await response.body?.cancel?.().catch(() => {});
    } catch { /* Token revocation is best-effort; the short-lived token remains scoped and is discarded. */ }
    finally { clearTimeout(timer); }
  }

  async #listInstallationRepositories(installationToken, signal) {
    const repositories = [];
    const seen = new Set();
    let expectedTotal = null;
    for (let page = 1; page <= 10; page += 1) {
      const result = await this.#json(`/installation/repositories?per_page=100&page=${page}`, { token: installationToken, signal });
      if (!Number.isSafeInteger(result.total_count) || result.total_count < 0 || result.total_count > 1000
        || !Array.isArray(result.repositories) || result.repositories.length > 100) invalid('GitHub installation repository list is malformed or exceeded the 1,000 repository limit.');
      if (expectedTotal === null) expectedTotal = result.total_count;
      if (result.total_count !== expectedTotal || repositories.length + result.repositories.length > expectedTotal) {
        invalid('GitHub installation repository list changed during pagination.');
      }
      for (const repository of result.repositories) {
        const id = String(repository?.id ?? '');
        const ownerLogin = repository?.owner?.login;
        if (!/^[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > MAX_EXACT_GITHUB_ID
          || seen.has(id) || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/.test(ownerLogin ?? '')
          || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository?.name ?? '')
          || (repository.default_branch !== undefined && repository.default_branch !== null
            && (typeof repository.default_branch !== 'string' || repository.default_branch.length > 255 || /[\x00-\x1f\x7f]/.test(repository.default_branch)))) {
          invalid('GitHub installation repository list contains an invalid or duplicate repository.');
        }
        seen.add(id);
        repositories.push(repository);
        if (repositories.length > 1000) invalid('GitHub installation repository list exceeded the bounded repository limit.');
      }
      if (repositories.length === expectedTotal) return repositories;
      if (result.repositories.length < 100) invalid('GitHub installation repository list was incomplete.');
    }
    invalid('GitHub installation repository list exceeded the bounded page limit.');
  }

  async verifyOAuthInstallationAccess({ code, installation }) {
    if (!this.installationFlowConfigured) throw Object.assign(new Error('GitHub App user authorization is not configured.'), {
      statusCode: 503, code: 'GITHUB_INSTALLATION_FLOW_UNAVAILABLE', retryable: false,
    });
    if (typeof code !== 'string' || !/^[A-Za-z0-9._-]{1,512}$/.test(code)
      || !installation || !['User', 'Organization'].includes(installation.accountType)
      || !/^[1-9][0-9]{0,15}$/.test(String(installation.accountId ?? ''))
      || !/^[A-Za-z0-9_.-]{1,100}$/.test(installation.accountLogin ?? '')) {
      throw Object.assign(new Error('GitHub user authorization could not verify this installation.'), {
        statusCode: 403, code: 'GITHUB_INSTALLATION_USER_AUTHORIZATION_DENIED', retryable: false,
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAX_JOB_MS);
    try {
      const tokenResponse = await this.#requestJson(new URL('/login/oauth/access_token', OAUTH), {
        method: 'POST', oauth: true,
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret,
          code, redirect_uri: this.config.oauthRedirectUri }), signal: controller.signal,
      });
      const userToken = tokenResponse.access_token;
      if (typeof userToken !== 'string' || !userToken || userToken.length > 4096
        || tokenResponse.error || tokenResponse.token_type !== 'bearer') {
        throw Object.assign(new Error('GitHub user authorization was not granted.'), {
          statusCode: 403, code: 'GITHUB_INSTALLATION_USER_AUTHORIZATION_DENIED', retryable: false,
        });
      }
      const user = await this.#json('/user', { token: userToken, signal: controller.signal });
      if (!Number.isSafeInteger(user.id) || user.id < 1 || !/^[A-Za-z0-9_.-]{1,100}$/.test(user.login ?? '')) {
        throw Object.assign(new Error('GitHub user authorization returned an invalid identity.'), {
          statusCode: 403, code: 'GITHUB_INSTALLATION_USER_AUTHORIZATION_DENIED', retryable: false,
        });
      }
      let authorized = false;
      if (installation.accountType === 'User') {
        authorized = String(user.id) === String(installation.accountId)
          && user.login.toLowerCase() === installation.accountLogin.toLowerCase();
      } else {
        const membership = await this.#json(`/user/memberships/orgs/${encoded(installation.accountLogin)}`, {
          token: userToken, signal: controller.signal,
        });
        authorized = membership.state === 'active' && membership.role === 'admin'
          && String(membership.organization?.id) === String(installation.accountId)
          && String(membership.organization?.login ?? '').toLowerCase() === installation.accountLogin.toLowerCase();
      }
      if (!authorized) throw Object.assign(new Error('The GitHub user is not an owner of this installation account.'), {
        statusCode: 403, code: 'GITHUB_INSTALLATION_USER_AUTHORIZATION_DENIED', retryable: false,
      });
      return { githubUserId: String(user.id), githubUserLogin: user.login };
    } finally { clearTimeout(timer); }
  }

  async #json(path, { method = 'GET', token, body, signal } = {}) {
    const url = new URL(path, API);
    if (url.origin !== API || !url.pathname.startsWith('/')) invalid('GitHub API host is fixed.', 'GITHUB_SOURCE_TRANSPORT_REJECTED');
    return this.#requestJson(url, { method, token, body, signal });
  }

  async #requestJson(url, { method = 'GET', token, body, signal, oauth = false } = {}) {
    const expectedOrigin = oauth ? OAUTH : API;
    if (!(url instanceof URL) || url.origin !== expectedOrigin || !url.pathname.startsWith('/')) {
      invalid('GitHub API host is fixed.', 'GITHUB_SOURCE_TRANSPORT_REJECTED');
    }
    let response;
    try {
      response = await this.fetchImpl(url, {
        method, redirect: 'manual', signal,
        headers: {
          accept: oauth ? 'application/json' : 'application/vnd.github+json',
          ...(!oauth ? { 'x-github-api-version': '2022-11-28' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json' } : {}),
        },
        ...(body ? { body: body instanceof URLSearchParams ? body.toString() : JSON.stringify(body) } : {}),
      });
    } catch {
      throw Object.assign(new Error('GitHub source request failed.'), { statusCode: 502, code: 'GITHUB_SOURCE_REQUEST_FAILED', retryable: true });
    }
    if (response.url && new URL(response.url).origin !== expectedOrigin) invalid('GitHub API redirects or host changes are rejected.', 'GITHUB_SOURCE_TRANSPORT_REJECTED');
    if (response.status >= 300 && response.status < 400) invalid('GitHub API redirects are rejected.', 'GITHUB_SOURCE_TRANSPORT_REJECTED');
    const declared = Number(response.headers?.get?.('content-length') ?? 0);
    if (declared > MAX_RESPONSE_BYTES) {
      await response.body?.cancel?.().catch(() => {});
      invalid('GitHub API response exceeds the bounded response limit.', 'GITHUB_SOURCE_RESPONSE_TOO_LARGE');
    }
    const reader = response.body?.getReader?.();
    if (!reader) invalid('GitHub API response body is missing.');
    const chunks = [];
    let responseBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        responseBytes += value.byteLength;
        if (responseBytes > MAX_RESPONSE_BYTES) {
          await reader.cancel('GitHub API response exceeded its byte limit.').catch(() => {});
          invalid('GitHub API response exceeds the bounded response limit.', 'GITHUB_SOURCE_RESPONSE_TOO_LARGE');
        }
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error?.statusCode) throw error;
      throw Object.assign(new Error('GitHub source response could not be read.'), { statusCode: 502, code: 'GITHUB_SOURCE_RESPONSE_INVALID' });
    } finally {
      try { reader.releaseLock(); } catch { /* A cancelled or errored stream may already be released. */ }
    }
    const text = Buffer.concat(chunks, responseBytes).toString('utf8');
    let payload;
    try { payload = JSON.parse(text); } catch { payload = null; }
    if (!response.ok) {
      throw Object.assign(new Error('GitHub did not authorize or provide the requested repository source.'), {
        statusCode: response.status === 404 ? 404 : 502,
        code: response.status === 404 ? 'GITHUB_SOURCE_NOT_FOUND' : 'GITHUB_SOURCE_PROVIDER_ERROR', retryable: response.status >= 500,
      });
    }
    if (!payload || typeof payload !== 'object') invalid('GitHub API returned an invalid response.');
    return payload;
  }

  async capture({ installationId, repositoryId, branchRef }) {
    if (!this.configured) throw Object.assign(new Error('GitHub App repository onboarding is not configured.'), { statusCode: 503, code: 'GITHUB_SOURCE_UNCONFIGURED', retryable: false });
    if (!/^[1-9][0-9]{0,15}$/.test(String(installationId)) || !/^[1-9][0-9]{0,15}$/.test(String(repositoryId))
      || !Number.isSafeInteger(Number(installationId)) || Number(installationId) > MAX_EXACT_GITHUB_ID
      || !Number.isSafeInteger(Number(repositoryId)) || Number(repositoryId) > MAX_EXACT_GITHUB_ID || !safeRef(branchRef)) {
      invalid(`Provide numeric GitHub IDs from 1 through ${MAX_EXACT_GITHUB_ID} and one canonical full refs/heads branch ref.`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAX_JOB_MS);
    let installationToken = null;
    try {
      const appToken = appJwt({ appId: this.config.appId, privateKey: this.config.privateKey, now: this.now() });
      let discoveryToken = null;
      let repositories;
      try {
        discoveryToken = await this.#mintInstallationToken(installationId, appToken,
          { permissions: { metadata: 'read' }, signal: controller.signal });
        repositories = await this.#listInstallationRepositories(discoveryToken, controller.signal);
      } finally {
        if (discoveryToken) await this.#revokeInstallationToken(discoveryToken);
        discoveryToken = null;
      }
      const repository = repositories.find((item) => String(item.id) === String(repositoryId));
      if (!repository || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/.test(repository.owner?.login ?? '')
        || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository.name ?? '')) {
        throw Object.assign(new Error('The GitHub installation does not currently grant this exact repository.'), { statusCode: 403, code: 'GITHUB_REPOSITORY_NOT_GRANTED', retryable: false });
      }
      installationToken = await this.#mintInstallationToken(installationId, appToken,
        { repositoryId, permissions: { metadata: 'read', contents: 'read' }, signal: controller.signal });
      const [owner, repo] = [repository.owner.login, repository.name].map(encoded);
      const refPath = branchRef.slice('refs/heads/'.length).split('/').map(encoded).join('/');
      const ref = await this.#json(`/repos/${owner}/${repo}/git/ref/heads/${refPath}`, { token: installationToken, signal: controller.signal });
      if (ref.ref !== branchRef || !/^[a-f0-9]{40}$/.test(ref.object?.sha ?? '') || ref.object?.type !== 'commit') invalid('The selected branch ref did not resolve to a canonical commit.');
      const commit = await this.#json(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`, { token: installationToken, signal: controller.signal });
      const commitOid = commit.sha;
      const treeOid = commit.tree?.sha;
      if (commitOid !== ref.object.sha || !/^[a-f0-9]{40}$/.test(treeOid ?? '')) invalid('GitHub returned a malformed pinned commit or tree.');
      const tree = await this.#json(`/repos/${owner}/${repo}/git/trees/${treeOid}?recursive=1`, { token: installationToken, signal: controller.signal });
      if (tree.sha !== treeOid || tree.truncated === true || !Array.isArray(tree.tree) || tree.tree.length > MAX_TREE_ENTRIES) invalid('The GitHub tree was truncated, malformed, or exceeded the traversal limit.');
      const files = [];
      let totalBytes = 0;
      let declaredBytes = 0;
      const seenPaths = new Set();
      const blobEntries = [];
      for (const entry of tree.tree) {
        if (!entry || !safePath(entry.path) || seenPaths.has(entry.path)) invalid('The GitHub tree contains an unsafe or duplicate path.');
        seenPaths.add(entry.path);
        if (entry.type === 'tree') {
          if (entry.mode !== '040000' || !/^[a-f0-9]{40}$/.test(entry.sha ?? '')) invalid('The GitHub tree contains an unsupported directory entry.');
          continue;
        }
        if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || !/^[a-f0-9]{40}$/.test(entry.sha ?? '')
          || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES
          || blobEntries.length >= MAX_FILES || declaredBytes + entry.size > MAX_TOTAL_BYTES) invalid('The GitHub tree contains an unsupported entry or exceeds file/byte limits.');
        blobEntries.push(entry);
        declaredBytes += entry.size;
      }
      for (const entry of blobEntries) {
        const blob = await this.#json(`/repos/${owner}/${repo}/git/blobs/${entry.sha}`, { token: installationToken, signal: controller.signal });
        if (blob.sha !== entry.sha || blob.encoding !== 'base64' || typeof blob.content !== 'string') invalid('GitHub returned a malformed blob.');
        const normalized = blob.content.replace(/\s/g, '');
        const bytes = Buffer.from(normalized, 'base64');
        if (bytes.length !== entry.size || gitBlobSha(bytes) !== entry.sha) invalid('GitHub blob content failed size or object identity verification.');
        const contentHash = sha256(bytes);
        files.push({ path: entry.path, mode: entry.mode, size: bytes.length, contentHash, contentBase64: bytes.toString('base64'), blobSha: entry.sha });
        totalBytes += bytes.length;
      }
      files.sort((left, right) => left.path.localeCompare(right.path));
      const treeDigest = sha256(JSON.stringify(files.map(({ path, mode, contentHash, size, blobSha }) => ({ path, mode, contentHash, size, blobSha }))));
      const snapshot = {
        id: sha256(`${repositoryId}\0${branchRef}\0${commitOid}\0${POLICY_VERSION}`),
        repositoryId: String(repositoryId), branchRef, commitOid, treeOid,
        manifestDigest: treeDigest, treeDigest, policyVersion: POLICY_VERSION,
        fileCount: files.length, totalBytes, files, capturedAt: new Date(this.now()).toISOString(),
      };
      return { installationId: String(installationId), repositoryId: String(repositoryId), branchRef, repositoryName: `${repository.owner.login}/${repository.name}`, snapshot };
    } finally {
      if (installationToken) await this.#revokeInstallationToken(installationToken);
      installationToken = null;
      clearTimeout(timer);
    }
  }
}

export const githubSourceLimits = Object.freeze({ maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES, policyVersion: POLICY_VERSION });
