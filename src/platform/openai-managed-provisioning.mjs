const PRODUCTION_ORIGIN = 'https://api.openai.com';
const MAX_RESPONSE_BYTES = 8_192;
const REQUEST_TIMEOUT_MS = 8_000;
const KEY_LIFETIME_LIMIT_SECONDS = 31_536_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function identifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('missing response body');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('response too large');
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export class OpenAiManagedProvisioner {
  constructor({ adminApiKey, organizationId, endpoint = PRODUCTION_ORIGIN, fetchImpl = fetch }) {
    if (typeof adminApiKey !== 'string' || adminApiKey.length < 8 || adminApiKey.length > 2_048 || /[\r\n]/.test(adminApiKey)) {
      throw new Error('The protected OpenAI Admin API credential is unavailable.');
    }
    const parsed = new URL(endpoint);
    const loopbackTestEndpoint = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !loopbackTestEndpoint) || parsed.username || parsed.password || parsed.search || parsed.hash
      || (!loopbackTestEndpoint && parsed.origin !== PRODUCTION_ORIGIN) || !identifier(organizationId)) {
      throw new Error('The OpenAI Admin API configuration is invalid.');
    }
    this.adminApiKey = adminApiKey;
    this.organizationId = organizationId;
    this.origin = parsed.origin;
    this.fetchImpl = fetchImpl;
  }

  async #request(method, path, payload) {
    let response;
    try {
      response = await this.fetchImpl(`${this.origin}/v1/organization/${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${this.adminApiKey}`,
          'openai-organization': this.organizationId,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel();
        throw Object.assign(new Error('OpenAI Admin API request was not confirmed.'), { ambiguous: response.status >= 500 });
      }
      return await boundedJson(response);
    } catch (error) {
      try { await response?.body?.cancel(); } catch { /* Provider details are never returned or logged. */ }
      throw Object.assign(new Error('OpenAI Admin API response was unavailable or ambiguous.'), { ambiguous: true });
    }
  }

  async createServiceAccount({ projectId, name }) {
    if (!identifier(projectId) || typeof name !== 'string' || !/^orgward-[a-f0-9-]{36}$/.test(name)) throw new Error('Invalid managed service-account target.');
    const response = await this.#request('POST', `projects/${encodeURIComponent(projectId)}/service_accounts`, {
      name,
      create_service_account_only: true,
    });
    if (!identifier(response?.id) || response.role !== 'none' || response.api_key != null) {
      throw Object.assign(new Error('OpenAI did not confirm a no-key service account.'), {
        ambiguous: true, invalidResponse: true, ...(identifier(response?.id) ? { serviceAccountId: response.id } : {}),
      });
    }
    return { serviceAccountId: response.id };
  }

  async assignMemberRole({ projectId, serviceAccountId }) {
    if (!identifier(projectId) || !identifier(serviceAccountId)) throw new Error('Invalid managed service-account target.');
    const response = await this.#request('POST', `projects/${encodeURIComponent(projectId)}/service_accounts/${encodeURIComponent(serviceAccountId)}`, { role: 'member' });
    if (response?.id !== serviceAccountId || response?.role !== 'member') {
      throw Object.assign(new Error('OpenAI did not confirm the member role.'), { ambiguous: true, invalidResponse: true });
    }
  }

  async createScopedApiKey({ projectId, serviceAccountId, expiresInSeconds, name }) {
    if (!identifier(projectId) || !identifier(serviceAccountId) || !Number.isSafeInteger(expiresInSeconds)
      || expiresInSeconds < 1 || expiresInSeconds > KEY_LIFETIME_LIMIT_SECONDS
      || typeof name !== 'string' || !/^orgward-[a-f0-9-]{36}$/.test(name)) throw new Error('Invalid managed API-key request.');
    const response = await this.#request('POST', `projects/${encodeURIComponent(projectId)}/service_accounts/${encodeURIComponent(serviceAccountId)}/api_keys`, {
      name,
      expires_in_seconds: expiresInSeconds,
      scopes: ['api.model.read', 'api.responses.write'],
    });
    const validExpiry = Number.isSafeInteger(response?.created_at) && Number.isSafeInteger(response?.expires_at)
      && response.expires_at > response.created_at && response.expires_at - response.created_at === expiresInSeconds;
    if (!identifier(response?.id) || typeof response.value !== 'string' || response.value.length < 8
      || Buffer.byteLength(response.value) > 65_536 || !validExpiry) {
      throw Object.assign(new Error('OpenAI did not return a valid scoped API key.'), {
        ambiguous: true, invalidResponse: true,
        ...(identifier(response?.id) ? { apiKeyId: response.id } : {}),
        serviceAccountId,
      });
    }
    return { apiKeyId: response.id, value: response.value, expiresAt: response.expires_at };
  }
}

export const OPENAI_MANAGED_PROVISIONING_LIMITS = Object.freeze({
  origin: PRODUCTION_ORIGIN,
  timeoutMs: REQUEST_TIMEOUT_MS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxKeyLifetimeSeconds: KEY_LIFETIME_LIMIT_SECONDS,
  scopes: Object.freeze(['api.model.read', 'api.responses.write']),
});
