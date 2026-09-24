const ORIGIN = 'https://api.openai.com';
const MAX_RESPONSE_BYTES = 8_192;
const REQUEST_TIMEOUT_MS = 8_000;
const identifierPatterns = Object.freeze({
  organizationId: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,
  projectId: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,
  serviceAccountId: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,
  apiKeyId: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,
});
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function unconfirmed(reason) {
  return Object.freeze({ status: 'unconfirmed', reason });
}

async function readBoundedJson(response) {
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

/**
 * Delete only an exclusive service account OrgWard created for one credential
 * generation. Deleting it also deletes every key attached to that account, so
 * shared or externally staged accounts are ineligible. The API-key ID is retained
 * as audit provenance only; deletion always targets the exact service-account ID.
 * The Admin API key is supplied by server configuration and is never returned or
 * included in diagnostics. Callers must persist the target before enqueueing.
 */
export async function revokeOrgwardCreatedOpenAiServiceAccount({ adminApiKey, target, fetchImpl = fetch, endpoint = ORIGIN, beforeDelete = null }) {
  if (typeof adminApiKey !== 'string' || adminApiKey.length < 8 || Buffer.byteLength(adminApiKey, 'utf8') > 2_048 || /[\r\n]/.test(adminApiKey)) {
    throw new Error('OpenAI Admin API credential is unavailable.');
  }
  if (!target || target.provenance !== 'orgward_created_exclusive_service_account'
    || Object.entries(identifierPatterns).some(([field, pattern]) => typeof target[field] !== 'string' || !pattern.test(target[field]))) {
    return unconfirmed('target_not_eligible');
  }
  let origin;
  try {
    const parsed = new URL(endpoint);
    const loopbackTestEndpoint = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !loopbackTestEndpoint) || parsed.username || parsed.password || parsed.search || parsed.hash
      || parsed.pathname !== '/' || (!loopbackTestEndpoint && parsed.origin !== ORIGIN)) return unconfirmed('target_not_eligible');
    origin = parsed.origin;
  } catch { return unconfirmed('target_not_eligible'); }

  const url = `${origin}/v1/organization/projects/${encodeURIComponent(target.projectId)}/service_accounts/${encodeURIComponent(target.serviceAccountId)}`;
  let response;
  try {
    // Reconcile first on every attempt. After a timeout or process restart, a
    // missing exact account is the only safe proof that the prior delete worked.
    response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { authorization: `Bearer ${adminApiKey}`, 'openai-organization': target.organizationId, accept: 'application/json' },
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return Object.freeze({ status: 'confirmed', serviceAccountId: target.serviceAccountId, evidence: 'exact_project_account_absent' });
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return unconfirmed('provider_did_not_confirm');
    }
    const current = await readBoundedJson(response);
    if (current?.id !== target.serviceAccountId) return unconfirmed('provider_target_mismatch');
    if (beforeDelete && !(await beforeDelete())) return unconfirmed('claim_lost');

    response = await fetchImpl(url, {
      method: 'DELETE',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${adminApiKey}`,
        'openai-organization': target.organizationId,
        accept: 'application/json',
      },
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      return unconfirmed('provider_did_not_confirm');
    }
    const body = await readBoundedJson(response);
    if (body?.id !== target.serviceAccountId || body?.deleted !== true) {
      return unconfirmed('provider_target_mismatch');
    }
    return Object.freeze({ status: 'confirmed', serviceAccountId: target.serviceAccountId, evidence: 'exact_delete_response' });
  } catch {
    try { await response?.body?.cancel(); } catch { /* Keep provider details out of diagnostics. */ }
    return unconfirmed('provider_response_ambiguous');
  }
}

export const OPENAI_ADMIN_REVOCATION_LIMITS = Object.freeze({
  origin: ORIGIN,
  timeoutMs: REQUEST_TIMEOUT_MS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
});
