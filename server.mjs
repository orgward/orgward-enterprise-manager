import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addConversationTurn, createProject, graphForBlueprint, latestBlueprint } from './src/model.mjs';
import { ProjectStore } from './src/store.mjs';
import { MUTATIONS, STAGES } from './src/sdlc/contracts.mjs';
import { advanceCase, approveRelease, createChangeCase, recordObservation, runToCheckpoint, traceability, verifyEvidenceLedger } from './src/sdlc/engine.mjs';
import { ChangeCaseStore } from './src/sdlc/store.mjs';
import { EXECUTION_STATUSES } from './src/execution/contracts.mjs';
import { ExecutionService } from './src/execution/service.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function setSecurityHeaders(response) {
  response.setHeader('content-security-policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function projectView(project) {
  const blueprint = latestBlueprint(project);
  return { ...project, latestBlueprint: blueprint, graph: graphForBlueprint(blueprint) };
}

function sdlcView(changeCase) {
  return { ...changeCase, traceability: traceability(changeCase), evidenceIntegrity: verifyEvidenceLedger(changeCase) };
}

function requireVersion(changeCase, suppliedVersion) {
  if (!Number.isInteger(suppliedVersion) || suppliedVersion !== changeCase.version) {
    const error = new Error(`Version conflict: expected ${changeCase.version}. Reload the case before retrying.`);
    error.statusCode = 409;
    throw error;
  }
}

function requestTenant(request) {
  const value = String(request.headers['x-orgward-tenant'] ?? 'tenant-reference-bank').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)) throw new Error('Invalid tenant context.');
  return value;
}

function requireTenant(changeCase, tenantId) {
  if (changeCase.tenantId !== tenantId) {
    const error = new Error('Change case not found.');
    error.statusCode = 404;
    throw error;
  }
}

export function createApp({
  dataDirectory = path.join(ROOT, 'data', 'projects'),
  sdlcDirectory = path.join(ROOT, 'data', 'sdlc'),
  executionDirectory = path.join(ROOT, 'data', 'execution-runs'),
  executionWorkspaceDirectory = path.join(ROOT, 'data', 'execution-workspaces'),
  executionProfiles = [],
  enableLocalExecution = false,
} = {}) {
  const store = new ProjectStore(dataDirectory);
  const sdlcStore = new ChangeCaseStore(sdlcDirectory);
  const localProfile = {
    id: 'scaffold-node-service', label: 'Scaffold Node service', kind: 'system-generator', version: '1.0.0',
    description: 'Creates a traced, testable Node.js service scaffold inside an isolated run workspace.',
    executable: process.execPath, args: [path.join(ROOT, 'workers', 'scaffold-node-service.mjs')],
    workspaceRoot: path.resolve(executionWorkspaceDirectory), timeoutMs: 60_000,
  };
  const executionService = new ExecutionService({ runDirectory: executionDirectory, profiles: [...executionProfiles, ...(enableLocalExecution ? [localProfile] : [])] });
  const server = createHttpServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const url = new URL(request.url, 'http://localhost');
      const { pathname } = url;

      if (request.method === 'GET' && pathname === '/api/health') {
        return sendJson(response, 200, { status: 'ok', product: 'OrgWard Enterprise Studio', maturity: 'reference-with-controlled-local-execution', productionReady: false });
      }

      if (request.method === 'GET' && pathname === '/api/projects') {
        return sendJson(response, 200, { projects: await store.list() });
      }

      if (request.method === 'GET' && pathname === '/api/sdlc/meta') {
        return sendJson(response, 200, { stages: STAGES, mutations: MUTATIONS, referenceScenario: 'Digital beneficial-owner maintenance' });
      }

      if (request.method === 'GET' && pathname === '/api/execution/meta') {
        return sendJson(response, 200, { statuses: EXECUTION_STATUSES, profiles: executionService.capabilities(), productionReady: false });
      }

      if (request.method === 'GET' && pathname === '/api/execution/runs') {
        return sendJson(response, 200, { runs: await executionService.list(requestTenant(request)) });
      }

      if (request.method === 'POST' && pathname === '/api/execution/runs') {
        const body = await readJson(request);
        const run = await executionService.create({ ...body, tenantId: requestTenant(request) });
        return sendJson(response, 201, run);
      }

      const executionRunMatch = pathname.match(/^\/api\/execution\/runs\/(execution-run-[0-9a-f-]{36})$/);
      if (request.method === 'GET' && executionRunMatch) {
        const run = await executionService.get(executionRunMatch[1], requestTenant(request));
        return run ? sendJson(response, 200, run) : sendJson(response, 404, { error: 'Execution run not found.' });
      }

      const executionActionMatch = pathname.match(/^\/api\/execution\/runs\/(execution-run-[0-9a-f-]{36})\/(approve|execute)$/);
      if (request.method === 'POST' && executionActionMatch) {
        const body = await readJson(request);
        const run = executionActionMatch[2] === 'approve'
          ? await executionService.approve(executionActionMatch[1], requestTenant(request), body)
          : await executionService.execute(executionActionMatch[1], requestTenant(request), body);
        return run ? sendJson(response, 200, run) : sendJson(response, 404, { error: 'Execution run not found.' });
      }

      if (request.method === 'GET' && pathname === '/api/sdlc/cases') {
        return sendJson(response, 200, { cases: await sdlcStore.list(requestTenant(request)) });
      }

      if (request.method === 'POST' && pathname === '/api/sdlc/cases') {
        const body = await readJson(request);
        const changeCase = createChangeCase({ ...body, tenantId: requestTenant(request) });
        await sdlcStore.save(changeCase);
        return sendJson(response, 201, sdlcView(changeCase));
      }

      const sdlcCaseMatch = pathname.match(/^\/api\/sdlc\/cases\/(change-case-[0-9a-f-]{36})$/);
      if (request.method === 'GET' && sdlcCaseMatch) {
        const changeCase = await sdlcStore.get(sdlcCaseMatch[1]);
        if (!changeCase) return sendJson(response, 404, { error: 'Change case not found.' });
        requireTenant(changeCase, requestTenant(request));
        return sendJson(response, 200, sdlcView(changeCase));
      }

      const sdlcActionMatch = pathname.match(/^\/api\/sdlc\/cases\/(change-case-[0-9a-f-]{36})\/(advance|run|approve|observe)$/);
      if (request.method === 'POST' && sdlcActionMatch) {
        const changeCase = await sdlcStore.get(sdlcActionMatch[1]);
        if (!changeCase) return sendJson(response, 404, { error: 'Change case not found.' });
        requireTenant(changeCase, requestTenant(request));
        const body = await readJson(request);
        if (body.idempotencyKey && changeCase.idempotency[body.idempotencyKey]) {
          return sendJson(response, 200, { ...sdlcView(changeCase), command: { action: sdlcActionMatch[2], replayed: true, steps: 0 } });
        }
        requireVersion(changeCase, body.version);
        const action = sdlcActionMatch[2];
        const result = action === 'advance' ? advanceCase(changeCase, body)
          : action === 'run' ? runToCheckpoint(changeCase, body)
            : action === 'approve' ? approveRelease(changeCase, body)
              : recordObservation(changeCase, body);
        await sdlcStore.save(result.changeCase);
        return sendJson(response, 200, { ...sdlcView(result.changeCase), command: { action, replayed: result.replayed ?? false, steps: result.steps ?? 1 } });
      }

      const sdlcTraceMatch = pathname.match(/^\/api\/sdlc\/cases\/(change-case-[0-9a-f-]{36})\/traceability$/);
      if (request.method === 'GET' && sdlcTraceMatch) {
        const changeCase = await sdlcStore.get(sdlcTraceMatch[1]);
        if (!changeCase) return sendJson(response, 404, { error: 'Change case not found.' });
        requireTenant(changeCase, requestTenant(request));
        return sendJson(response, 200, { traceability: traceability(changeCase), gateHistory: changeCase.gateHistory, evidenceIntegrity: verifyEvidenceLedger(changeCase) });
      }

      if (request.method === 'POST' && pathname === '/api/projects') {
        const body = await readJson(request);
        const project = createProject(body.name);
        await store.save(project);
        return sendJson(response, 201, projectView(project));
      }

      const projectMatch = pathname.match(/^\/api\/projects\/(project-[0-9a-f-]{36})$/);
      if (request.method === 'GET' && projectMatch) {
        const project = await store.get(projectMatch[1]);
        if (!project) return sendJson(response, 404, { error: 'Project not found.' });
        return sendJson(response, 200, projectView(project));
      }

      const messageMatch = pathname.match(/^\/api\/projects\/(project-[0-9a-f-]{36})\/messages$/);
      if (request.method === 'POST' && messageMatch) {
        const project = await store.get(messageMatch[1]);
        if (!project) return sendJson(response, 404, { error: 'Project not found.' });
        const body = await readJson(request);
        addConversationTurn(project, body.content);
        await store.save(project);
        return sendJson(response, 200, projectView(project));
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return sendJson(response, 404, { error: 'Route not found.' });
      }

      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const staticPath = path.resolve(PUBLIC, relative);
      if (!staticPath.startsWith(`${PUBLIC}${path.sep}`)) return sendJson(response, 404, { error: 'Not found.' });
      try {
        const body = await readFile(staticPath);
        response.writeHead(200, {
          'content-type': MIME[path.extname(staticPath)] ?? 'application/octet-stream',
          'content-length': body.length,
          'cache-control': 'no-cache',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      } catch (error) {
        if (error.code === 'ENOENT') return sendJson(response, 404, { error: 'Not found.' });
        throw error;
      }
    } catch (error) {
      const status = error.statusCode ?? (/required|valid JSON|too large|finished discovery|Invalid project|Invalid change case|Invalid execution|only at S|Case is|requires an authorized|awaiting approval|must be approved|cannot approve|valid execution profile/.test(error.message) ? 400 : 500);
      sendJson(response, status, { error: status === 500 ? 'Unexpected server error.' : error.message });
    }
  });
  return { server, store, sdlcStore, executionService };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4310);
  const dataDirectory = process.env.ORGWARD_DATA_DIR || path.join(ROOT, 'data', 'projects');
  const sdlcDirectory = process.env.ORGWARD_SDLC_DATA_DIR || path.join(ROOT, 'data', 'sdlc');
  const executionDirectory = process.env.ORGWARD_EXECUTION_DATA_DIR || path.join(ROOT, 'data', 'execution-runs');
  const executionWorkspaceDirectory = process.env.ORGWARD_EXECUTION_WORKSPACE_DIR || path.join(ROOT, 'data', 'execution-workspaces');
  const enableLocalExecution = process.env.ORGWARD_ENABLE_LOCAL_EXECUTION === 'true';
  const { server, store, sdlcStore, executionService } = createApp({ dataDirectory, sdlcDirectory, executionDirectory, executionWorkspaceDirectory, enableLocalExecution });
  await Promise.all([store.init(), sdlcStore.init(), executionService.init()]);
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`OrgWard Enterprise Studio listening privately on http://${host}:${address.port}`);
  });
}
