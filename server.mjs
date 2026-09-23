import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addConversationTurn, createProject, editBlueprintObject, editProcessTaskGraph, graphForBlueprint, latestBlueprint, planProcessTaskGraph } from './src/model.mjs';
import { ProjectStore } from './src/store.mjs';
import { MUTATIONS, STAGES } from './src/sdlc/contracts.mjs';
import { PROOF_ACTION_ATTEMPT_LIMIT, advanceCase, answerClarification, approveRelease, assessProofs, commandRequestHash, completeProofAction, createChangeCase, normalizeChangeCase, openClarification, reconcileClarification, recordObservation, recordProofResult, registerProofObligation, releaseApprovalCandidate, resumeProofAction, routeProofResult, runToCheckpoint, traceability, verifyEvidenceLedger, workspaceStatus } from './src/sdlc/engine.mjs';
import { ChangeCaseStore } from './src/sdlc/store.mjs';
import { EXECUTION_STATUSES } from './src/execution/contracts.mjs';
import { ExecutionService } from './src/execution/service.mjs';
import { PostgresPersistence } from './src/platform/postgres.mjs';
import { OidcAuthenticator } from './src/platform/oidc.mjs';
import { OidcLoginFlow } from './src/platform/oidc-login.mjs';
import { PostgresOidcSessionStore } from './src/platform/oidc-sessions.mjs';
import { LegacyImporter, PostgresChangeCaseStore, PostgresExecutionRunStore, PostgresProjectStore } from './src/platform/postgres-stores.mjs';
import { PostgresSecretStore } from './src/platform/secrets.mjs';
import { parseInstallConfig } from './src/platform/install-config.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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

const API_VERSION = '1.0';

function sendApi(response, status, data, { correlationId, event = null, meta = {} } = {}) {
  response.setHeader('x-orgward-api-version', API_VERSION);
  response.setHeader('x-correlation-id', correlationId);
  return sendJson(response, status, { schemaVersion: API_VERSION, data, ...(event ? { event } : {}), meta: { correlationId, ...meta } });
}

function sendApiError(response, error, correlationId) {
  const status = error.statusCode ?? 500;
  response.setHeader('x-orgward-api-version', API_VERSION);
  response.setHeader('x-correlation-id', correlationId);
  return sendJson(response, status, {
    schemaVersion: API_VERSION,
    error: {
      code: error.code ?? (status === 500 ? 'UNEXPECTED_ERROR' : 'REQUEST_FAILED'),
      message: status === 500 ? 'The request could not be completed.' : error.message,
      fieldErrors: error.fieldErrors ?? [],
      correlationId,
      retryable: error.retryable ?? status >= 500,
      currentVersion: error.currentVersion ?? null,
      recoveryActions: error.recoveryActions ?? (status >= 500 ? [{ type: 'retry', label: 'Try again' }] : []),
    },
  });
}

function apiFailure(statusCode, code, message, options = {}) {
  const error = new Error(message);
  Object.assign(error, { statusCode, code, ...options });
  return error;
}

function setSecurityHeaders(response) {
  response.setHeader('content-security-policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
}

function cookieValue(request, name) {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') return null;
  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue;
    return segment.slice(separator + 1).trim();
  }
  return null;
}

function cookie(name, value, { maxAge = null, pathName = '/', secure = false } = {}) {
  return `${name}=${value}; Path=${pathName}; HttpOnly; SameSite=Lax${maxAge === null ? '' : `; Max-Age=${Math.max(0, Math.floor(maxAge))}`}${secure ? '; Secure' : ''}`;
}

function clearCookie(name, { pathName = '/', secure = false } = {}) {
  return cookie(name, '', { maxAge: 0, pathName, secure });
}

function loginError(response, secure = false) {
  response.writeHead(303, {
    location: '/sign-in.html?error=login_failed',
    'cache-control': 'no-store',
    'set-cookie': [clearCookie('ow_login', { pathName: '/auth/callback', secure })],
  });
  response.end();
}

async function assertCurrentEnabledPlanActorBindings(client, { tenantId, project, plan }) {
  const blueprintVersion = plan.source.blueprintVersion;
  if (project.id !== plan.source.projectId || project.blueprintVersions?.at(-1)?.version !== blueprintVersion) {
    throw apiFailure(409, 'PROCESS_PLAN_BINDING_STALE', 'The actor binding is pinned to an older project blueprint; clear it or plan against the current blueprint.');
  }
  const blueprint = project.blueprintVersions.find((entry) => entry.id === plan.source.blueprintId
    && entry.version === blueprintVersion);
  const objects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
  const actorById = new Map(objects.filter((item) => ['actor-human', 'actor-agent'].includes(item.type)).map((item) => [item.id, item]));
  for (const task of plan.tasks) {
    if (task.assignee?.kind !== 'blueprint-actor') continue;
    const actor = actorById.get(task.assignee.actorId);
    const roleId = task.assignee.roleId;
    const expectedActorType = actor?.type === 'actor-human' ? 'human' : actor?.type === 'actor-agent' ? 'workload' : null;
    if (!expectedActorType || !roleId) throw apiFailure(409, 'PROCESS_PLAN_ACTOR_REFERENCE_INVALID', 'A task actor reference is not valid in its pinned blueprint.');
    const binding = await client.query(`
      select b.status, b.target_principal, b.target_membership_generation, b.target_authz_generation,
        identity.actor_type, identity.status as identity_status,
        identity.authz_generation as current_authz_generation
      from orgward.project_actor_binding_proposals b
      join orgward.oidc_principals identity
        on identity.tenant_id = b.tenant_id and identity.principal = b.target_principal
      where b.tenant_id = $1 and b.project_id = $2 and b.blueprint_version = $3
        and b.actor_id = $4 and b.role_id = $5
      for update of b, identity
    `, [tenantId, project.id, blueprintVersion, actor.id, roleId]);
    if (!binding.rowCount || binding.rows[0].status !== 'enabled') {
      throw apiFailure(409, 'PROCESS_PLAN_ACTOR_BINDING_UNAVAILABLE', 'Choose an enabled, currently eligible actor binding for this role.');
    }
    const row = binding.rows[0];
    if (row.actor_type !== expectedActorType) {
      throw apiFailure(409, 'PROCESS_PLAN_ACTOR_TYPE_MISMATCH', 'The bound identity type no longer matches the blueprint actor.');
    }
    const membership = await client.query(`
      select access, generation, revoked_at
      from orgward.project_memberships
      where tenant_id = $1 and project_id = $2 and principal = $3
      for update
    `, [tenantId, project.id, row.target_principal]);
    if (row.identity_status !== 'active' || !membership.rowCount || membership.rows[0].revoked_at !== null
      || !['owner', 'editor'].includes(membership.rows[0].access)) {
      throw apiFailure(409, 'PROCESS_PLAN_ACTOR_BINDING_INELIGIBLE', 'The bound identity is no longer an active project owner or editor.');
    }
    if (Number(row.target_authz_generation) !== Number(row.current_authz_generation)
      || Number(row.target_membership_generation) !== Number(membership.rows[0].generation)) {
      throw apiFailure(409, 'PROCESS_PLAN_ACTOR_BINDING_STALE', 'The identity or membership changed after its binding was enabled. Select a current eligible binding.');
    }
  }
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw apiFailure(400, 'INVALID_JSON', 'Request body is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw apiFailure(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}

function projectView(project) {
  const { commandRecords: _commandRecords, memberships: _memberships, ...visible } = project;
  const blueprint = latestBlueprint(project);
  return { ...visible, latestBlueprint: blueprint, graph: graphForBlueprint(blueprint) };
}

function normalizeProject(project, { tenantId = 'tenant-reference-bank', actor = 'local-studio-user' } = {}) {
  project.schemaVersion ??= API_VERSION;
  project.version ??= 1;
  project.tenantId ??= tenantId;
  project.createdBy ??= actor;
  project.updatedBy ??= project.createdBy;
  project.events ??= [];
  project.commandRecords ??= {};
  return project;
}

function requestActor(request) {
  if (request.identity) return request.identity.principal;
  const value = String(request.headers['x-orgward-principal'] ?? 'local-studio-user').trim();
  return /^[a-z0-9][a-z0-9_.:@/-]{0,119}$/i.test(value) ? value : 'local-studio-user';
}

function requestRoles(request) {
  return [...(request.identity?.roles ?? [])];
}

function requireWriteAccess(request) {
  if (request.identity) {
    if (!requestRoles(request).includes('workspace-write')) {
      throw apiFailure(403, 'ACTION_FORBIDDEN', 'This identity does not have workspace write access.', {
        recoveryActions: [{ type: 'request_write_access', label: 'Request workspace write access' }],
      });
    }
    return;
  }
  if (String(request.headers['x-orgward-access'] ?? 'write').toLowerCase() === 'read') {
    throw apiFailure(403, 'ACTION_FORBIDDEN', 'This development identity has read-only access.', {
      recoveryActions: [{ type: 'request_write_access', label: 'Request write access' }],
    });
  }
}

function requireSameOrigin(request, expectedOrigin) {
  if (!expectedOrigin || typeof request.headers.origin !== 'string' || request.headers.origin !== expectedOrigin) {
    throw apiFailure(403, 'CROSS_SITE_REQUEST_DENIED', 'Browser session changes must come from the configured OrgWard origin.', {
      retryable: false,
      recoveryActions: [{ type: 'reload', label: 'Reload OrgWard and try again' }],
    });
  }
}

function rejectAuthorityClaims(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const fields = [
    'tenantId', 'workspaceId', 'actor', 'principal', 'roles', 'authority', 'scopePrincipal',
    'authzGeneration', 'authorityGeneration', 'createdBy', 'requestedBy', 'accountableOwner',
  ];
  const claimed = fields.filter((field) => Object.hasOwn(value, field));
  if (claimed.length) throw apiFailure(400, 'CALLER_AUTHORITY_NOT_ALLOWED', 'Identity, tenant, roles, ownership, and authority come from verified server context.', {
    fieldErrors: claimed.map((field) => ({ field, message: 'Caller-supplied authority is not accepted.' })),
  });
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function validateCommand(body, { create = false, versionRequired = !create } = {}) {
  const fieldErrors = [];
  if (body?.schemaVersion !== API_VERSION) fieldErrors.push({ field: 'schemaVersion', message: `schemaVersion must be ${API_VERSION}.` });
  if (!/^[a-z0-9][a-z0-9_.:-]{0,159}$/i.test(String(body?.commandId ?? ''))) fieldErrors.push({ field: 'commandId', message: 'A stable commandId is required.' });
  if (!body?.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) fieldErrors.push({ field: 'payload', message: 'payload must be an object.' });
  if (create && body?.payload && typeof body.payload === 'object' && !String(body.payload.name ?? '').trim()) fieldErrors.push({ field: 'payload.name', message: 'Name is required.' });
  if (versionRequired && !Number.isInteger(body?.expectedVersion)) fieldErrors.push({ field: 'expectedVersion', message: 'expectedVersion must be an integer.' });
  if (fieldErrors.length) throw apiFailure(400, 'INVALID_COMMAND', 'The command envelope is invalid.', { fieldErrors });
  const authorityFields = ['tenantId', 'workspaceId', 'actor', 'principal', 'roles', 'authority'];
  const claimed = authorityFields.filter((field) => Object.hasOwn(body.payload, field));
  if (claimed.length) throw apiFailure(400, 'CALLER_AUTHORITY_NOT_ALLOWED', 'Identity, tenant, roles, and authority come from server request context.', {
    fieldErrors: claimed.map((field) => ({ field: `payload.${field}`, message: 'Caller-supplied authority is not accepted.' })),
  });
  return body;
}

function validateProjectPayload(payload) {
  const name = String(payload.name ?? '').trim();
  if (!name) throw apiFailure(400, 'INVALID_COMMAND', 'The command payload is invalid.', { fieldErrors: [{ field: 'payload.name', message: 'Name is required.' }] });
  if (name.length > 80) throw apiFailure(400, 'INVALID_COMMAND', 'The command payload is invalid.', { fieldErrors: [{ field: 'payload.name', message: 'Name must be 80 characters or fewer.' }] });
  return { name };
}

function validateMessagePayload(payload) {
  const content = String(payload.content ?? '').trim();
  if (!content) throw apiFailure(400, 'INVALID_COMMAND', 'The command payload is invalid.', { fieldErrors: [{ field: 'payload.content', message: 'An answer is required.' }] });
  if (content.length > 2_000) throw apiFailure(400, 'INVALID_COMMAND', 'The command payload is invalid.', { fieldErrors: [{ field: 'payload.content', message: 'Answer must be 2,000 characters or fewer.' }] });
  return { content };
}

function validateBlueprintEditPayload(payload) {
  const allowed = new Set(['objectId', 'name', 'detail', 'ownerRoleName', 'trigger', 'proposedInstructions', 'proposedScopeStatements', 'proposedToolStatements', 'proposedEscalationRules']);
  const unknown = Object.keys(payload).filter((field) => !allowed.has(field));
  if (unknown.length) throw apiFailure(400, 'INVALID_COMMAND', 'The blueprint edit contains unknown fields.', {
    fieldErrors: unknown.map((field) => ({ field: `payload.${field}`, message: 'This field is not accepted.' })),
  });
  const text = (field, maximum) => {
    const value = payload[field];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
      throw apiFailure(400, 'INVALID_COMMAND', 'The blueprint edit payload is invalid.', {
        fieldErrors: [{ field: `payload.${field}`, message: `Provide text of 1 to ${maximum} characters.` }],
      });
    }
    return value.trim();
  };
  const objectId = text('objectId', 120);
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/i.test(objectId)) throw apiFailure(400, 'INVALID_COMMAND', 'The blueprint object reference is invalid.');
  let proposedScopeStatements;
  if (payload.proposedScopeStatements !== undefined) {
    if (!Array.isArray(payload.proposedScopeStatements) || payload.proposedScopeStatements.length < 1 || payload.proposedScopeStatements.length > 12
      || payload.proposedScopeStatements.some((statement) => typeof statement !== 'string' || !statement.trim() || statement.trim().length > 240)) {
      throw apiFailure(400, 'INVALID_COMMAND', 'The blueprint edit payload is invalid.', {
        fieldErrors: [{ field: 'payload.proposedScopeStatements', message: 'Provide 1–12 proposed scope statements of 1–240 characters each.' }],
      });
    }
    proposedScopeStatements = payload.proposedScopeStatements.map((statement) => statement.trim());
  }
  const proposedList = (field) => {
    if (payload[field] === undefined) return undefined;
    if (!Array.isArray(payload[field]) || payload[field].length > 12
      || payload[field].some((statement) => typeof statement !== 'string' || !statement.trim() || statement.trim().length > 240)) {
      throw apiFailure(400, 'INVALID_COMMAND', 'The blueprint edit payload is invalid.', {
        fieldErrors: [{ field: `payload.${field}`, message: 'Provide up to 12 statements of 1–240 characters each; an empty list is allowed.' }],
      });
    }
    return payload[field].map((statement) => statement.trim());
  };
  const proposedToolStatements = proposedList('proposedToolStatements');
  const proposedEscalationRules = proposedList('proposedEscalationRules');
  return { objectId, name: text('name', 120), detail: text('detail', 700),
    ...(payload.ownerRoleName === undefined ? {} : { ownerRoleName: text('ownerRoleName', 120) }),
    ...(payload.trigger === undefined ? {} : { trigger: text('trigger', 240) }),
    ...(payload.proposedInstructions === undefined ? {} : { proposedInstructions: text('proposedInstructions', 700) }),
    ...(proposedScopeStatements === undefined ? {} : { proposedScopeStatements }),
    ...(proposedToolStatements === undefined ? {} : { proposedToolStatements }),
    ...(proposedEscalationRules === undefined ? {} : { proposedEscalationRules }) };
}

function validateActorBindingPayload(payload) {
  const allowed = new Set(['actorId', 'roleId', 'targetPrincipal', 'blueprintVersion']);
  const unknown = Object.keys(payload).filter((field) => !allowed.has(field));
  if (unknown.length) throw apiFailure(400, 'INVALID_COMMAND', 'The actor binding proposal contains unknown fields.');
  for (const field of ['actorId', 'roleId']) {
    if (typeof payload[field] !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(payload[field])) {
      throw apiFailure(400, 'INVALID_ACTOR_BINDING', `Provide a valid ${field}.`);
    }
  }
  if (typeof payload.targetPrincipal !== 'string' || !/^oidc:[a-f0-9]{64}$/.test(payload.targetPrincipal)) {
    throw apiFailure(400, 'INVALID_ACTOR_BINDING', 'Choose an eligible project member.');
  }
  if (!Number.isInteger(payload.blueprintVersion) || payload.blueprintVersion < 1) {
    throw apiFailure(400, 'INVALID_ACTOR_BINDING', 'Provide the current blueprint version.');
  }
  return { actorId: payload.actorId, roleId: payload.roleId, targetPrincipal: payload.targetPrincipal, blueprintVersion: payload.blueprintVersion };
}

function validateActorBindingEnablePayload(payload) {
  const allowed = new Set(['actorId', 'roleId', 'blueprintVersion']);
  const unknown = Object.keys(payload).filter((field) => !allowed.has(field));
  if (unknown.length) throw apiFailure(400, 'INVALID_COMMAND', 'The actor binding enable command contains unknown fields.');
  for (const field of ['actorId', 'roleId']) {
    if (typeof payload[field] !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(payload[field])) {
      throw apiFailure(400, 'INVALID_ACTOR_BINDING', `Provide a valid ${field}.`);
    }
  }
  if (!Number.isInteger(payload.blueprintVersion) || payload.blueprintVersion < 1) {
    throw apiFailure(400, 'INVALID_ACTOR_BINDING', 'Provide the pinned blueprint version.');
  }
  return { actorId: payload.actorId, roleId: payload.roleId, blueprintVersion: payload.blueprintVersion };
}

function projectEvent(project, { type, actor, commandId, correlationId, data }) {
  return {
    eventId: `event-${randomUUID()}`,
    schemaVersion: API_VERSION,
    tenantId: project.tenantId,
    workspaceId: project.id,
    aggregateId: project.id,
    aggregateVersion: project.version,
    type,
    actor,
    occurredAt: project.updatedAt,
    correlationId,
    causationId: commandId,
    data,
    evidenceRefs: [],
  };
}

async function productGateStatus(statusFile) {
  const value = JSON.parse(await readFile(statusFile, 'utf8'));
  const gates = value.gates;
  if (!Array.isArray(gates) || gates.length !== 12 || new Set(gates.map((gate) => gate.id)).size !== 12 || gates.some((gate) => !/^P-(?:0[1-9]|1[0-2])$/.test(gate.id ?? ''))) {
    throw new Error('Product gate ledger is invalid.');
  }
  return {
    status: 'current',
    passed: gates.filter((gate) => gate.status === 'verified').length,
    total: gates.length,
    source: path.basename(statusFile),
  };
}

function sdlcView(changeCase) {
  normalizeChangeCase(changeCase);
  return { ...changeCase, workspace: workspaceStatus(changeCase), traceability: traceability(changeCase), evidenceIntegrity: verifyEvidenceLedger(changeCase) };
}

function requireVersion(changeCase, suppliedVersion) {
  if (!Number.isInteger(suppliedVersion) || suppliedVersion !== changeCase.version) {
    const error = new Error(`Version conflict: expected ${changeCase.version}. Reload the case before retrying.`);
    error.statusCode = 409;
    throw error;
  }
}

function requestTenant(request) {
  if (request.identity) return request.identity.tenantId;
  const value = String(request.headers['x-orgward-tenant'] ?? 'tenant-reference-bank').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)) throw apiFailure(400, 'INVALID_TENANT_CONTEXT', 'Invalid tenant context.');
  return value;
}

function requireTenant(changeCase, tenantId) {
  if (changeCase.tenantId !== tenantId) {
    const error = new Error('Change case not found.');
    error.statusCode = 404;
    throw error;
  }
}

function scopedAccessStoreUnavailable() {
  return apiFailure(503, 'PROJECT_AUTHORIZATION_UNAVAILABLE', 'The data store cannot enforce principal-scoped access.', {
    retryable: false,
    recoveryActions: [{ type: 'restore_authorized_store', label: 'Restore a store with project-scoped access' }],
  });
}

function requirePrincipalStoreMethod(store, method) {
  if (typeof store[method] !== 'function') throw scopedAccessStoreUnavailable();
}

async function sendAuthorizedSdlcReplay(sdlcStore, response, {
  id, tenantId, principal, authzGeneration, action, idempotencyKey, requestHash,
}) {
  requirePrincipalStoreMethod(sdlcStore, 'withPrincipalAuthority');
  const replayed = await sdlcStore.withPrincipalAuthority({
    id, tenantId, principal,
    requiredPrincipalRoles: ['workspace-write'], authzGeneration,
    operation: (current) => {
      normalizeChangeCase(current);
      requireTenant(current, tenantId);
      const currentCommand = current.idempotency?.[idempotencyKey];
      if (!currentCommand) throw apiFailure(409, 'IDEMPOTENCY_STATE_CHANGED', 'The prior command is no longer available; reload the case before retrying.');
      if (currentCommand.action !== action || currentCommand.requestHash !== requestHash) {
        throw apiFailure(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with a different command.');
      }
      return sendJson(response, 200, { ...sdlcView(current), command: { action, replayed: true, steps: 0 } });
    },
  });
  if (replayed === null) return sendJson(response, 404, { error: 'Change case not found.' });
  return replayed;
}

async function listProjectsForPrincipal(store, tenantId, principal, {
  diagnostics = false, authzGeneration = null, onProjects = null,
} = {}) {
  if (diagnostics) throw scopedAccessStoreUnavailable();
  const deliver = async (records) => {
    await onProjects?.(records);
    return records;
  };
  requirePrincipalStoreMethod(store, 'listWithPrincipalAuthority');
  return store.listWithPrincipalAuthority({
    tenantId, principal, anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
    authzGeneration, operation: ({ records }) => deliver(records),
  });
}

export function createApp({
  dataDirectory = path.join(ROOT, 'data', 'projects'),
  sdlcDirectory = path.join(ROOT, 'data', 'sdlc'),
  executionDirectory = path.join(ROOT, 'data', 'execution-runs'),
  executionWorkspaceDirectory = path.join(ROOT, 'data', 'execution-workspaces'),
  deliveryStatusFile = path.join(ROOT, 'DELIVERY-STATUS.json'),
  executionProfiles = [],
  enableLocalExecution = false,
  databaseUrl = null,
  legacyDirectories = null,
  persistenceFaults = {},
  changeCaseStore: injectedChangeCaseStore = null,
  projectStore: injectedProjectStore = null,
  oidcAuthenticator = null,
  oidcLoginFlow = null,
  oidcSessionStore = null,
  oidcBootstrapPrincipals = [],
  secretEncryptionKey = null,
  openAiValidationEndpoint = 'https://api.openai.com/v1/models',
  readOnly = false,
} = {}) {
  const persistence = databaseUrl ? new PostgresPersistence({ databaseUrl, faults: persistenceFaults }) : null;
  const sessionStore = oidcSessionStore ?? (persistence ? new PostgresOidcSessionStore(persistence, { bootstrapPrincipals: oidcBootstrapPrincipals }) : null);
  const secretStore = persistence ? new PostgresSecretStore(persistence, { encryptionKey: secretEncryptionKey, openAiValidationEndpoint }) : null;
  const store = injectedProjectStore ?? (persistence ? new PostgresProjectStore(persistence) : new ProjectStore(dataDirectory));
  const sdlcStore = injectedChangeCaseStore ?? (persistence ? new PostgresChangeCaseStore(persistence) : new ChangeCaseStore(sdlcDirectory));
  const executionStore = persistence ? new PostgresExecutionRunStore(persistence) : null;
  const importer = persistence ? new LegacyImporter(persistence, legacyDirectories ?? {
    projects: dataDirectory, changeCases: sdlcDirectory, executionRuns: executionDirectory,
  }) : null;
  const localProfile = {
    id: 'scaffold-node-service', label: 'Scaffold Node service', kind: 'system-generator', version: '1.0.0',
    description: 'Creates a traced, testable Node.js service scaffold inside an isolated run workspace.',
    executable: process.execPath, args: [path.join(ROOT, 'workers', 'scaffold-node-service.mjs')],
    sandbox: { readOnlyFiles: [path.join(ROOT, 'workers', 'scaffold-node-service.mjs')] },
    workspaceRoot: path.resolve(executionWorkspaceDirectory), timeoutMs: 60_000,
  };
  const executionService = new ExecutionService({ runDirectory: executionDirectory, store: executionStore, secretStore, profiles: [...executionProfiles, ...(enableLocalExecution ? [localProfile] : [])] });
  if (!persistence) {
    const resolveLocalProjectAccess = async ({ tenantId, projectId, principal, minimum = 'reader' }) => {
      const project = await store.getForPrincipal(projectId, tenantId, principal);
      const membership = project?.memberships?.find((entry) => entry.principal === principal && entry.revokedAt === null);
      return Boolean(membership && (minimum !== 'editor' || ['owner', 'editor'].includes(membership.access)));
    };
    sdlcStore.setProjectAccessResolver?.(resolveLocalProjectAccess);
    executionService.store.setProjectAccessResolver?.(resolveLocalProjectAccess);
  }
  const server = createHttpServer(async (request, response) => {
    setSecurityHeaders(response);
    const correlationId = `correlation-${randomUUID()}`;
    let pathname = '';
    try {
      const url = new URL(request.url, 'http://localhost');
      pathname = url.pathname;
      if (request.method === 'GET' && pathname === '/livez') {
        return sendJson(response, 200, { status: 'alive' });
      }
      if (request.method === 'GET' && pathname === '/readyz') {
        if (!persistence) return sendJson(response, 503, { status: 'not_ready', dependency: 'database' });
        try {
          const probe = await persistence.pool.query('select max(version) as schema_version from orgward.schema_migrations');
          if (!probe.rows[0]?.schema_version || probe.rows[0].schema_version !== persistence.schemaVersion) {
            return sendJson(response, 503, { status: 'not_ready', dependency: 'database' });
          }
          return sendJson(response, 200, { status: 'ready', dependency: 'database', schemaVersion: persistence.schemaVersion });
        } catch {
          return sendJson(response, 503, { status: 'not_ready', dependency: 'database' });
        }
      }
      const secureCookies = oidcLoginFlow ? new URL(oidcLoginFlow.redirectUri).protocol === 'https:' : false;

      if (request.method === 'GET' && pathname === '/auth/login') {
        if (!oidcLoginFlow) throw apiFailure(503, 'OIDC_LOGIN_UNAVAILABLE', 'Browser sign-in is not configured for this installation.');
        const login = oidcLoginFlow.begin(url.searchParams.get('returnTo') ?? '/');
        response.writeHead(302, {
          location: login.location,
          'cache-control': 'no-store',
          'set-cookie': cookie('ow_login', login.state, { maxAge: login.maxAge, pathName: '/auth/callback', secure: secureCookies }),
        });
        response.end();
        return;
      }

      if (request.method === 'GET' && pathname === '/auth/callback') {
        if (!oidcLoginFlow || !sessionStore) throw apiFailure(503, 'OIDC_LOGIN_UNAVAILABLE', 'Browser sign-in is not configured for this installation.');
        const result = await oidcLoginFlow.complete({
          state: url.searchParams.get('state'),
          cookieState: cookieValue(request, 'ow_login'),
          code: url.searchParams.get('code'),
          sessionStore,
        });
        response.writeHead(303, {
          location: result.returnTo,
          'cache-control': 'no-store',
          'set-cookie': [
            clearCookie('ow_login', { pathName: '/auth/callback', secure: secureCookies }),
            cookie('ow_session', result.sessionId, { maxAge: result.maxAge, secure: secureCookies }),
          ],
        });
        response.end();
        return;
      }

      if (request.method === 'GET' && pathname === '/auth/session') {
        if (!sessionStore) return sendJson(response, 200, {
          authenticated: false, mode: oidcLoginFlow ? 'oidc' : 'api-token', roles: [], principal: null,
        });
        if (typeof sessionStore.getWithAuthority !== 'function') {
          throw apiFailure(503, 'IDENTITY_AUTHORITY_UNAVAILABLE', 'Browser session disclosure requires transaction-backed identity authority.');
        }
        return await sessionStore.getWithAuthority(cookieValue(request, 'ow_session'), {
          operation: (active) => sendJson(response, 200, {
            authenticated: Boolean(active), mode: oidcLoginFlow ? 'oidc' : 'api-token',
            roles: active?.roles ?? [], principal: active?.principal ?? null,
          }),
        });
      }

      if (request.method === 'POST' && pathname === '/auth/logout') {
        const expectedOrigin = oidcLoginFlow ? new URL(oidcLoginFlow.redirectUri).origin : null;
        requireSameOrigin(request, expectedOrigin);
        const sessionId = cookieValue(request, 'ow_session');
        if (sessionId && sessionStore) await sessionStore.revoke(sessionId);
        response.writeHead(303, {
          location: '/sign-in.html?signed_out=1',
          'cache-control': 'no-store',
          'set-cookie': [clearCookie('ow_session', { secure: secureCookies })],
        });
        response.end();
        return;
      }

      if (oidcAuthenticator && pathname.startsWith('/api/') && pathname !== '/api/health') {
        const authorization = request.headers.authorization;
        if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
          const verified = await oidcAuthenticator.authenticate(request);
          if (typeof sessionStore?.resolve !== 'function') {
            throw apiFailure(503, 'IDENTITY_AUTHORITY_UNAVAILABLE', 'OIDC requests require persisted tenant-scoped role authority.');
          }
          request.identity = await sessionStore.resolve(verified);
          if (!request.identity) throw apiFailure(401, 'AUTHENTICATION_REQUIRED', 'This identity is revoked or is not bound to the verified tenant.');
        } else {
          request.identity = sessionStore ? await sessionStore.get(cookieValue(request, 'ow_session')) : null;
          if (!request.identity) {
            const error = apiFailure(401, 'AUTHENTICATION_REQUIRED', 'A signed-in OIDC session or bearer token is required.', {
              retryable: false,
              recoveryActions: [{ type: 'sign_in', label: 'Sign in again' }],
            });
            throw error;
          }
          if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
            requireSameOrigin(request, oidcLoginFlow ? new URL(oidcLoginFlow.redirectUri).origin : null);
          }
        }
        if (request.method === 'POST') {
          const required = pathname === '/api/v1/persistence/imports'
            || /^\/api\/v1\/secrets\/secret-[a-z0-9][a-z0-9._-]{0,79}\/revoke$/.test(pathname)
            ? ['tenant-admin']
            : /^\/api\/v1\/identities\/oidc:[a-f0-9]{64}\/revoke$/.test(pathname)
              ? ['tenant-admin']
            : pathname.includes('/execution/runs/') && pathname.endsWith('/approve')
            ? ['execution-approver']
            : pathname.includes('/sdlc/cases/') && pathname.endsWith('/approve')
              ? ['release-approver', 'control-owner']
              : ['workspace-write'];
          const roles = requestRoles(request);
          if (!required.every((role) => roles.includes(role))) {
            throw apiFailure(403, 'ACTION_FORBIDDEN', 'This identity does not have authority for the requested action.', {
              recoveryActions: [{ type: 'request_authority', label: 'Request the required role' }],
            });
          }
        } else if (request.method === 'GET' || request.method === 'HEAD') {
          const roles = requestRoles(request);
          const allowed = pathname === '/api/v1/identities'
            ? ['tenant-admin']
            : ['workspace-read', 'workspace-write', 'tenant-admin'];
          if (!allowed.some((role) => roles.includes(role))) {
            throw apiFailure(403, 'ACTION_FORBIDDEN', 'This identity does not have authority to read workspace data.', {
              recoveryActions: [{ type: 'request_authority', label: 'Request workspace read access' }],
            });
          }
        }
      }

      if (readOnly && pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method)) {
        throw apiFailure(503, 'READ_ONLY_LEGACY_MODE', 'Legacy JSON compatibility mode is read-only. Configure PostgreSQL before changing product data or dispatching work.', {
          retryable: false,
          recoveryActions: [{ type: 'configure_database', label: 'Configure PostgreSQL' }],
        });
      }

      if (request.method === 'GET' && pathname === '/api/v1/foundation') {
        const tenantId = requestTenant(request);
        const asOf = new Date().toISOString();
        const readFoundation = async (principalSnapshot = null, auxiliaryResults = null) => {
          const sourceReads = principalSnapshot
            ? [principalSnapshot.projects, principalSnapshot.changeCases, principalSnapshot.executionRuns]
            : [
              request.identity
                ? listProjectsForPrincipal(store, tenantId, requestActor(request), { diagnostics: true })
                : store.listWithDiagnostics(tenantId),
              request.identity
                ? Promise.reject(scopedAccessStoreUnavailable())
                : sdlcStore.listWithDiagnostics(tenantId),
              executionService.listWithDiagnostics(tenantId, request.identity ? requestActor(request) : null),
            ];
          const [projects, changeCases, executionRuns] = await Promise.allSettled(sourceReads);
          const [productGatesResult, persistenceResult] = auxiliaryResults ?? await Promise.allSettled([
            productGateStatus(deliveryStatusFile),
            persistence ? persistence.status() : Promise.resolve({ status: 'legacy_json', schemaVersion: null, migratedAt: null }),
          ]);
        const source = (result) => {
          if (result.status !== 'fulfilled') return { kind: 'actual', status: 'unavailable', count: null, asOf, sampleSource: null, recoveryActions: [{ type: 'retry', label: 'Retry' }] };
          if (result.value.corruptRecords) return {
            kind: 'actual', status: 'unavailable', count: null, asOf, sampleSource: null,
            recoveryActions: [{ type: 'operator_repair', label: 'Ask an operator to repair storage' }],
          };
          return { kind: 'actual', status: 'current', count: result.value.records.length, asOf, sampleSource: null };
        };
        const sources = { projects: source(projects), changeCases: source(changeCases), executionRuns: source(executionRuns) };
        const actual = Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, value.count]));
        const profiles = executionService.capabilities();
        const productGates = productGatesResult.status === 'fulfilled'
          ? productGatesResult.value
          : { status: 'unavailable', passed: null, total: null, source: path.basename(deliveryStatusFile), recoveryActions: [{ type: 'retry', label: 'Retry' }] };
        const partial = Object.values(sources).some((entry) => entry.status !== 'current') || productGates.status !== 'current' || persistenceResult.status !== 'fulfilled';
        return sendApi(response, 200, {
          product: 'OrgWard Enterprise Studio',
          mode: oidcAuthenticator ? 'oidc' : 'development',
          operationMode: readOnly ? 'read_only_legacy' : persistence ? 'postgresql_transactional' : 'local_development',
          productionReady: false,
          identity: oidcAuthenticator
            ? { status: 'oidc_verified', description: 'API access requires a signed, unexpired OIDC token; tenant claims and server-mapped roles are checked against the current tenant-bound principal status.' }
            : { status: 'development_unverified', description: 'Request headers select local development context; enterprise authentication is not configured.' },
          persistence: persistenceResult.status === 'fulfilled'
            ? {
                ...persistenceResult.value,
                description: persistence
                  ? 'PostgreSQL is authoritative; migrations, transactional command results, audit and outbox persistence are active.'
                  : readOnly
                    ? 'Legacy local JSON compatibility mode is read-only; configure ORGWARD_DATABASE_URL before changing product state or dispatching work.'
                    : 'Local development JSON storage is writable but not an authoritative production store.',
                legacyImportAvailable: Boolean(importer),
              }
            : {
                status: 'unavailable', schemaVersion: null, migratedAt: null, legacyImportAvailable: Boolean(importer),
                description: 'The authoritative PostgreSQL store is unavailable.',
                recoveryActions: [{ type: 'retry', label: 'Retry' }],
              },
          actual,
          sources,
          capabilities: {
            enterpriseDesign: { status: sources.projects.status === 'current' ? 'available' : 'unavailable', action: 'Open workspace', href: '/' },
            governedChange: { status: sources.changeCases.status === 'current' ? 'foundation' : 'unavailable', action: 'Open foundation', href: '/sdlc.html' },
            execution: { status: readOnly ? 'read_only' : profiles.length ? 'foundation' : 'unavailable', action: profiles.length ? 'Open foundation' : 'View specification', href: '/execution.html' },
            persistence: {
              status: persistenceResult.status === 'fulfilled' ? persistenceResult.value.status : 'unavailable',
              action: 'Open administration', href: '/platform.html#administration',
            },
            externalEffects: { status: 'disabled', action: 'View specification', href: '/platform.html#releases' },
            enterpriseIdentity: { status: oidcAuthenticator ? 'foundation' : 'unavailable', action: 'View specification', href: '/platform.html#administration' },
          },
          productGates,
        }, { correlationId, meta: { asOf, partial } });
        };
        if (request.identity && typeof store.withPrincipalFoundationAuthority === 'function') {
          const auxiliaryResults = await Promise.allSettled([
            productGateStatus(deliveryStatusFile),
            persistence ? persistence.status() : Promise.resolve({ status: 'legacy_json', schemaVersion: null, migratedAt: null }),
          ]);
          return await store.withPrincipalFoundationAuthority({
            tenantId, principal: requestActor(request), authzGeneration: request.identity.authzGeneration,
            operation: (snapshot) => readFoundation(snapshot, auxiliaryResults),
          });
        }
        return await readFoundation();
      }

      if (request.method === 'GET' && pathname === '/api/v1/identities') {
        if (!requestRoles(request).includes('tenant-admin')) {
          throw apiFailure(403, 'ACTION_FORBIDDEN', 'Tenant administrator authority is required to manage identities.');
        }
        if (typeof sessionStore?.listPrincipalsForAdmin !== 'function') {
          throw apiFailure(503, 'IDENTITY_ADMIN_UNAVAILABLE', 'Identity administration requires PostgreSQL-backed OIDC authority.');
        }
        return await sessionStore.listPrincipalsForAdmin({
          tenantId: requestTenant(request), actor: requestActor(request),
          actorAuthzGeneration: request.identity.authzGeneration,
          operation: (identities) => {
            sendApi(response, 200, identities, { correlationId, meta: { asOf: new Date().toISOString(), partial: false } });
            return identities;
          },
        });
      }

      if (request.method === 'GET' && pathname === '/api/v1/secrets') {
        if (!secretStore) throw apiFailure(503, 'SECRET_VAULT_UNAVAILABLE', 'Encrypted secret references require PostgreSQL persistence.');
        return await secretStore.listForTenantAdmin({
          tenantId: requestTenant(request), actor: request.identity?.principal,
          actorAuthzGeneration: request.identity?.authzGeneration,
          operation: (references) => sendApi(response, 200, references, {
            correlationId, meta: { asOf: new Date().toISOString(), partial: false },
          }),
        });
      }

      const candidateMatch = pathname.match(/^\/api\/v1\/secrets\/(secret-[a-z0-9][a-z0-9._-]{0,79})\/openai-candidate\/(validate|activate)$/);
      if (candidateMatch && request.method === 'POST') {
        if (!secretStore) throw apiFailure(503, 'SECRET_VAULT_UNAVAILABLE', 'Encrypted secret references require PostgreSQL persistence.');
        const body = validateCommand(await readJson(request));
        rejectAuthorityClaims(body);
        const tenantId = requestTenant(request), actor = request.identity?.principal, actorAuthzGeneration = request.identity?.authzGeneration;
        let result;
        if (candidateMatch[2] === 'validate') {
          if (Object.keys(body.payload).some((field) => field !== 'candidateVersion') || !Number.isSafeInteger(body.payload.candidateVersion)) throw apiFailure(400, 'INVALID_COMMAND', 'Candidate validation requires candidateVersion.');
          result = await secretStore.validateOpenAiCandidate({ tenantId, actor, actorAuthzGeneration, reference: candidateMatch[1], candidateVersion: body.payload.candidateVersion });
        } else {
          if (Object.keys(body.payload).some((field) => !['candidateVersion', 'reason'].includes(field)) || !Number.isSafeInteger(body.expectedVersion) || !Number.isSafeInteger(body.payload.candidateVersion)) throw apiFailure(400, 'INVALID_COMMAND', 'Candidate activation requires expectedVersion, candidateVersion and reason.');
          result = await secretStore.activateOpenAiCandidate({ tenantId, actor, actorAuthzGeneration, reference: candidateMatch[1], commandId: body.commandId, expectedVersion: body.expectedVersion, candidateVersion: body.payload.candidateVersion, reason: body.payload.reason });
        }
        return sendApi(response, 200, result, { correlationId, meta: { replayed: Boolean(result.replayed) } });
      }

      const candidateStageMatch = pathname.match(/^\/api\/v1\/secrets\/(secret-[a-z0-9][a-z0-9._-]{0,79})\/openai-candidate$/);
      if (request.method === 'PUT' && candidateStageMatch) {
        if (!secretStore) throw apiFailure(503, 'SECRET_VAULT_UNAVAILABLE', 'Encrypted secret references require PostgreSQL persistence.');
        const body = validateCommand(await readJson(request));
        rejectAuthorityClaims(body);
        const allowed = ['value', 'model', 'reason', 'expiresAt'];
        if (Object.keys(body.payload).some((field) => !allowed.includes(field)) || typeof body.payload.value !== 'string') throw apiFailure(400, 'INVALID_COMMAND', 'OpenAI candidate accepts value, model, reason and expiresAt only.');
        const result = await secretStore.stageOpenAiCandidate({ tenantId: requestTenant(request), actor: request.identity?.principal, actorAuthzGeneration: request.identity?.authzGeneration, reference: candidateStageMatch[1], commandId: body.commandId, expectedVersion: body.expectedVersion, value: body.payload.value, model: body.payload.model, reason: body.payload.reason, expiresAt: body.payload.expiresAt });
        return sendApi(response, 200, result, { correlationId, meta: { replayed: Boolean(result.replayed) } });
      }

      const secretReferenceMatch = pathname.match(/^\/api\/v1\/secrets\/(secret-[a-z0-9][a-z0-9._-]{0,79})$/);
      if (request.method === 'PUT' && secretReferenceMatch) {
        if (!secretStore) throw apiFailure(503, 'SECRET_VAULT_UNAVAILABLE', 'Encrypted secret references require PostgreSQL persistence.');
        const body = validateCommand(await readJson(request));
        rejectAuthorityClaims(body);
        const extraFields = Object.keys(body).filter((field) => !['schemaVersion', 'commandId', 'expectedVersion', 'payload'].includes(field));
        const payloadFields = Object.keys(body.payload).filter((field) => !['value', 'reason', 'expiresAt'].includes(field));
        if (extraFields.length || payloadFields.length || typeof body.payload.value !== 'string') {
          throw apiFailure(400, 'INVALID_COMMAND', 'Secret rotation accepts only a credential value and audit reason.', {
            fieldErrors: [...extraFields.map((field) => ({ field, message: 'This field is not accepted.' })), ...payloadFields.map((field) => ({ field: `payload.${field}`, message: 'This field is not accepted.' }))],
          });
        }
        const reference = await secretStore.put({
          tenantId: requestTenant(request), actor: request.identity?.principal,
          actorAuthzGeneration: request.identity?.authzGeneration,
          reference: secretReferenceMatch[1], commandId: body.commandId, expectedVersion: body.expectedVersion,
          value: body.payload.value, reason: body.payload.reason, expiresAt: body.payload.expiresAt,
        });
        return sendApi(response, 200, reference.reference, { correlationId, meta: { replayed: reference.replayed } });
      }

      const revokeSecretMatch = pathname.match(/^\/api\/v1\/secrets\/(secret-[a-z0-9][a-z0-9._-]{0,79})\/revoke$/);
      if (request.method === 'POST' && revokeSecretMatch) {
        if (!secretStore) throw apiFailure(503, 'SECRET_VAULT_UNAVAILABLE', 'Encrypted secret references require PostgreSQL persistence.');
        const body = validateCommand(await readJson(request));
        rejectAuthorityClaims(body);
        const extraFields = Object.keys(body).filter((field) => !['schemaVersion', 'commandId', 'expectedVersion', 'payload'].includes(field));
        const payloadFields = Object.keys(body.payload).filter((field) => field !== 'reason');
        if (extraFields.length || payloadFields.length) {
          throw apiFailure(400, 'INVALID_COMMAND', 'Secret revocation accepts only an audit reason.', {
            fieldErrors: [...extraFields.map((field) => ({ field, message: 'This field is not accepted.' })), ...payloadFields.map((field) => ({ field: `payload.${field}`, message: 'This field is not accepted.' }))],
          });
        }
        const reference = await secretStore.revoke({
          tenantId: requestTenant(request), actor: request.identity?.principal,
          actorAuthzGeneration: request.identity?.authzGeneration,
          reference: revokeSecretMatch[1], commandId: body.commandId, expectedVersion: body.expectedVersion,
          reason: body.payload.reason,
        });
        if (!reference) throw apiFailure(404, 'SECRET_REFERENCE_NOT_FOUND', 'Secret reference not found.');
        return sendApi(response, 200, reference.reference, { correlationId, meta: { replayed: reference.replayed } });
      }

      const identityRolesMatch = pathname.match(/^\/api\/v1\/identities\/(oidc:[a-f0-9]{64})\/roles$/);
      if (request.method === 'PUT' && identityRolesMatch) {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((field) => !['roles', 'expectedAuthzGeneration', 'reason'].includes(field))
          || !Array.isArray(body.roles) || !Number.isSafeInteger(body.expectedAuthzGeneration)
          || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) {
          throw apiFailure(400, 'INVALID_COMMAND', 'Provide an allowlisted role set, current target authorization generation, and reason of 1 to 500 characters.');
        }
        if (typeof sessionStore?.updatePrincipalRoles !== 'function') {
          throw apiFailure(503, 'IDENTITY_ADMIN_UNAVAILABLE', 'Identity role changes require PostgreSQL-backed OIDC authority.');
        }
        const updated = await sessionStore.updatePrincipalRoles({
          tenantId: requestTenant(request), principal: identityRolesMatch[1], actor: requestActor(request),
          actorAuthzGeneration: request.identity?.authzGeneration,
          expectedAuthzGeneration: body.expectedAuthzGeneration, roles: body.roles, reason: body.reason,
          afterChange: ({ principal }) => executionService.cancelPrincipal({
            tenantId: requestTenant(request), principal, reason: 'principal_authority_changed',
          }),
        });
        if (!updated) throw apiFailure(404, 'IDENTITY_NOT_FOUND', 'Active identity not found in this tenant.');
        return sendApi(response, 200, updated, { correlationId });
      }

      const revokeIdentityMatch = pathname.match(/^\/api\/v1\/identities\/(oidc:[a-f0-9]{64})\/revoke$/);
      if (request.method === 'POST' && revokeIdentityMatch) {
        if (!requestRoles(request).includes('tenant-admin')) {
          throw apiFailure(403, 'ACTION_FORBIDDEN', 'Tenant administrator authority is required to revoke an identity.');
        }
        const principal = revokeIdentityMatch[1];
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((field) => !['reason', 'expectedAuthzGeneration'].includes(field))
          || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500
          || !Number.isSafeInteger(body.expectedAuthzGeneration)) {
          throw apiFailure(400, 'INVALID_COMMAND', 'Provide the current target authorization generation and a revocation reason of 1 to 500 characters.');
        }
        if (typeof sessionStore?.revokePrincipal !== 'function') {
          throw apiFailure(503, 'IDENTITY_ADMIN_UNAVAILABLE', 'Identity revocation requires PostgreSQL-backed OIDC authority.');
        }
        const revoked = await sessionStore.revokePrincipal({
          tenantId: requestTenant(request), principal, actor: requestActor(request), reason: body.reason,
          actorAuthzGeneration: request.identity?.authzGeneration,
          expectedAuthzGeneration: body.expectedAuthzGeneration,
          beforeRevoke: () => executionService.cancelPrincipal({ tenantId: requestTenant(request), principal, reason: 'principal_revoked' }),
        });
        if (!revoked) throw apiFailure(404, 'IDENTITY_NOT_FOUND', 'Identity not found.');
        return sendApi(response, 200, { principal, status: 'revoked' }, { correlationId });
      }

      if (request.method === 'GET' && pathname === '/api/v1/projects') {
        const tenantId = requestTenant(request);
        const deliverProjects = (projects) => sendApi(response, 200, projects, {
          correlationId, meta: { asOf: new Date().toISOString(), partial: false },
        });
        const projects = request.identity
          ? await listProjectsForPrincipal(store, tenantId, requestActor(request), {
            authzGeneration: request.identity.authzGeneration, onProjects: deliverProjects,
          })
          : await store.list(tenantId);
        if (request.identity) return;
        return deliverProjects(projects);
      }

      if (request.method === 'POST' && pathname === '/api/v1/projects') {
        requireWriteAccess(request);
        const body = validateCommand(await readJson(request), { create: true });
        const payload = validateProjectPayload(body.payload);
        if (request.identity) requirePrincipalStoreMethod(store, 'createWithCommandForPrincipal');
        const actor = requestActor(request);
        const project = normalizeProject(createProject(payload.name), { tenantId: requestTenant(request), actor });
        project.createdBy = actor;
        project.updatedBy = actor;
        const event = projectEvent(project, { type: 'ProjectCreated', actor, commandId: body.commandId, correlationId, data: { name: project.name } });
        project.events.push(event);
        const commandHash = payloadHash({ schemaVersion: body.schemaVersion, payload });
        const result = request.identity
          ? await store.createWithCommandForPrincipal(project, body.commandId, commandHash, actor, {
            requiredPrincipalRoles: ['workspace-write'], authzGeneration: request.identity.authzGeneration,
          })
          : await store.createWithCommand(project, body.commandId, commandHash, actor);
        if (!result) throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        const responseEvent = result.project.events.at(-1);
        return sendApi(response, 201, projectView(result.project), { correlationId, event: responseEvent, meta: { replayed: result.replayed } });
      }

      if (request.method === 'POST' && pathname === '/api/v1/persistence/imports') {
        requireWriteAccess(request);
        if (!importer) throw apiFailure(503, 'POSTGRESQL_REQUIRED', 'Legacy import requires authoritative PostgreSQL persistence.', {
          retryable: false,
          recoveryActions: [{ type: 'configure_database', label: 'Configure PostgreSQL' }],
        });
        const body = validateCommand(await readJson(request), { versionRequired: false });
        if (request.identity) rejectAuthorityClaims(body);
        const extraPayloadFields = Object.keys(body.payload).filter((field) => field !== 'mode');
        if (extraPayloadFields.length) throw apiFailure(400, 'INVALID_COMMAND', 'The import payload contains unsupported fields.', {
          fieldErrors: extraPayloadFields.map((field) => ({ field: `payload.${field}`, message: 'This field is not accepted.' })),
        });
        const mode = body.payload.mode;
        if (!['dry-run', 'apply'].includes(mode)) throw apiFailure(400, 'INVALID_COMMAND', 'The import mode must be dry-run or apply.', {
          fieldErrors: [{ field: 'payload.mode', message: 'Choose dry-run or apply.' }],
        });
        await importer.run({
          tenantId: requestTenant(request), commandId: body.commandId,
          payloadHash: payloadHash({ schemaVersion: body.schemaVersion, payload: { mode } }), mode,
          actor: request.identity?.principal ?? null,
          authzGeneration: request.identity?.authzGeneration ?? null,
          onResult: (result) => sendApi(response, 200, result.result, { correlationId, meta: { replayed: result.replayed } }),
        });
        return;
      }

      const projectMembersMatch = pathname.match(/^\/api\/v1\/projects\/(project-[0-9a-f-]{36})\/members$/);
      if (request.method === 'GET' && projectMembersMatch) {
        if (typeof store.listMembers !== 'function') throw apiFailure(503, 'PROJECT_MEMBERSHIP_UNAVAILABLE', 'Project membership requires an authorization store.');
        const deliverMembers = (members) => {
          sendApi(response, 200, members, { correlationId, meta: { asOf: new Date().toISOString(), partial: false } });
          return members;
        };
        const members = await store.listMembers(
          requestTenant(request), projectMembersMatch[1], requestActor(request),
          request.identity ? {
            actorAuthzGeneration: request.identity.authzGeneration, operation: deliverMembers,
          } : {},
        );
        if (!members) throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        if (request.identity) return;
        return deliverMembers(members);
      }

      if (request.method === 'POST' && projectMembersMatch) {
        requireWriteAccess(request);
        if (typeof store.grantMember !== 'function') throw apiFailure(503, 'PROJECT_MEMBERSHIP_UNAVAILABLE', 'Project membership changes require PostgreSQL-backed authorization.');
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((field) => !['principal', 'access'].includes(field))
          || !/^oidc:[a-f0-9]{64}$/.test(body.principal ?? '') || !['reader', 'editor'].includes(body.access)) {
          throw apiFailure(400, 'INVALID_MEMBERSHIP', 'Provide an active tenant principal and reader or editor access.');
        }
        const membership = await store.grantMember({
          tenantId: requestTenant(request), projectId: projectMembersMatch[1], actor: requestActor(request),
          actorAuthzGeneration: request.identity?.authzGeneration,
          principal: body.principal, access: body.access,
          beforeReaderAccess: body.access === 'reader'
            ? () => executionService.cancelPrincipal({
              tenantId: requestTenant(request), projectId: projectMembersMatch[1],
              principal: body.principal, reason: 'project_access_downgraded',
            })
            : null,
        });
        if (!membership) throw apiFailure(404, 'PROJECT_OR_IDENTITY_NOT_FOUND', 'Project or active tenant identity not found.');
        return sendApi(response, 200, membership, { correlationId });
      }

      const revokeProjectMemberMatch = pathname.match(/^\/api\/v1\/projects\/(project-[0-9a-f-]{36})\/members\/(oidc:[a-f0-9]{64})\/revoke$/);
      if (request.method === 'POST' && revokeProjectMemberMatch) {
        requireWriteAccess(request);
        if (typeof store.revokeMember !== 'function') throw apiFailure(503, 'PROJECT_MEMBERSHIP_UNAVAILABLE', 'Project membership changes require PostgreSQL-backed authorization.');
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
          throw apiFailure(400, 'INVALID_MEMBERSHIP', 'The revocation request does not accept a payload.');
        }
        const revoked = await store.revokeMember({
          tenantId: requestTenant(request), projectId: revokeProjectMemberMatch[1], actor: requestActor(request),
          actorAuthzGeneration: request.identity?.authzGeneration,
          principal: revokeProjectMemberMatch[2],
          beforeRevoke: () => executionService.cancelPrincipal({
            tenantId: requestTenant(request), projectId: revokeProjectMemberMatch[1],
            principal: revokeProjectMemberMatch[2], reason: 'project_membership_revoked',
          }),
        });
        if (!revoked) throw apiFailure(404, 'PROJECT_OR_MEMBER_NOT_FOUND', 'Project or membership not found.');
        return sendApi(response, 200, { principal: revokeProjectMemberMatch[2], status: 'revoked' }, { correlationId });
      }

      const actorBindingEnableMatch = pathname.match(/^\/api\/v1\/projects\/(project-[0-9a-f-]{36})\/actor-bindings\/proposals\/enable$/);
      if (actorBindingEnableMatch && request.method === 'POST') {
        requireWriteAccess(request);
        if (!request.identity) throw apiFailure(403, 'AUTHENTICATION_REQUIRED', 'Verified workspace identity is required to enable an organizational assignment.');
        if (typeof store.persistence?.transaction !== 'function') throw apiFailure(503, 'ACTOR_BINDING_UNAVAILABLE', 'Actor binding transitions require the PostgreSQL authorization registry.');
        requirePrincipalStoreMethod(store, 'updateWithCommandForPrincipal');
        const body = validateCommand(await readJson(request));
        const payload = validateActorBindingEnablePayload(body.payload);
        const tenantId = requestTenant(request);
        const actorPrincipal = requestActor(request);
        const command = {
          operation: 'project.enable-actor-binding',
          commandId: body.commandId,
          payloadHash: payloadHash({ schemaVersion: body.schemaVersion, expectedVersion: body.expectedVersion, payload }),
          expectedVersion: body.expectedVersion,
          async apply(project, client) {
            const blueprint = latestBlueprint(project);
            if (!blueprint || blueprint.version !== payload.blueprintVersion) {
              throw apiFailure(409, 'BLUEPRINT_VERSION_STALE', 'Only a proposal pinned to the current blueprint version can be enabled.');
            }
            const objects = Object.values(blueprint.areas ?? {}).flatMap((area) => area.items ?? []);
            const blueprintActor = objects.find((object) => object.id === payload.actorId);
            const blueprintRole = objects.find((object) => object.id === payload.roleId);
            const linked = blueprintActor && blueprintRole && (blueprintActor.assignedRoles ?? []).includes(blueprintRole.id)
              || (blueprint.relations ?? []).some((relation) => relation.source === payload.actorId
                && relation.target === payload.roleId && relation.type === 'assigned-to');
            if (!blueprintActor || !['actor-human', 'actor-agent'].includes(blueprintActor.type) || !blueprintRole || blueprintRole.type !== 'role' || !linked) {
              throw apiFailure(409, 'BLUEPRINT_ACTOR_OR_ROLE_STALE', 'The actor or linked role no longer exists in the pinned blueprint version.');
            }
            const proposal = await client.query(`
              select b.target_principal, b.target_membership_generation, b.target_authz_generation,
                b.status, identity.actor_type, identity.status as identity_status, identity.authz_generation
              from orgward.project_actor_binding_proposals b
              join orgward.oidc_principals identity
                on identity.tenant_id = b.tenant_id and identity.principal = b.target_principal
              where b.tenant_id = $1 and b.project_id = $2 and b.blueprint_version = $3 and b.actor_id = $4 and b.role_id = $5
              for update of b, identity
            `, [tenantId, project.id, payload.blueprintVersion, payload.actorId, payload.roleId]);
            if (!proposal.rowCount) throw apiFailure(404, 'ACTOR_BINDING_PROPOSAL_NOT_FOUND', 'The version-pinned binding proposal was not found.');
            const row = proposal.rows[0];
            if (row.status !== 'proposed') throw apiFailure(409, 'ACTOR_BINDING_NOT_PROPOSED', 'Only a proposed binding can be enabled.');
            const expectedActorType = blueprintActor.type === 'actor-human' ? 'human' : 'workload';
            const membership = await client.query(`
              select access, generation, revoked_at from orgward.project_memberships
              where tenant_id = $1 and project_id = $2 and principal = $3
              for update
            `, [tenantId, project.id, row.target_principal]);
            if (row.identity_status !== 'active' || !membership.rowCount || membership.rows[0].revoked_at !== null
              || !['owner', 'editor'].includes(membership.rows[0].access)) {
              throw apiFailure(409, 'ACTOR_BINDING_TARGET_INELIGIBLE', 'The proposed target must remain an active owner or editor in this project.');
            }
            if (row.actor_type !== expectedActorType) {
              throw apiFailure(409, 'ACTOR_BINDING_TYPE_MISMATCH', `The proposed target must remain a ${expectedActorType} identity.`);
            }
            if (Number(row.target_authz_generation) !== Number(row.authz_generation)
              || Number(row.target_membership_generation) !== Number(membership.rows[0].generation)) {
              throw apiFailure(409, 'ACTOR_BINDING_TARGET_GENERATION_STALE', 'The target identity or project membership changed after this proposal. Create a new proposal from current state.');
            }
            const enabled = await client.query(`
              update orgward.project_actor_binding_proposals
              set status = 'enabled', enabled_by = $6, enabled_at = now()
              where tenant_id = $1 and project_id = $2 and blueprint_version = $3 and actor_id = $4 and role_id = $5
                and status = 'proposed'
              returning enabled_at
            `, [tenantId, project.id, payload.blueprintVersion, payload.actorId, payload.roleId, actorPrincipal]);
            if (!enabled.rowCount) throw apiFailure(409, 'ACTOR_BINDING_NOT_PROPOSED', 'Only a proposed binding can be enabled.');
            project.version += 1;
            project.updatedAt = new Date().toISOString();
            project.updatedBy = actorPrincipal;
            project.events.push(projectEvent(project, {
              type: 'BlueprintActorBindingEnabled', actor: actorPrincipal,
              commandId: body.commandId, correlationId,
              data: { blueprintVersion: blueprint.version, actorId: payload.actorId, roleId: payload.roleId, status: 'enabled', enabledAt: enabled.rows[0].enabled_at },
            }));
          },
        };
        const result = await store.updateWithCommandForPrincipal(actorBindingEnableMatch[1], tenantId, command, actorPrincipal, {
          requiredPrincipalRoles: ['workspace-write'], authzGeneration: request.identity.authzGeneration,
        });
        if (!result) throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        return sendApi(response, 200, projectView(result.project), {
          correlationId, event: result.project.events.at(-1), meta: { replayed: result.replayed },
        });
      }

      const actorBindingMatch = pathname.match(/^\/api\/v1\/projects\/(project-[0-9a-f-]{36})\/actor-bindings\/proposals$/);
      if (actorBindingMatch && request.method === 'GET') {
        if (!request.identity) throw apiFailure(403, 'AUTHENTICATION_REQUIRED', 'Verified workspace identity is required to view actor binding proposals.');
        if (typeof store.persistence?.transaction !== 'function') throw apiFailure(503, 'ACTOR_BINDING_UNAVAILABLE', 'Actor binding proposals require the PostgreSQL authorization registry.');
        requirePrincipalStoreMethod(store, 'listActorBindingProposals');
        const proposals = await store.listActorBindingProposals({
          tenantId: requestTenant(request), projectId: actorBindingMatch[1], principal: requestActor(request),
          authzGeneration: request.identity.authzGeneration,
        });
        if (!proposals) throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project or authorized membership not found.');
        return sendApi(response, 200, proposals, { correlationId });
      }
      if (actorBindingMatch && request.method === 'POST') {
        requireWriteAccess(request);
        if (!request.identity) throw apiFailure(403, 'AUTHENTICATION_REQUIRED', 'Verified workspace identity is required to propose an actor binding.');
        if (typeof store.persistence?.transaction !== 'function') throw apiFailure(503, 'ACTOR_BINDING_UNAVAILABLE', 'Actor binding proposals require the PostgreSQL authorization registry.');
        requirePrincipalStoreMethod(store, 'updateWithCommandForPrincipal');
        const body = validateCommand(await readJson(request));
        const payload = validateActorBindingPayload(body.payload);
        const tenantId = requestTenant(request);
        const actorPrincipal = requestActor(request);
        const command = {
          operation: 'project.propose-actor-binding',
          commandId: body.commandId,
          payloadHash: payloadHash({ schemaVersion: body.schemaVersion, expectedVersion: body.expectedVersion, payload }),
          expectedVersion: body.expectedVersion,
          async apply(project, client) {
            const blueprint = latestBlueprint(project);
            if (!blueprint || blueprint.version !== payload.blueprintVersion) {
              throw apiFailure(409, 'BLUEPRINT_VERSION_STALE', 'Reload the current proposed blueprint before proposing a binding.');
            }
            const objects = Object.values(blueprint.areas ?? {}).flatMap((area) => area.items ?? []);
            const blueprintActor = objects.find((object) => object.id === payload.actorId);
            const blueprintRole = objects.find((object) => object.id === payload.roleId);
            if (!blueprintActor || !['actor-human', 'actor-agent'].includes(blueprintActor.type) || !blueprintRole || blueprintRole.type !== 'role') {
              throw apiFailure(400, 'BLUEPRINT_ACTOR_OR_ROLE_INVALID', 'Choose an existing blueprint actor and role.');
            }
            const linked = (blueprintActor.assignedRoles ?? []).includes(blueprintRole.id)
              || (blueprint.relations ?? []).some((relation) => relation.source === blueprintActor.id
                && relation.target === blueprintRole.id && relation.type === 'assigned-to');
            if (!linked) throw apiFailure(400, 'BLUEPRINT_ROLE_NOT_LINKED', 'The selected role is not linked to this actor in the pinned blueprint version.');
            const expectedActorType = blueprintActor.type === 'actor-human' ? 'human' : 'workload';
            const target = await client.query(`
              select identity.actor_type, identity.authz_generation, membership.access, membership.generation
              from orgward.oidc_principals identity
              join orgward.project_memberships membership
                on membership.tenant_id = identity.tenant_id and membership.principal = identity.principal
              where identity.tenant_id = $1 and identity.principal = $2 and identity.status = 'active'
                and membership.project_id = $3 and membership.revoked_at is null
              for share of identity, membership
            `, [tenantId, payload.targetPrincipal, project.id]);
            if (!target.rowCount || !['owner', 'editor'].includes(target.rows[0].access)) {
              throw apiFailure(409, 'ACTOR_BINDING_TARGET_INELIGIBLE', 'The selected identity must be active and an owner or editor in this workspace.');
            }
            if (target.rows[0].actor_type !== expectedActorType) {
              throw apiFailure(400, 'ACTOR_BINDING_TYPE_MISMATCH', `This blueprint actor requires a ${expectedActorType} identity.`);
            }
            const priorProposal = await client.query(`
              select 1 from orgward.project_actor_binding_proposals
              where tenant_id = $1 and project_id = $2 and blueprint_version = $3 and actor_id = $4 and role_id = $5
            `, [tenantId, project.id, blueprint.version, blueprintActor.id, blueprintRole.id]);
            if (priorProposal.rowCount) throw apiFailure(409, 'ACTOR_BINDING_ALREADY_PROPOSED', 'A proposal already exists for this actor, role, and blueprint version.');
            await client.query(`
              insert into orgward.project_actor_binding_proposals
                (tenant_id, project_id, blueprint_version, actor_id, role_id, target_principal,
                  target_membership_generation, target_authz_generation, proposed_by)
              values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [tenantId, project.id, blueprint.version, blueprintActor.id, blueprintRole.id, payload.targetPrincipal,
              target.rows[0].generation, target.rows[0].authz_generation, actorPrincipal]);
            project.version += 1;
            project.updatedAt = new Date().toISOString();
            project.updatedBy = actorPrincipal;
            project.events.push(projectEvent(project, {
              type: 'BlueprintActorBindingProposed', actor: actorPrincipal,
              commandId: body.commandId, correlationId,
              data: { blueprintVersion: blueprint.version, actorId: blueprintActor.id, roleId: blueprintRole.id, targetType: expectedActorType, status: 'proposed' },
            }));
          },
        };
        const result = await store.updateWithCommandForPrincipal(actorBindingMatch[1], tenantId, command, actorPrincipal, {
          requiredPrincipalRoles: ['workspace-write'], authzGeneration: request.identity.authzGeneration,
        });
        if (!result) throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        return sendApi(response, 200, projectView(result.project), {
          correlationId, event: result.project.events.at(-1), meta: { replayed: result.replayed },
        });
      }

      const v1ProjectMatch = pathname.match(/^\/api\/v1\/projects\/(project-[0-9a-f-]{36})$/);
      if (request.method === 'GET' && v1ProjectMatch) {
        const tenantId = requestTenant(request);
        const deliverProject = (project) => {
          normalizeProject(project);
          sendApi(response, 200, projectView(project), { correlationId, meta: { asOf: new Date().toISOString(), partial: false } });
          return project;
        };
        if (request.identity) {
          requirePrincipalStoreMethod(store, 'getWithPrincipalAuthority');
          const project = await store.getWithPrincipalAuthority({
            id: v1ProjectMatch[1], tenantId, principal: requestActor(request),
            anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
            authzGeneration: request.identity.authzGeneration, operation: deliverProject,
          });
          if (!project || (project.tenantId ?? 'tenant-reference-bank') !== tenantId) {
            throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project not found.');
          }
          return;
        }
        const project = await store.get(v1ProjectMatch[1], tenantId);
        if (!project || (project.tenantId ?? 'tenant-reference-bank') !== tenantId) {
          throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        }
        return deliverProject(project);
      }

      const v1MessageMatch = pathname.match(/^\/api\/v1\/projects\/(project-[0-9a-f-]{36})\/messages$/);
      if (request.method === 'POST' && v1MessageMatch) {
        requireWriteAccess(request);
        const body = validateCommand(await readJson(request));
        const payload = validateMessagePayload(body.payload);
        if (request.identity) requirePrincipalStoreMethod(store, 'updateWithCommandForPrincipal');
        const tenantId = requestTenant(request);
        const actor = requestActor(request);
        const command = {
          commandId: body.commandId,
          payloadHash: payloadHash({ schemaVersion: body.schemaVersion, expectedVersion: body.expectedVersion, payload }),
          expectedVersion: body.expectedVersion,
          apply(project) {
            normalizeProject(project, { tenantId, actor });
            addConversationTurn(project, payload.content);
            project.version += 1;
            project.updatedBy = actor;
            const event = projectEvent(project, {
              type: 'ProjectAnswerRecorded', actor, commandId: body.commandId, correlationId,
              data: { questionIndex: project.questionIndex, phase: project.phase, blueprintVersion: latestBlueprint(project)?.version ?? null },
            });
            project.events.push(event);
          },
        };
        const result = request.identity
          ? await store.updateWithCommandForPrincipal(v1MessageMatch[1], tenantId, command, actor, {
            requiredPrincipalRoles: ['workspace-write'], authzGeneration: request.identity.authzGeneration,
          })
          : await store.updateWithCommand(v1MessageMatch[1], tenantId, { ...command, principal: null });
        if (!result) throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        return sendApi(response, 200, projectView(result.project), { correlationId, event: result.project.events.at(-1), meta: { replayed: result.replayed } });
      }

      const blueprintEditMatch = pathname.match(/^\/api\/v1\/projects\/(project-[0-9a-f-]{36})\/blueprint\/edits$/);
      if (request.method === 'POST' && blueprintEditMatch) {
        requireWriteAccess(request);
        const body = validateCommand(await readJson(request));
        const payload = validateBlueprintEditPayload(body.payload);
        if (request.identity) requirePrincipalStoreMethod(store, 'updateWithCommandForPrincipal');
        const tenantId = requestTenant(request);
        const actor = requestActor(request);
        const command = {
          operation: 'project.edit-blueprint-object',
          commandId: body.commandId,
          payloadHash: payloadHash({ schemaVersion: body.schemaVersion, expectedVersion: body.expectedVersion, payload }),
          expectedVersion: body.expectedVersion,
          apply(project) {
            normalizeProject(project, { tenantId, actor });
            const blueprint = editBlueprintObject(project, payload, actor);
            project.version += 1;
            project.updatedAt = blueprint.createdAt;
            project.updatedBy = actor;
            const event = projectEvent(project, {
              type: 'BlueprintObjectEdited', actor, commandId: body.commandId, correlationId,
              data: { blueprintId: blueprint.id, blueprintVersion: blueprint.version, objectId: payload.objectId, objectType: blueprint.edit.objectType, changedFields: blueprint.edit.changedFields },
            });
            project.events.push(event);
          },
        };
        const result = request.identity
          ? await store.updateWithCommandForPrincipal(blueprintEditMatch[1], tenantId, command, actor, {
            requiredPrincipalRoles: ['workspace-write'], authzGeneration: request.identity.authzGeneration,
          })
          : await store.updateWithCommand(blueprintEditMatch[1], tenantId, { ...command, principal: null });
        if (!result) throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        return sendApi(response, 200, projectView(result.project), { correlationId, event: result.project.events.at(-1), meta: { replayed: result.replayed } });
      }

      const processPlanMatch = pathname.match(/^\/api\/v1\/projects\/(project-[0-9a-f-]{36})\/process-plans$/);
      if (request.method === 'POST' && processPlanMatch) {
        requireWriteAccess(request);
        const body = validateCommand(await readJson(request));
        const keys = Object.keys(body.payload);
        if (keys.length !== 1 || keys[0] !== 'processId' || typeof body.payload.processId !== 'string'
          || !/^[a-z0-9][a-z0-9-]{0,119}$/i.test(body.payload.processId)) {
          throw apiFailure(400, 'INVALID_COMMAND', 'Choose one valid saved process.', {
            fieldErrors: [{ field: 'payload.processId', message: 'Only a valid processId is accepted.' }],
          });
        }
        if (request.identity) requirePrincipalStoreMethod(store, 'updateWithCommandForPrincipal');
        const tenantId = requestTenant(request);
        const actor = requestActor(request);
        const processId = body.payload.processId;
        const command = {
          operation: 'project.plan-process-task-graph',
          commandId: body.commandId,
          payloadHash: payloadHash({ schemaVersion: body.schemaVersion, expectedVersion: body.expectedVersion, processId }),
          expectedVersion: body.expectedVersion,
          apply(project) {
            normalizeProject(project, { tenantId, actor });
            const plan = planProcessTaskGraph(project, processId, actor);
            project.processPlans ??= [];
            project.processPlans.push(plan);
            project.version += 1;
            project.updatedAt = plan.createdAt;
            project.updatedBy = actor;
            project.events.push(projectEvent(project, {
              type: 'ProcessTaskGraphPlanned', actor, commandId: body.commandId, correlationId,
              data: {
                planId: plan.id, processId: plan.source.processId,
                blueprintVersion: plan.source.blueprintVersion, taskCount: plan.tasks.length, state: plan.state,
              },
            }));
          },
        };
        const result = request.identity
          ? await store.updateWithCommandForPrincipal(processPlanMatch[1], tenantId, command, actor, {
            requiredPrincipalRoles: ['workspace-write'], authzGeneration: request.identity.authzGeneration,
          })
          : await store.updateWithCommand(processPlanMatch[1], tenantId, { ...command, principal: null });
        if (!result) throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        return sendApi(response, 201, projectView(result.project), {
          correlationId, event: result.project.events.at(-1), meta: { replayed: result.replayed },
        });
      }

      const processPlanRevisionMatch = pathname.match(/^\/api\/v1\/projects\/(project-[0-9a-f-]{36})\/process-plans\/(process-plan-[0-9a-f-]{36})\/revisions$/);
      if (request.method === 'POST' && processPlanRevisionMatch) {
        requireWriteAccess(request);
        const body = validateCommand(await readJson(request));
        const keys = Object.keys(body.payload);
        if (keys.length !== 1 || keys[0] !== 'tasks' || !Array.isArray(body.payload.tasks)) {
          throw apiFailure(400, 'INVALID_COMMAND', 'Provide task edits for this planning graph.', {
            fieldErrors: [{ field: 'payload.tasks', message: 'Only a tasks array is accepted.' }],
          });
        }
        const requestsActorBinding = body.payload.tasks.some((task) => task && typeof task === 'object' && task.actorId != null);
        if (requestsActorBinding && typeof store.persistence?.transaction !== 'function') {
          throw apiFailure(503, 'ACTOR_BINDING_UNAVAILABLE', 'Blueprint actor assignments require the PostgreSQL authorization registry.');
        }
        if (request.identity) requirePrincipalStoreMethod(store, 'updateWithCommandForPrincipal');
        const tenantId = requestTenant(request);
        const actor = requestActor(request);
        const planId = processPlanRevisionMatch[2];
        const payload = body.payload;
        const command = {
          operation: 'project.edit-process-task-graph', commandId: body.commandId,
          payloadHash: payloadHash({ schemaVersion: body.schemaVersion, expectedVersion: body.expectedVersion, planId, payload }),
          expectedVersion: body.expectedVersion,
          async apply(project, client) {
            normalizeProject(project, { tenantId, actor });
            const revision = editProcessTaskGraph(project, planId, payload, actor);
            if (revision.tasks.some((task) => task.assignee?.kind === 'blueprint-actor')) {
              if (typeof client?.query !== 'function') throw apiFailure(503, 'ACTOR_BINDING_UNAVAILABLE', 'Blueprint actor assignments require the PostgreSQL authorization transaction.');
              await assertCurrentEnabledPlanActorBindings(client, { tenantId, project, plan: revision });
            }
            project.version += 1;
            project.updatedAt = revision.createdAt;
            project.updatedBy = actor;
            project.events.push(projectEvent(project, {
              type: 'ProcessTaskGraphRevised', actor, commandId: body.commandId, correlationId,
              data: {
                planId, revision: revision.revision, blueprintVersion: revision.source.blueprintVersion,
                changedTasks: revision.changedTasks, state: revision.state,
              },
            }));
          },
        };
        const result = request.identity
          ? await store.updateWithCommandForPrincipal(processPlanRevisionMatch[1], tenantId, command, actor, {
            requiredPrincipalRoles: ['workspace-write'], authzGeneration: request.identity.authzGeneration,
          })
          : await store.updateWithCommand(processPlanRevisionMatch[1], tenantId, { ...command, principal: null });
        if (!result) throw apiFailure(404, 'PROJECT_NOT_FOUND', 'Project not found.');
        return sendApi(response, 200, projectView(result.project), {
          correlationId, event: result.project.events.at(-1), meta: { replayed: result.replayed },
        });
      }

      if (pathname.startsWith('/api/v1/')) {
        throw apiFailure(404, 'ROUTE_NOT_FOUND', 'API route not found.');
      }

      if (request.method === 'GET' && pathname === '/api/health') {
        const profiles = executionService.capabilities();
        const storage = persistence ? await persistence.status() : { status: 'legacy_json' };
        return sendJson(response, 200, {
          status: 'ok', product: 'OrgWard Enterprise Studio', maturity: 'development-foundation', productionReady: false,
          operationMode: readOnly ? 'read_only_legacy' : persistence ? 'postgresql_transactional' : 'local_development',
          persistence: storage,
          execution: { status: readOnly ? 'read_only' : profiles.length ? 'foundation' : 'unavailable', profiles: profiles.length },
        });
      }

      if (request.method === 'GET' && pathname === '/api/projects') {
        const deliverProjects = (projects) => sendJson(response, 200, { projects });
        const projects = request.identity
          ? await listProjectsForPrincipal(store, requestTenant(request), requestActor(request), {
            authzGeneration: request.identity.authzGeneration, onProjects: deliverProjects,
          })
          : await store.list(requestTenant(request));
        if (request.identity) return;
        return deliverProjects(projects);
      }

      if (request.method === 'GET' && pathname === '/api/sdlc/meta') {
        return sendJson(response, 200, { stages: STAGES, mutations: MUTATIONS, proofActionAttemptLimit: PROOF_ACTION_ATTEMPT_LIMIT, referenceScenario: 'Digital beneficial-owner maintenance' });
      }

      if (request.method === 'GET' && pathname === '/api/execution/meta') {
        return sendJson(response, 200, { statuses: EXECUTION_STATUSES, profiles: executionService.capabilities(), operationMode: readOnly ? 'read_only_legacy' : 'writable', productionReady: false });
      }

      if (request.method === 'GET' && pathname === '/api/execution/runs') {
        const deliverRuns = (runs) => sendJson(response, 200, { runs });
        const runs = await executionService.list(
          requestTenant(request), request.identity ? requestActor(request) : null,
          { authzGeneration: request.identity?.authzGeneration, onRuns: request.identity ? deliverRuns : null },
        );
        if (request.identity && runs) return;
        return deliverRuns(runs);
      }

      if (request.method === 'POST' && pathname === '/api/execution/runs') {
        const body = await readJson(request);
        if (request.identity) rejectAuthorityClaims(body);
        if (request.identity && !/^project-[0-9a-f-]{36}$/.test(body.projectId ?? '')) {
          throw apiFailure(400, 'PROJECT_REQUIRED', 'Choose a project for this execution run.');
        }
        const run = await executionService.create({
          ...body,
          ...(request.identity ? {
            tenantId: request.identity.tenantId, requestedBy: request.identity.principal,
            principal: request.identity.principal, scopePrincipal: request.identity.principal,
            authzGeneration: request.identity.authzGeneration,
          } : { tenantId: requestTenant(request) }),
        });
        return sendJson(response, 201, run);
      }

      const executionArtifactMatch = pathname.match(/^\/api\/execution\/runs\/(execution-run-[0-9a-f-]{36})\/artifact$/);
      if (request.method === 'GET' && executionArtifactMatch) {
        const requestedPaths = url.searchParams.getAll('path');
        const sendArtifact = (artifact) => {
          const safeName = artifact.fileName.replace(/[\r\n"\\]/g, '_').replace(/[^\x20-\x7e]/g, '_') || 'artifact';
          const encodedName = encodeURIComponent(artifact.fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
          response.writeHead(200, {
            'content-type': 'application/octet-stream',
            'content-length': artifact.contents.length,
            'content-disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
            'x-content-sha256': artifact.contentHash,
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, no-store',
          });
          response.end(artifact.contents);
        };
        const artifact = requestedPaths.length === 1
          ? await executionService.readArtifact(
            executionArtifactMatch[1], requestTenant(request), request.identity ? requestActor(request) : null,
            requestedPaths[0], { authzGeneration: request.identity?.authzGeneration, onArtifact: sendArtifact },
          )
          : null;
        if (!artifact) return sendJson(response, 404, { error: 'Artifact not found.' });
        return;
      }

      const executionRunMatch = pathname.match(/^\/api\/execution\/runs\/(execution-run-[0-9a-f-]{36})$/);
      if (request.method === 'GET' && executionRunMatch) {
        const deliverRun = (run) => sendJson(response, 200, run);
        const run = await executionService.get(
          executionRunMatch[1], requestTenant(request), request.identity ? requestActor(request) : null,
          { authzGeneration: request.identity?.authzGeneration, onRun: request.identity ? deliverRun : null },
        );
        if (request.identity && run) return;
        return run ? sendJson(response, 200, run) : sendJson(response, 404, { error: 'Execution run not found.' });
      }

      const executionActionMatch = pathname.match(/^\/api\/execution\/runs\/(execution-run-[0-9a-f-]{36})\/(approve|execute)$/);
      if (request.method === 'POST' && executionActionMatch) {
        const body = await readJson(request);
        if (request.identity) rejectAuthorityClaims(body);
        const run = executionActionMatch[2] === 'approve'
          ? await executionService.approve(executionActionMatch[1], requestTenant(request), request.identity
            ? {
                ...body, principal: request.identity.principal, scopePrincipal: request.identity.principal,
                roles: requestRoles(request), authorityGeneration: request.identity.authzGeneration,
              }
            : body)
          : await executionService.execute(executionActionMatch[1], requestTenant(request), request.identity
            ? {
                ...body, principal: request.identity.principal, scopePrincipal: request.identity.principal,
                authorityGeneration: request.identity.authzGeneration,
              }
            : body);
        return run ? sendJson(response, 200, run) : sendJson(response, 404, { error: 'Execution run not found.' });
      }

      if (request.method === 'GET' && pathname === '/api/sdlc/cases') {
        if (request.identity) {
          requirePrincipalStoreMethod(sdlcStore, 'listWithPrincipalAuthority');
          await sdlcStore.listWithPrincipalAuthority({
            tenantId: requestTenant(request), principal: requestActor(request),
            anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
            authzGeneration: request.identity.authzGeneration,
            operation: ({ records }) => sendJson(response, 200, { cases: records }),
          });
          return;
        }
        const cases = await sdlcStore.list(requestTenant(request));
        return sendJson(response, 200, { cases });
      }

      if (request.method === 'POST' && pathname === '/api/sdlc/cases') {
        const body = await readJson(request);
        if (request.identity) {
          rejectAuthorityClaims(body);
          requirePrincipalStoreMethod(sdlcStore, 'saveForPrincipal');
        }
        const changeCase = createChangeCase({
          ...body,
          ...(request.identity ? { tenantId: request.identity.tenantId, createdBy: request.identity.principal, accountableOwner: request.identity.principal } : { tenantId: requestTenant(request) }),
        });
        if (request.identity) {
          if (!/^project-[0-9a-f-]{36}$/.test(body.projectId ?? '')) throw apiFailure(400, 'PROJECT_REQUIRED', 'Choose a project for this change case.');
          changeCase.projectId = body.projectId;
        }
        if (request.identity) await sdlcStore.saveForPrincipal(changeCase, {
          principal: requestActor(request),
          commandAuthority: { requiredRoles: ['workspace-write'], authzGeneration: request.identity.authzGeneration },
        });
        else await sdlcStore.save(changeCase);
        return sendJson(response, 201, sdlcView(changeCase));
      }

      const sdlcCaseMatch = pathname.match(/^\/api\/sdlc\/cases\/(change-case-[0-9a-f-]{36})$/);
      if (request.method === 'GET' && sdlcCaseMatch) {
        if (request.identity) {
          requirePrincipalStoreMethod(sdlcStore, 'withPrincipalAuthority');
          const changeCase = await sdlcStore.withPrincipalAuthority({
            id: sdlcCaseMatch[1], tenantId: requestTenant(request), principal: requestActor(request),
            anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
            authzGeneration: request.identity.authzGeneration,
            operation: (current) => {
              normalizeChangeCase(current);
              requireTenant(current, requestTenant(request));
              return sendJson(response, 200, sdlcView(current));
            },
          });
          if (changeCase === null) return sendJson(response, 404, { error: 'Change case not found.' });
          return;
        }
        const changeCase = await sdlcStore.get(sdlcCaseMatch[1], requestTenant(request));
        if (!changeCase) return sendJson(response, 404, { error: 'Change case not found.' });
        normalizeChangeCase(changeCase);
        requireTenant(changeCase, requestTenant(request));
        return sendJson(response, 200, sdlcView(changeCase));
      }

      const sdlcActionMatch = pathname.match(/^\/api\/sdlc\/cases\/(change-case-[0-9a-f-]{36})\/(advance|run|approve|observe|clarify|answer-clarification|reconcile-clarification|register-proof|record-proof|assess-proofs|route-proof|resume-proof-action|complete-proof-action)$/);
      if (request.method === 'POST' && sdlcActionMatch) {
        if (request.identity) {
          requirePrincipalStoreMethod(sdlcStore, 'withPrincipalAuthority');
          requirePrincipalStoreMethod(sdlcStore, 'saveForPrincipal');
        }
        const action = sdlcActionMatch[2];
        const changeCase = request.identity
          ? await sdlcStore.withPrincipalAuthority({
            id: sdlcActionMatch[1], tenantId: requestTenant(request), principal: requestActor(request),
            minimumProjectAccess: 'editor',
            requiredPrincipalRoles: action === 'approve'
              ? ['workspace-write', 'release-approver', 'control-owner']
              : ['workspace-write'],
            authzGeneration: request.identity.authzGeneration,
            operation: (current) => current,
          })
          : await sdlcStore.get(sdlcActionMatch[1], requestTenant(request));
        if (!changeCase) return sendJson(response, 404, { error: 'Change case not found.' });
        normalizeChangeCase(changeCase);
        requireTenant(changeCase, requestTenant(request));
        const body = await readJson(request);
        if (request.identity) rejectAuthorityClaims(body);
        if (request.identity && action === 'approve' && request.identity.principal === changeCase.createdBy) {
          throw apiFailure(403, 'SEGREGATION_OF_DUTIES', 'The change requester cannot approve its protected release.', {
            recoveryActions: [{ type: 'request_independent_approval', label: 'Request an independent approver' }],
          });
        }
        const authorizedBody = request.identity
          ? {
              ...body,
              principal: request.identity.principal,
              actor: request.identity.principal,
              roles: requestRoles(request),
              ...(action === 'approve' ? { authorityGeneration: request.identity.authzGeneration } : {}),
            }
          : body;
        const exactIdempotencyAction = ['clarify', 'answer-clarification', 'reconcile-clarification', 'register-proof', 'record-proof', 'assess-proofs', 'route-proof', 'resume-proof-action', 'complete-proof-action'].includes(action);
        const priorCommand = body.idempotencyKey && changeCase.idempotency[body.idempotencyKey];
        if (priorCommand && !exactIdempotencyAction) {
          const requestHash = commandRequestHash(authorizedBody);
          if (priorCommand.action !== action || priorCommand.requestHash !== requestHash) {
            throw apiFailure(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with a different command.');
          }
          if (request.identity) {
            await sendAuthorizedSdlcReplay(sdlcStore, response, {
              id: sdlcActionMatch[1], tenantId: requestTenant(request), principal: requestActor(request),
              authzGeneration: request.identity.authzGeneration, action,
              idempotencyKey: body.idempotencyKey, requestHash,
            });
            return;
          }
          return sendJson(response, 200, { ...sdlcView(changeCase), command: { action, replayed: true, steps: 0 } });
        }
        if (changeCase.status === 'STOPPED' && !priorCommand) {
          const error = new Error('Case is STOPPED; no further changes are allowed.');
          error.statusCode = 409;
          throw error;
        }
        if (!priorCommand) requireVersion(changeCase, body.version);
        const persistedVersion = changeCase.version;
        const consumedApproval = request.identity && changeCase.currentStage === 'S9'
          && ['advance', 'run'].includes(action) ? releaseApprovalCandidate(changeCase) : null;
        const result = action === 'advance' ? advanceCase(changeCase, authorizedBody)
          : action === 'run' ? runToCheckpoint(changeCase, authorizedBody)
            : action === 'approve' ? approveRelease(changeCase, authorizedBody)
              : action === 'observe' ? recordObservation(changeCase, authorizedBody)
                : action === 'clarify' ? openClarification(changeCase, authorizedBody)
                  : action === 'answer-clarification' ? answerClarification(changeCase, authorizedBody)
                    : action === 'reconcile-clarification' ? reconcileClarification(changeCase, authorizedBody)
                      : action === 'register-proof' ? registerProofObligation(changeCase, authorizedBody)
                        : action === 'record-proof' ? recordProofResult(changeCase, authorizedBody)
                          : action === 'assess-proofs' ? assessProofs(changeCase, authorizedBody)
                            : action === 'route-proof' ? routeProofResult(changeCase, authorizedBody)
                              : action === 'resume-proof-action' ? resumeProofAction(changeCase, authorizedBody)
                                : completeProofAction(changeCase, authorizedBody);
        if (!result.replayed) {
          if (request.identity) await sdlcStore.saveForPrincipal(result.changeCase, {
            expectedVersion: persistedVersion,
            principal: requestActor(request),
            commandAuthority: { requiredRoles: ['workspace-write'], authzGeneration: request.identity.authzGeneration },
            ...(action === 'approve' ? {
              approvalAuthority: {
                requiredRoles: ['release-approver', 'control-owner'],
                authzGeneration: request.identity.authzGeneration,
              },
            } : {}),
            ...(consumedApproval ? {
              effectAuthority: {
                principal: consumedApproval.principal,
                authzGeneration: consumedApproval.authorityGeneration,
                approvalRef: consumedApproval.id,
              },
            } : {}),
          });
          else await sdlcStore.save(result.changeCase, { expectedVersion: persistedVersion });
        }
        if (request.identity && result.replayed) {
          await sendAuthorizedSdlcReplay(sdlcStore, response, {
            id: sdlcActionMatch[1], tenantId: requestTenant(request), principal: requestActor(request),
            authzGeneration: request.identity.authzGeneration, action,
            idempotencyKey: body.idempotencyKey, requestHash: commandRequestHash(authorizedBody),
          });
          return;
        }
        return sendJson(response, 200, { ...sdlcView(result.changeCase), command: { action, replayed: result.replayed ?? false, steps: result.steps ?? 1 } });
      }

      const sdlcTraceMatch = pathname.match(/^\/api\/sdlc\/cases\/(change-case-[0-9a-f-]{36})\/traceability$/);
      if (request.method === 'GET' && sdlcTraceMatch) {
        if (request.identity) {
          requirePrincipalStoreMethod(sdlcStore, 'withPrincipalAuthority');
          const changeCase = await sdlcStore.withPrincipalAuthority({
            id: sdlcTraceMatch[1], tenantId: requestTenant(request), principal: requestActor(request),
            anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
            authzGeneration: request.identity.authzGeneration,
            operation: (current) => {
              normalizeChangeCase(current);
              requireTenant(current, requestTenant(request));
              return sendJson(response, 200, { traceability: traceability(current), gateHistory: current.gateHistory, evidenceIntegrity: verifyEvidenceLedger(current) });
            },
          });
          if (changeCase === null) return sendJson(response, 404, { error: 'Change case not found.' });
          return;
        }
        const changeCase = await sdlcStore.get(sdlcTraceMatch[1], requestTenant(request));
        if (!changeCase) return sendJson(response, 404, { error: 'Change case not found.' });
        normalizeChangeCase(changeCase);
        requireTenant(changeCase, requestTenant(request));
        return sendJson(response, 200, { traceability: traceability(changeCase), gateHistory: changeCase.gateHistory, evidenceIntegrity: verifyEvidenceLedger(changeCase) });
      }

      if (request.method === 'POST' && pathname === '/api/projects') {
        if (request.identity) throw apiFailure(410, 'USE_VERSIONED_API', 'Use the versioned project command endpoint for authenticated workspaces.');
        if (persistence) return sendJson(response, 410, { error: 'Use the versioned /api/v1/projects command endpoint with PostgreSQL persistence.' });
        const body = await readJson(request);
        const project = createProject(body.name);
        if (request.identity) {
          normalizeProject(project, { tenantId: request.identity.tenantId, actor: request.identity.principal });
          project.memberships = [{ principal: requestActor(request), access: 'owner', generation: 1, grantedAt: new Date().toISOString(), revokedAt: null }];
        }
        await store.save(project);
        return sendJson(response, 201, projectView(project));
      }

      const projectMatch = pathname.match(/^\/api\/projects\/(project-[0-9a-f-]{36})$/);
      if (request.method === 'GET' && projectMatch) {
        if (request.identity) {
          requirePrincipalStoreMethod(store, 'getWithPrincipalAuthority');
          const project = await store.getWithPrincipalAuthority({
            id: projectMatch[1], tenantId: requestTenant(request), principal: requestActor(request),
            anyPrincipalRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
            authzGeneration: request.identity.authzGeneration,
            operation: (current) => sendJson(response, 200, projectView(current)),
          });
          if (project === null) return sendJson(response, 404, { error: 'Project not found.' });
          return;
        }
        const project = await store.get(projectMatch[1], requestTenant(request));
        if (!project) return sendJson(response, 404, { error: 'Project not found.' });
        return sendJson(response, 200, projectView(project));
      }

      const messageMatch = pathname.match(/^\/api\/projects\/(project-[0-9a-f-]{36})\/messages$/);
      if (request.method === 'POST' && messageMatch) {
        if (request.identity) throw apiFailure(410, 'USE_VERSIONED_API', 'Use the versioned project command endpoint for authenticated workspaces.');
        if (persistence) return sendJson(response, 410, { error: 'Use the versioned /api/v1 project command endpoint with PostgreSQL persistence.' });
        const project = request.identity && typeof store.getForPrincipal === 'function'
          ? await store.getForPrincipal(messageMatch[1], requestTenant(request), requestActor(request))
          : await store.get(messageMatch[1], requestTenant(request));
        if (!project) return sendJson(response, 404, { error: 'Project not found.' });
        const body = await readJson(request);
        addConversationTurn(project, body.content);
        if (request.identity) {
          normalizeProject(project, { tenantId: request.identity.tenantId, actor: request.identity.principal });
          project.updatedBy = request.identity.principal;
        }
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
      if (pathname === '/auth/callback') return loginError(response, oidcLoginFlow ? new URL(oidcLoginFlow.redirectUri).protocol === 'https:' : false);
      if (pathname.startsWith('/api/v1/')) return sendApiError(response, error, correlationId);
      const status = error.statusCode ?? (/required|valid JSON|too large|finished discovery|Invalid project|Invalid change case|Invalid execution|only at S|Case is|requires an authorized|awaiting approval|must be approved|cannot approve|valid execution profile/.test(error.message) ? 400 : 500);
      sendJson(response, status, { error: status === 500 ? 'Unexpected server error.' : error.message });
    }
  });
  return {
    server, store, sdlcStore, executionService, persistence, importer, sessionStore, secretStore,
    async init() { await Promise.all([store.init(), sdlcStore.init(), executionService.init({ recoverRunning: !readOnly })]); },
    async close() {
      await executionService.shutdown();
      if (persistence) await persistence.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { config, issues } = parseInstallConfig(process.env);
  if (issues.some((issue) => issue.severity !== 'notice')) {
    for (const issue of issues) console.error(`${issue.severity === 'notice' ? 'NOTICE' : 'ERROR'} ${issue.check}: ${issue.message} Remedy: ${issue.remedy}`);
    process.exitCode = 1;
    process.exit();
  }
  const { host, port, authMode, dataDirectory, sdlcDirectory, executionDirectory, executionWorkspaceDirectory,
    enableLocalExecution, databaseUrl, secretEncryptionKey, openAiCredentialReference, openAiModel,
    legacyReadOnlyMode, oidc, roleMap, tenantBindings, bootstrapPrincipals } = config;
  const { issuer: oidcIssuer, audience: oidcAudience, jwksUri: oidcJwksUri, clientId: oidcClientId,
    redirectUri: oidcRedirectUri, authorizationEndpoint: oidcAuthorizationEndpoint, tokenEndpoint: oidcTokenEndpoint } = oidc;
  let oidcAuthenticator = null;
  let oidcLoginFlow = null;
  if (authMode === 'oidc') {
    const tokenOptions = {
      issuer: oidcIssuer, jwksUri: oidcJwksUri, roleMap,
      tenantClaim: oidc.tenantClaim,
      roleClaim: oidc.roleClaim,
      tenantBindings,
    };
    oidcAuthenticator = new OidcAuthenticator({ ...tokenOptions, audience: oidcAudience });
    const identityAuthenticator = new OidcAuthenticator({ ...tokenOptions, audience: oidcClientId });
    oidcLoginFlow = new OidcLoginFlow({
      clientId: oidcClientId, redirectUri: oidcRedirectUri,
      authorizationEndpoint: oidcAuthorizationEndpoint, tokenEndpoint: oidcTokenEndpoint,
      identityAuthenticator,
    });
  }
  const executionProfiles = openAiCredentialReference ? [{ id: 'openai-current', kind: 'provider-openai', version: '1.0.0', label: `OpenAI · ${openAiModel}`, credentialReference: openAiCredentialReference, model: openAiModel }] : [];
  const app = createApp({ dataDirectory, sdlcDirectory, executionDirectory, executionWorkspaceDirectory, enableLocalExecution, executionProfiles, databaseUrl, oidcAuthenticator, oidcLoginFlow, oidcBootstrapPrincipals: authMode === 'oidc' ? bootstrapPrincipals : [], secretEncryptionKey, readOnly: legacyReadOnlyMode });
  const { server } = app;
  await app.init();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    try { await app.close(); }
    catch (error) { console.error('OrgWard shutdown did not complete cleanly.', error); process.exitCode = 1; }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`OrgWard Enterprise Studio listening privately on http://${host}:${address.port}`);
  });
}
