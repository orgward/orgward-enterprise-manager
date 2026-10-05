import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../sdlc/contracts.mjs';
import { LOOPBACK_SANDBOX_ADAPTER_ID, normalizeSandboxEffectRequest, normalizeSandboxEffectResponse } from './sandbox-adapter-contract.mjs';

export const LOCAL_SANDBOX_PROVIDER_ID = 'orgward.sandbox-provider.local/v1';

const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
};

async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Expected a JSON request.'), { status: 400 }); }
}

export async function createLocalSandboxProviderService({ storePath, token, host = '127.0.0.1', port = 0, now = () => new Date().toISOString() }) {
  if (host !== '127.0.0.1') throw new Error('The local sandbox provider may bind only to IPv4 loopback.');
  if (!storePath) throw new Error('A durable local provider store path is required.');
  if (typeof token !== 'string' || token.length < 32) throw new Error('A shared local service token of at least 32 characters is required.');
  const tokenHash = createHash('sha256').update(token).digest();
  let operations = new Map();
  try {
    const saved = JSON.parse(await readFile(storePath, 'utf8'));
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.operations)) throw new Error('Invalid local provider state.');
    for (const entry of saved.operations) {
      const request = normalizeSandboxEffectRequest(entry.request);
      if (request.adapterId !== LOOPBACK_SANDBOX_ADAPTER_ID || entry.providerKey !== request.providerKey || entry.requestHash !== digest(request)) {
        throw new Error('The local provider ledger contains an invalid operation identity.');
      }
      normalizeSandboxEffectResponse(entry.response, request);
    }
    operations = new Map(saved.operations.map((entry) => [entry.providerKey, entry]));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let chain = Promise.resolve();
  const persist = async () => {
    await mkdir(path.dirname(storePath), { recursive: true });
    const temp = `${storePath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ schemaVersion: 1, operations: [...operations.values()] }), { mode: 0o600 });
    await rename(temp, storePath);
  };
  const serialize = (work) => { const next = chain.then(work); chain = next.catch(() => {}); return next; };
  const issue = async (request) => serialize(async () => {
    const normalized = normalizeSandboxEffectRequest(request);
    if (normalized.adapterId !== LOOPBACK_SANDBOX_ADAPTER_ID) throw Object.assign(new Error('Unsupported adapter identity.'), { status: 400 });
    const requestHash = digest(normalized); const prior = operations.get(normalized.providerKey);
    if (prior) {
      if (prior.requestHash !== requestHash) throw Object.assign(new Error('Provider key is already bound to a different request.'), { status: 409, code: 'SANDBOX_IDEMPOTENCY_CONFLICT' });
      return { ...prior.response, idempotent: true };
    }
    const outcome = normalized.kind === 'PROCUREMENT_TEST_COMPENSATION' ? 'COMPENSATED_IN_SANDBOX' : 'RECORDED_IN_SANDBOX';
    const recordedAt = now(); const receiptCore = { serviceId: LOCAL_SANDBOX_PROVIDER_ID,
      receiptId: `local-provider-receipt-${digest({ providerKey: normalized.providerKey, requestHash }).slice(0, 32)}`,
      providerKey: normalized.providerKey, requestHash, outcome, recordedAt };
    const providerEvidence = { ...receiptCore, evidenceHash: digest(receiptCore) };
    const response = { contract: normalized.contract, schemaVersion: normalized.schemaVersion,
      adapterId: normalized.adapterId, mode: 'LOCAL_TEST_ONLY', operationKey: normalized.operationKey,
      providerKey: normalized.providerKey, outcome, externalProviderCalled: false, externalServiceCalled: true,
      idempotent: false, result: { operationId: normalized.operationId, status: outcome,
        detail: 'A separate loopback sandbox service recorded this test effect; no third-party provider or live transaction was used.',
        providerEvidence } };
    operations.set(normalized.providerKey, { providerKey: normalized.providerKey, requestHash, request: normalized, response });
    try { await persist(); } catch (error) { operations.delete(normalized.providerKey); throw error; }
    return response;
  });
  const reconcile = (providerKey) => serialize(async () => {
    const prior = operations.get(providerKey);
    return prior ? { ...prior.response, idempotent: true } : null;
  });
  const server = createServer(async (request, response) => {
    try {
      const supplied = request.headers.authorization?.startsWith('Bearer ')
        ? createHash('sha256').update(request.headers.authorization.slice(7)).digest() : Buffer.alloc(tokenHash.length);
      if (!timingSafeEqual(tokenHash, supplied)) return json(response, 401, { error: 'UNAUTHORIZED' });
      if (request.method === 'POST' && request.url === '/v1/effects') return json(response, 200, await issue(await body(request)));
      if (request.method === 'POST' && request.url === '/v1/effects/reconcile') {
        const input = await body(request);
        if (!input || Object.keys(input).length !== 1 || typeof input.providerKey !== 'string') return json(response, 400, { error: 'INVALID_RECONCILIATION_REQUEST' });
        const found = await reconcile(input.providerKey);
        return json(response, 200, found ? { found: true, response: found } : { found: false, response: null });
      }
      return json(response, 404, { error: 'NOT_FOUND' });
    } catch (error) { return json(response, error.status ?? 400, { error: error.code ?? 'INVALID_REQUEST', message: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = server.address();
  return Object.freeze({
    url: `http://${host}:${address.port}`,
    async close() { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  });
}
