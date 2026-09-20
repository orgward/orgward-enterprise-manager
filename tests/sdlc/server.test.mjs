import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';

async function start(root) {
  const app = createApp({ dataDirectory: path.join(root, 'blueprints'), sdlcDirectory: path.join(root, 'sdlc') });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}

async function close(server) { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

async function request(base, route, options = {}, expected = 200) {
  const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}

test('SDLC API persists and resumes a golden case across process restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, { method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'api-run-1' }) });
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.equal(changeCase.currentStage, 'S9');
  const id = changeCase.id;
  const version = changeCase.version;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.version, version);
  assert.equal(changeCase.currentStage, 'S9');
  assert.ok(changeCase.traceability.nodes.some((node) => node.type === 'ChangeSet'));
  assert.ok(changeCase.evidenceIntegrity.every((entry) => entry.valid));
});

test('SDLC API enforces optimistic concurrency, authority, isolation, and immutable action replay', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const tenantA = { 'x-orgward-tenant': 'tenant-a' }; const tenantB = { 'x-orgward-tenant': 'tenant-b' };
  let first = await request(app.base, '/api/sdlc/cases', { method: 'POST', headers: tenantA, body: JSON.stringify({ mode: 'golden', tenantId: 'attempted-body-override' }) }, 201);
  const second = await request(app.base, '/api/sdlc/cases', { method: 'POST', headers: tenantB, body: JSON.stringify({ mode: 'golden' }) }, 201);
  assert.notEqual(first.id, second.id);
  assert.equal(first.tenantId, 'tenant-a');
  first = await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: first.version, idempotencyKey: 'advance-once' }) });
  await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: 0, idempotencyKey: 'stale' }) }, 409);
  const replay = await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: 0, idempotencyKey: 'advance-once' }) });
  assert.equal(replay.command.replayed, true);
  assert.equal(replay.version, first.version);
  const listingA = await request(app.base, '/api/sdlc/cases', { headers: tenantA });
  const listingB = await request(app.base, '/api/sdlc/cases', { headers: tenantB });
  assert.deepEqual(listingA.cases.map((entry) => entry.tenantId), ['tenant-a']);
  assert.deepEqual(listingB.cases.map((entry) => entry.tenantId), ['tenant-b']);
  await request(app.base, `/api/sdlc/cases/${second.id}`, { headers: tenantA }, 404);
  assert.equal((await request(app.base, `/api/sdlc/cases/${second.id}`, { headers: tenantB })).tenantId, 'tenant-b');
});

test('served SDLC product surface and meta contract expose stages and mutation lab', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const meta = await request(app.base, '/api/sdlc/meta');
  assert.equal(meta.stages.length, 12);
  assert.equal(meta.mutations.missing_aml.expectedGate, 'G1');
  const response = await fetch(`${app.base}/sdlc.html`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Synthetic SDLC reference/i);
  const [styles, script] = await Promise.all([
    fetch(`${app.base}/sdlc.css`).then((entry) => entry.text()),
    fetch(`${app.base}/sdlc.js`).then((entry) => entry.text()),
  ]);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /scroll-snap-type:\s*x proximity/);
  assert.match(script, /crypto\?\.randomUUID\?\.\(\)/);
});
