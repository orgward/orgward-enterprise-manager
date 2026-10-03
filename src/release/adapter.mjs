import { releaseAdapterObservation } from './contracts.mjs';

// A configured deployment controller implements this small transport contract.
// POST receives the approved bytes; GET observes that same action without applying it.
export class HttpReleaseAdapter {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetchImpl = fetchImpl; }
  async #request(action, method, outputs = null) {
    try {
      const endpoint = `${this.config.endpoint}/actions${method === 'GET' ? `/${encodeURIComponent(action.id)}` : ''}`;
      const response = await this.fetchImpl(endpoint, { method, redirect: 'manual',
        signal: AbortSignal.timeout(this.config.timeoutMs),
        headers: { 'content-type': 'application/json',
          ...(this.config.authorizationToken ? { authorization: `Bearer ${this.config.authorizationToken}` } : {}),
          ...(method === 'POST' ? { 'idempotency-key': action.id } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify({ version: 'protected-release-dispatch-v1', actionId: action.id,
          requestHash: action.requestHash, request: action.request, outputs }) } : {}) });
      if (!response.ok) { await response.body?.cancel(); return { status: 'UNKNOWN', reason: 'adapter_http_result_unavailable' }; }
      const chunks = []; let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.byteLength;
        if (size > 32_768) { await response.body?.cancel().catch(() => {}); return { status: 'UNKNOWN', reason: 'adapter_receipt_invalid' }; }
        chunks.push(Buffer.from(chunk));
      }
      return releaseAdapterObservation(JSON.parse(Buffer.concat(chunks).toString('utf8')), action);
    } catch { return { status: 'UNKNOWN', reason: 'adapter_transport_or_receipt_unavailable' }; }
  }
  execute(action, outputs) { return this.#request(action, 'POST', outputs); }
  reconcile(action) { return this.#request(action, 'GET'); }
}
