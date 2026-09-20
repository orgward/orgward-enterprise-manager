import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';

async function request(base, route, options = {}, status = 200) {
  const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', 'x-orgward-tenant': 'execution-test', ...(options.headers ?? {}) } });
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}

test('execution HTTP surface enforces approval and exposes generated artifacts', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-execution-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = createApp({
    dataDirectory: path.join(root, 'projects'), sdlcDirectory: path.join(root, 'sdlc'),
    executionDirectory: path.join(root, 'runs'), executionWorkspaceDirectory: path.join(root, 'workspaces'), enableLocalExecution: true,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const meta = await request(base, '/api/execution/meta');
  assert.equal(meta.productionReady, false);
  assert.deepEqual(meta.profiles.map((entry) => entry.id), ['scaffold-node-service']);
  let run = await request(base, '/api/execution/runs', { method: 'POST', body: JSON.stringify({ profileId: 'scaffold-node-service', requestedBy: 'developer', title: 'Create catalog service', objective: 'Create a catalog API', requirements: ['health check'] }) }, 201);
  await request(base, `/api/execution/runs/${run.id}/execute`, { method: 'POST', body: JSON.stringify({ version: run.version, principal: 'worker' }) }, 400);
  run = await request(base, `/api/execution/runs/${run.id}/approve`, { method: 'POST', body: JSON.stringify({ version: run.version, principal: 'governor', roles: ['execution-approver'] }) });
  run = await request(base, `/api/execution/runs/${run.id}/execute`, { method: 'POST', body: JSON.stringify({ version: run.version, principal: 'worker' }) });
  assert.equal(run.status, 'SUCCEEDED');
  assert.ok(run.execution.changedArtifacts.length >= 6);
  assert.equal(run.execution.workspace, undefined);
  assert.equal(run.execution.workspaceRef, `workspace:${run.id}`);
  assert.equal((await request(base, '/api/execution/runs')).runs.length, 1);
  await request(base, `/api/execution/runs/${run.id}`, { headers: { 'x-orgward-tenant': 'other-tenant' } }, 404);

  const ui = await fetch(`${base}/execution.html`);
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /Real executables and files/);
});
