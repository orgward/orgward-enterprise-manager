import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server.mjs';

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
  assert.match(html, /private server/i);
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

test('serves product catalogue assets and declared specification text', async (t) => {
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
  assert.match(script, /Production readiness is 0 of 16 gates/);
  assert.match(script, /OrganisationService/);
  assert.match(script, /Durable human and agent work/);
  assert.match(script, /Demonstrator boundary/);
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
