import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server.mjs';
import { createProject } from '../src/model.mjs';

const ANSWERS = [
  'A circular office-furniture service that extends useful life for growing companies.',
  'Operations leaders get refurbished workstations, swaps, and condition reporting instead of buying new.',
  'Recurring subscription priced per workstation; constrain warehouse space and refurbishment lead time.',
  'Humans approve condition standards and purchases. Inventory tracking and scheduling may be automated.',
];

async function start(dataDirectory) {
  const app = createApp({ dataDirectory });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  return { ...app, base: `http://127.0.0.1:${port}` };
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function json(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}

test('HTTP workflow persists chat, brief, blueprint, and map across restart', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'orgward-studio-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let app = await start(directory);

  const health = await json(app.base, '/api/health');
  assert.equal(health.status, 'ok');
  let project = await json(app.base, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Circular Works' }) });
  assert.equal(project.phase, 'discovery');

  for (const content of ANSWERS) {
    project = await json(app.base, `/api/projects/${project.id}/messages`, { method: 'POST', body: JSON.stringify({ content }) });
  }
  assert.equal(project.phase, 'blueprint_ready');
  assert.equal(project.latestBlueprint.integrity.valid, true);
  assert.ok(project.graph.nodes.some((node) => node.type === 'capability'));
  assert.ok(project.graph.nodes.some((node) => node.type === 'process'));
  assert.ok(project.graph.nodes.some((node) => node.type === 'role'));
  assert.ok(project.graph.nodes.some((node) => node.type === 'system'));
  assert.ok(project.graph.links.length >= 30);

  const projectId = project.id;
  await close(app.server);
  app = await start(directory);
  t.after(() => close(app.server));
  const restored = await json(app.base, `/api/projects/${projectId}`);
  assert.equal(restored.brief.title, project.brief.title);
  assert.equal(restored.blueprintVersions.length, 1);
  assert.equal(restored.conversation.length, 9);
  assert.deepEqual(restored.graph, project.graph);
});

test('projects remain isolated and static UI exposes the map workflow', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'orgward-studio-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await start(directory);
  t.after(() => close(app.server));

  const first = await json(app.base, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'First workspace' }) });
  const second = await json(app.base, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Second workspace' }) });
  assert.notEqual(first.id, second.id);
  const listing = await json(app.base, '/api/projects');
  assert.equal(listing.projects.length, 2);
  assert.deepEqual(new Set(listing.projects.map((project) => project.id)), new Set([first.id, second.id]));

  const response = await fetch(`${app.base}/`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Interactive map/);
  assert.match(html, /local development installation/i);
  assert.match(html, /Enterprise authentication and external actions are not enabled/i);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);

  const [styles, script] = await Promise.all([
    fetch(`${app.base}/styles.css`).then((entry) => entry.text()),
    fetch(`${app.base}/app.js`).then((entry) => entry.text()),
  ]);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(styles, /\.studio\.complete \.conversation-panel/);
  assert.doesNotMatch(script, /Map\.groupBy/);
  assert.match(script, /max-width: 560px/);
});

test('legacy compatibility mode permits inspection but blocks product writes and startup recovery', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-legacy-readonly-'));
  const dataDirectory = path.join(root, 'projects');
  const sdlcDirectory = path.join(root, 'sdlc');
  const executionDirectory = path.join(root, 'execution');
  const profile = {
    id: 'legacy-readonly-worker', label: 'Legacy read-only worker', executable: process.execPath,
    args: ['-e', "require('node:fs').writeFileSync(process.env.MARKER, 'started')"],
    environment: { MARKER: path.join(root, 'worker-started') }, workspaceRoot: path.join(root, 'workspaces'),
  };
  let app = createApp({ dataDirectory, sdlcDirectory, executionDirectory, executionProfiles: [profile] });
  await app.init();
  const project = createProject('Read-only legacy source');
  await app.store.save(project);
  const run = await app.executionService.create({
    tenantId: 'tenant-reference-bank', profileId: profile.id, requestedBy: 'legacy-owner',
    title: 'Interrupted legacy run', objective: 'Must remain untouched during inspection.',
  });
  const running = await app.executionService.store.get(run.id);
  running.status = 'RUNNING';
  running.version += 1;
  await app.executionService.store.save(running);
  const projectSnapshot = await readFile(app.store.fileFor(project.id));
  const runSnapshot = await readFile(app.executionService.store.fileFor(run.id));
  await app.close();

  app = createApp({ dataDirectory, sdlcDirectory, executionDirectory, executionProfiles: [profile], readOnly: true });
  await app.init();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await close(app.server); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.operationMode, 'read_only_legacy');
  assert.equal(health.execution.status, 'read_only');
  const executionMeta = await fetch(`${base}/api/execution/meta`).then((response) => response.json());
  assert.equal(executionMeta.operationMode, 'read_only_legacy');
  const foundationResponse = await fetch(`${base}/api/v1/foundation`);
  const foundation = await foundationResponse.json();
  assert.equal(foundation.data.operationMode, 'read_only_legacy');
  assert.equal(foundation.data.capabilities.execution.status, 'read_only');
  assert.match(foundation.data.persistence.description, /read-only/);
  const studioScript = await fetch(`${base}/app.js`).then((response) => response.text());
  assert.match(studioScript, /Read-only legacy inspection/);
  assert.equal((await fetch(`${base}/api/projects`).then((response) => response.json())).projects.length, 1);
  assert.equal((await fetch(`${base}/api/execution/runs`).then((response) => response.json())).runs[0].status, 'RUNNING');

  const denied = await Promise.all([
    fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Must not write' }) }),
    fetch(`${base}/api/v1/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ schemaVersion: '1.0', commandId: 'legacy-write', payload: { name: 'Must not write' } }) }),
    fetch(`${base}/api/execution/runs/${run.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: running.version }) }),
  ]);
  assert.deepEqual(denied.map((response) => response.status), [503, 503, 503]);
  const versionedError = await denied[1].json();
  assert.equal(versionedError.error.code, 'READ_ONLY_LEGACY_MODE');
  assert.deepEqual(await readFile(app.store.fileFor(project.id)), projectSnapshot);
  assert.deepEqual(await readFile(app.executionService.store.fileFor(run.id)), runSnapshot);
  await assert.rejects(() => readFile(profile.environment.MARKER), { code: 'ENOENT' });
});

test('serves truthful product-status assets and declared capability boundaries', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'orgward-studio-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await start(directory);
  t.after(() => close(app.server));

  const [page, script, styles] = await Promise.all([
    fetch(`${app.base}/platform.html`),
    fetch(`${app.base}/platform.js`).then((response) => response.text()),
    fetch(`${app.base}/platform.css`).then((response) => response.text()),
  ]);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Interactive specification/);
  assert.match(html, /Change portfolio/);
  assert.match(html, /Administration/);
  assert.match(html, /Product status/);
  assert.match(script, /First-release gates/);
  assert.match(script, /Actual local records/);
  assert.match(script, /Development headers are not a security boundary/);
  assert.match(script, /The colleague must sign in once first/);
  assert.match(script, /View specification/);
  assert.doesNotMatch(script, /Northstar Bank|238 checks|42m|18m waiting/);
  assert.match(styles, /@media \(max-width: 780px\)/);
});

test('API rejects malformed project identifiers and empty chat messages', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'orgward-studio-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await start(directory);
  t.after(() => close(app.server));
  const project = await json(app.base, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Validation' }) });

  const empty = await fetch(`${app.base}/api/projects/${project.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '   ' }),
  });
  assert.equal(empty.status, 400);
  const traversal = await fetch(`${app.base}/api/projects/not-a-project`);
  assert.equal(traversal.status, 404);
});
