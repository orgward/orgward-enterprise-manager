import { LOOPBACK_SANDBOX_ADAPTER_ID, normalizeSandboxEffectRequest } from './sandbox-adapter-contract.mjs';

function normalizedLoopbackUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('The local sandbox provider URL must be a valid URL.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The test provider adapter accepts only a plain HTTP IPv4-loopback origin.');
  }
  return url.origin;
}

export function createLoopbackSandboxHttpAdapter({ baseUrl, token, fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  const origin = normalizedLoopbackUrl(baseUrl);
  if (typeof token !== 'string' || token.length < 32) throw new Error('A shared local service token of at least 32 characters is required.');
  const call = async (endpoint, payload) => {
    let response;
    try {
      response = await fetchImpl(`${origin}${endpoint}`, { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (endpoint === '/v1/effects') throw Object.assign(new Error('The local provider response was lost; reconcile the stable key before retrying.'),
        { code: 'SANDBOX_ADAPTER_TIMEOUT_AFTER_ACCEPTANCE', cause: error });
      throw error;
    }
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message ?? 'The loopback sandbox service rejected the request.'),
      { code: result.error ?? 'SANDBOX_PROVIDER_SERVICE_ERROR', statusCode: response.status });
    return result;
  };
  return Object.freeze({
    id: LOOPBACK_SANDBOX_ADAPTER_ID,
    async dispatch(input) {
      const request = normalizeSandboxEffectRequest({ ...input, adapterId: LOOPBACK_SANDBOX_ADAPTER_ID });
      return call('/v1/effects', request);
    },
    async reconcile(providerKey) {
      const result = await call('/v1/effects/reconcile', { providerKey });
      if (result.found !== true && result.found !== false) throw Object.assign(new Error('The loopback sandbox service returned an invalid reconciliation result.'), { code: 'INVALID_SANDBOX_RECONCILIATION_RESPONSE' });
      return result.found ? result.response : null;
    },
  });
}
