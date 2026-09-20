import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Read-only materializer. Saving/reviewing output is a separate explicit step.
// These boundary drafts preserve requirements; they do not generate feature tests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: 'string', minLength: 1 };
const integer = { type: 'integer', minimum: 0 };
const array = { type: 'array', items: str, minItems: 1, uniqueItems: true };
const states = ['loading','empty','stale','conflict','failed','denied','success','recovery'];
const kinds = ['positive','negative','concurrent','recovery','isolation','end_to_end','cross_boundary'];

export function parseFields(source) {
  const properties = {}, example = {};
  for (const token of source.split('; ')) {
    const split = token.indexOf('=');
    if (split < 1) throw Error(`Invalid field declaration: ${token}`);
    const key = token.slice(0, split), value = token.slice(split + 1);
    const name = key.replace(/(\[\]|[#!?])$/, '');
    if (Object.hasOwn(properties, name)) throw Error(`Duplicate field: ${name}`);
    if (key.endsWith('[]')) { properties[name] = array; example[name] = value.split(','); }
    else if (key.endsWith('#')) { properties[name] = { type: 'number', minimum: 0 }; example[name] = Number(value); }
    else if (key.endsWith('?')) {
      if (!['true','false'].includes(value)) throw Error(`Invalid boolean: ${name}`);
      properties[name] = { type: 'boolean' }; example[name] = value === 'true';
    } else if (key.endsWith('!')) { properties[name] = { type: 'string', enum: value.split('|') }; example[name] = value.split('|')[0]; }
    else {
      properties[name] = value.startsWith('sha256:') ? { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' } : str;
      example[name] = value.startsWith('sha256:') ? `sha256:${digest(value)}` : value;
    }
  }
  return { definition: obj(properties), example };
}

const owners = {
  studio: 'Enterprise model, baseline, process and operating work; shared canonical object/revision identities, not a per-screen graph store.',
  sdlc: 'Change context, requirements, repository/build/release lineage; reference Studio revisions and shared attempts/effects.',
  sentinel: 'Source revisions, proposed/accepted claims, deterministic snapshots and findings; never authority over accepted business design.',
  warden: 'Policy decisions, capability enforcement and revocation; shared effect broker is the only dispatch boundary.',
  arbiter: 'Scope-bound accountable decisions, delegation, quorum and appeals; actor is authenticated, not supplied by form.',
  steward: 'Semantic definitions, property authority, mappings and data quality; do not fork Studio canonical identities.',
  ledger: 'Immutable causal evidence, verification and export; never an accounting balance or mutable success flag.',
  overseer: 'Agent identity, bounded coordination, evaluation and escalation; no independent second workflow engine.',
  platform: 'Tenant/identity, command, persistence, job, effect, artifact and projection infrastructure; no duplicate domain semantics.',
};

function specialCases(n) {
  const cases = {
    1: ['Validate current JSON fixtures without rewriting their IDs; invalid references fail with a field path.', 'The contract package must distinguish accepted design, enabled authority and observed evidence; they are separate enums.'],
    2: ['GET /api/execution/runs returning {runs:[]} renders 0, never the existing length || 1 fallback.', 'Independent 503 on each of /api/health, /api/execution/runs and /api/sdlc/cases affects only its widgets; unavailable is not zero or sample success.', 'Sample navigation says Preview/View specification; production gate values originate from the canonical ledger, not static cards.'],
    3: ['Reload a deep link with selected object and active lens; back/forward retains selection and visible filter.', 'Dirty draft navigation prompts save/discard/cancel; permission revocation purges inaccessible cached content.'],
    4: ['Two transactions read version 7; only one commits version 8, command result and outbox; loser receives 409.', 'Crash after commit before response; same command ID returns the committed result without a second revision or event.'],
    15: ['10 services at USD 100, USD 40 variable cost each and USD 200 fixed cost yield revenue 1000, cost 600, margin 400.', 'Currency is explicit; no automatic summing of unlike currencies or an implicit exchange rate.'],
    20: ['Worker A holds fencing token 5; after lease expiry B obtains 6; A cannot publish output or dispatch.', 'A heartbeat does not extend revoked policy, identity or an expired approval.'],
    23: ['Pause is acknowledged only after the worker reaches the specified safe boundary; an in-flight remote operation remains reconciling.', 'Changed instructions require a new pinned attempt; resume cannot bypass the mandatory human checkpoint.'],
    49: ['Object customer-1 has revision r1 valid before October and r2 valid from October; September as-of returns r1 without creating another object ID.', 'Late observation records its actual recordedAt while preserving the earlier accepted historical query result; unknown scope is not disjoint.'],
    51: ['Select capability-1 in L-03 then L-08 at baseline-7; object identity, scope, context and breadcrumbs remain identical.', 'Change authority via graph, matrix and form; all submit the same registered command and display the same conflict code.'],
    53: ['Branches change ownerRef and label independently; three-way merge preserves both; two ownerRef edits require explicit resolution.', 'Review binds the resolved candidate digest; a changed head invalidates that review before publish.'],
    68: ['Shuffle the same accepted claims; pinned compiler/profile yields byte-identical canonical snapshot content and digest.', 'Rejected/proposed claims are absent; unknown scope remains unknown; an obsolete job cannot advance the published snapshot head.'],
    69: ['TRANSFERS preserves transferred entity identity; it is not silently rewritten as dependency.', 'OADL export is an integrity projection with explicit losses/extensions, never a complete organisation model.'],
    77: ['Freeze effect-1 at generation 12; publish generation 13 while the graph stays at 12; dispatch denies the stale authorization.', 'Crash after adapter accepted effect-1 before response; provider reconciliation determines outcome before any retry.'],
    80: ['Author and delegate representing the same accountable principal cannot supply two independent quorum votes.', 'Expired or revoked vote cannot satisfy quorum; appeal does not override immutable deny.'],
    109: ['Inventory quote/repair/invoice; missing accountable owner for invoice blocks operating certification despite 100 percent graph coverage.', 'A discovered fourth required activity changes the denominator and invalidates pending certification, not historical evidence.'],
    114: ['Target tenantId is a checked relocation selector, never authenticated tenant context.', 'Old source cell epoch 4 cannot dispatch after target epoch 5 activates; disallowed destination or egress geography blocks relocation.'],
    119: ['Approval binds cursor-7, mapping digest and baseline-9; fence source epoch 4 before target epoch 5 becomes eligible.', 'Crash after fence but before activation leaves no active writer until recovery checks durable cutover state; no old command replay.', 'Irreversible target effect blocks fictional rollback; reviewed forward recovery or evidenced compensation is required.'],
    121: ['Each of the ten entry points normalizes to the same command and tenant/session policy checks.', 'Connector, observation and model output enter proposed state, not accepted design or enabled authority.'],
    122: ['Cycle A→B→C→A terminates with visited-set closure; exceeding traversal budget marks impact incomplete and blocks protected publication.', 'Changing a layout coordinate affects view_only consumers; changing property authority invalidates authorization/evaluation consumers transitively.'],
    123: ['Lock branch head 7/generation 12; atomically commit head 8/generation 13, invalidation marker, result and outbox.', 'An effect dispatch racing publication is ordered by the authoritative fence, not the lagging graph watermark; obsolete recomputation cannot advance current head.'],
    124: ['Observation conflicts with accepted identity-service authority; persist contradiction and proposed repair, never overwrite accepted property.', 'Same source cursor is idempotent; out-of-order source revision cannot hide newer evidence.'],
    125: ['RepairOrder extends a namespaced type and typed predicates; cannot replace core authorization precedence or run arbitrary policy code.', 'Schema evolution preserves old revisions, validates new writes and supplies a forward migration with failed-record quarantine.'],
    126: ['Inspection submission saves typed output and human attestation; mandatory quality-review still blocks process completion.', 'A physical task without certified adapter stays human-attested; no fabricated automatic physical effect.'],
    132: ['Missing one required T-01–T-132 criterion or SQ journey leaves production_ready false.', 'A complete design inventory is not execution/control/outcome coverage; original P/E gates and all source obligations retain their denominators.'],
  };
  return cases[n] || [];
}

export function buildPacket(task, row) {
  const [n, module, operation, record, fields, transition, kind] = row;
  const parsed = parseFields(fields), [from, to] = transition.split('>');
  const pure = kind === 'read', local = [1,2,3,131].includes(n);
  const async = ['effect','qualification'].includes(kind);
  const slug = task.id.toLowerCase();
  const context = { workspaceId: 'workspace-a', branchId: 'branch-1', effectiveAt: '2026-09-19T00:00:00Z' };
  const request = local ? { payload: parsed.example } : {
    commandId: `fixture-${slug}-1`, operation, expectedHead: 7, expectedVersion: 7,
    context, payload: parsed.example, reason: `Exercise ${task.id} boundary`,
  };
  const requestSchema = local ? obj({ payload: parsed.definition }) : obj({
    commandId: str, operation: { const: operation }, expectedHead: integer,
    expectedVersion: integer, context: obj({ workspaceId: str, branchId: str, effectiveAt: str }),
    payload: parsed.definition, reason: str,
  });
  const success = { operation, status: async ? 'accepted' : 'completed', targetState: async ? from : to,
    commandId: local ? `fixture-${slug}-1` : request.commandId,
    resultRef: `${record}-1`, version: pure || local ? 7 : 8,
    authoritativeGeneration: 12, projectionWatermark: 12, partial: false,
    jobId: async ? `job-${slug}-1` : null,
  };
  const successSchema = obj({ operation: { const: operation }, status: { enum: ['accepted','completed'] },
    targetState: str, commandId: str, resultRef: str, version: integer,
    authoritativeGeneration: integer, projectionWatermark: integer, partial: { type: 'boolean' },
    jobId: { type: ['string','null'] },
  });
  const error = { code: 'VERSION_CONFLICT', message: 'The selected revision changed; reload and review the retained draft.',
    fieldErrors: [], correlationId: `trace-${slug}-1`, retryable: false, currentVersion: 8, recoveryActions: ['reload','compare','rebase'] };
  const errorSchema = obj({ code: str, message: str, fieldErrors: { type: 'array', items: obj({ field: str, message: str }) },
    correlationId: str, retryable: { type: 'boolean' }, currentVersion: { type: ['integer','null'] }, recoveryActions: array });
  const permission = `${module}.${operation}: authenticated scoped membership plus current action grant; viewer may query authorized metadata only. Visible resource denial is 403; hidden or foreign resource is indistinguishable 404. ${['approve','publish'].includes(kind) ? 'Protected approval requires an eligible principal independent of the proposal author, bound to exact digest and expiry.' : 'No UI role selector or payload actor grants authority.'}`;
  const testPath = `tests/acceptance/${slug}.test.mjs`;
  const sourceRequirements = task.acceptance.map(ac => ({ id: ac.id, scenario: ac.scenario, sourceKind: ac.kind || 'unspecified' }));
  const persisted = { domainRevisionDelta: pure || local ? 0 : 1, externalDispatchCount: 0,
    resultState: async ? from : to, requiredSourceCriterion: task.acceptance[0].id,
    note: async ? '202 acknowledges durable work only, not successful provider effect or qualification.' : 'Domain-specific result assertions must satisfy the linked original acceptance scenario.' };
  const fixtureInputs = {
    positive: { request, actor: 'authorized-actor-a', tenant: 'tenant-a', initialState: from, currentVersion: 7 },
    negative: { request: { ...request, unexpectedAuthority: 'admin' }, actor: 'viewer-a', tenant: 'tenant-a' },
    concurrent: { request, requests: 2, sameCommandId: true, interleave: ['first.accept','second.accept','first.respond'] },
    recovery: { request, failpoint: async ? 'after-durable-intent-before-provider-response' : 'after-commit-before-response', restart: true },
    isolation: { request, authenticatedTenant: 'tenant-b', targetOwner: 'tenant-a', payloadTenantOverride: 'tenant-a' },
    end_to_end: { request, actor: 'authorized-actor-a', screens: task.screens, actions: ['open','inspect-source','edit-or-select','submit','reload','inspect-durable-result'] },
    cross_boundary: { request, initialGeneration: 12, currentGeneration: 13, projectionWatermark: 12, revokedGrant: true },
  };
  const fixtureExpected = {
    positive: persisted,
    negative: { status: 400, code: 'INVALID_SCHEMA', domainRevisionDelta: 0, externalDispatchCount: 0 },
    concurrent: { durableResultCount: pure || local ? 0 : 1, duplicateExternalDispatchCount: 0, conflictingPayloadStatus: 409 },
    recovery: { lostAcceptedResults: 0, duplicateExternalDispatchCount: 0, unresolvedRemoteResult: async ? 'reconciliation_required' : 'not_applicable' },
    isolation: { status: 404, leakedRecords: 0, leakedCounts: 0, leakedEventIds: 0, externalDispatchCount: 0 },
    end_to_end: { fakeSuccessCount: 0, selectionRetained: true, unauthorizedControlsExecutable: false, originalAcceptanceRequired: task.acceptance.map(a=>a.id) },
    cross_boundary: { protectedDispatchCount: 0, freshness: 'stale', recoveryActions: ['refresh-authority','recompute-context','review-again'], historicalEvidenceOverwritten: false },
  };
  if (pure || local) {
    fixtureInputs.concurrent = { requests: ['selection-a','selection-b'], responseOrder: ['selection-b','selection-a'] };
    fixtureExpected.concurrent = { visibleSelection: 'selection-b', domainRevisionDelta: 0, externalDispatchCount: 0 };
    fixtureInputs.recovery = { request, failpoint: 'refresh-unavailable', reload: true };
    fixtureExpected.recovery = { fabricatedSuccessCount: 0, staleDataLabeled: true, domainRevisionDelta: 0 };
  }
  if (local) {
    fixtureInputs.isolation = { cachedScope: 'workspace-a', nextScope: 'workspace-b', reusedCachedResult: false };
    fixtureExpected.isolation = { staleScopeVisible: false, authenticationProved: false, domainRevisionDelta: 0 };
    fixtureExpected.negative = { validation: 'reject-unexpected-field', domainRevisionDelta: 0, externalDispatchCount: 0 };
    fixtureExpected.cross_boundary = { protectedActionsEnabledByUi: false, freshness: 'stale', fabricatedSuccessCount: 0 };
  }
  const fixtures = kinds.map((fkind, i) => ({ id: `${task.id}-FX-${i+1}`, kind: fkind,
    acceptanceIds: task.acceptance.map(ac=>ac.id), input: fixtureInputs[fkind],
    expectedPersistedResult: fixtureExpected[fkind], testPath, status: 'not_run', scope: 'shared_boundary_only',
    coverageMeaning: 'Cross-cutting obligation only; does not satisfy any original domain scenario by itself.' }));
  // Mapping a scenario is not an executable oracle. Keep this limitation machine
  // visible so a later implementer cannot satisfy a business test with boilerplate.
  for (const ac of task.acceptance) fixtures.push({ id: `${ac.id}-DOMAIN`, kind: ac.kind || 'end_to_end',
    acceptanceIds: [ac.id], input: { request, sourceScenarioId: ac.id, sourceScenarioHash: digest(ac.scenario) },
    expectedPersistedResult: { sourceScenarioId: ac.id, mustAssertOriginalScenario: true, cannotSubstituteBoundaryFixture: true },
    testPath, status: 'not_run', scope: 'domain_oracle_requires_review' });
  const requiredOperations = task.implementation_contract?.operations || [operation];
  const missingOperations = requiredOperations.filter(name => name !== operation);
  const openDecisions = [
    { id: `${task.id}-D01`, owner: 'independent-domain-and-security-reviewer', blocks: 'implementation_start',
      decision: 'Review this primary boundary against every original scenario; author concrete domain datasets and independent output oracles, not assertions derived from the implementation.',
      closure: `Approved bounded slices with executable negative/recovery fixtures for ${task.acceptance.map(a=>a.id).join(', ')} and a legitimate independent review receipt.` },
    ...missingOperations.map((name,i)=>({ id: `${task.id}-OP${i+1}`, owner: `${module}-maintainer`, blocks: 'parent_task_completion',
      decision: `Specify ${name} request/result/state/permission contract in a separately reviewed bounded slice; primary operation ${operation} does not implement it.`,
      closure: `Linked approved packet and passing command/UI/API fixtures for ${name}.` })),
  ];
  const files = local && n === 2 ? ['public/platform.js','public/platform.html',testPath] : local && n === 3 ? ['public/platform.js','public/platform.html','public/platform.css',testPath] : [
    `contracts/enterprise/${slug}.schema.json`, `src/modules/${module}/${slug}.mjs`, testPath,
    ...(!pure && !local ? [`migrations/${slug}.sql`] : []),
  ];
  return {
    format: 'orgward-work-package-draft-v1', taskId: task.id, sliceId: `${task.id}-boundary-draft-01`,
    title: task.title, actor: task.user_story.split(', I want to')[0].replace(/^As /,''),
    trigger: `Authorized actor initiates ${operation} in ${task.screens.join(', ')}; task story: ${task.user_story}`,
    observableOutcome: `Satisfy the unchanged source acceptance for ${task.id}; primary boundary ${operation} reaches ${to} only after actual domain validation. Acknowledged jobs are not completed work.`,
    reviewStatus: 'pending', author: 'codex', reviewer: null, implementationReady: false,
    independentReview: 'Pending real independent review; no review, dependency proof or product execution is asserted.',
    sourceTaskHash: digest(task), sourceRequirements,
    acceptanceIds: task.acceptance.map(a=>a.id), dependencyReceipts: [], dependencies: task.depends_on,
    module, operationKind: kind, ownership: owners[module],
    recordMeaning: `${record} is a boundary payload/result view, not permission to create an independent authoritative store. Resolve its fields into the canonical aggregate family in A-05/C-01.`,
    requiredOperations, uncoveredOperations: missingOperations, openDecisions,
    schemas: [{ id: `${operation}Request`, definition: requestSchema }, { id: `${operation}Result`, definition: successSchema }, { id: 'SafeError', definition: errorSchema }],
    operations: [{ name: operation, transport: local ? 'existing-client-or-local-contract-function' : pure ? 'GET /api/v1/queries/{operation}; serialize input in query parameters, no GET body' : 'POST /api/v1/commands',
      requestSchema: `${operation}Request`, resultSchema: `${operation}Result`, errorSchema: 'SafeError',
      requestExample: request, successExample: success, errorExample: error, permission,
      exampleMeaning: 'Reserved synthetic IDs; digest strings are hashes of fixture labels, not claims about real artifacts. Missing referenced records must fail validation.',
      acknowledgement: async ? 'HTTP 202 only after durable job creation; GET /api/v1/commands/{commandId} reports actual progress.' : 'Return only computed/readback result; never a static success sample.' }],
    permissionRule: permission,
    transactionBoundary: pure || local ? 'No authoritative domain mutation. Use authorized existing read paths; local preferences are not business facts. Diagnostics emit test artifacts, not product acceptance.' : 'One tenant-scoped PostgreSQL transaction checks identity/policy/version and commits domain revision, command result, audit intent and outbox. No network/provider call inside this transaction. Protected remote effects use a separately fenced durable broker intent.',
    idempotencyRule: pure || local ? 'Repeat reads without domain writes; cancel older UI request results so they cannot overwrite a newer selection.' : 'Unique (tenantId, operation, commandId) with canonical request hash. Equal replay returns original result; unequal payload returns 409. expectedVersion fences aggregate; expectedHead fences branch baseline. Neither may be inferred from stale UI.',
    invalidationRule: 'Use CHANGE-PROTOCOL dependency kinds/field paths. Semantic accepted publication atomically advances the authoritative invalidation generation. A view-only change does not invalidate evidence. Projection lag is visible; protected effects revalidate current identity/policy/context/cell epoch.',
    migrationRecovery: pure || local ? 'Retain existing URL/selection and readable legacy data. Failed refresh cannot erase last-known data or relabel it fresh. No database migration in this boundary.' : 'Expand/read-compatible schema first; backfill with stable IDs and source hashes, quarantine failures, reconcile counts and only then cut over. Restart uses command status and durable cursors. Unknown remote effects reconcile before retry; irreversible outcomes require forward recovery, not history deletion.',
    persistence: { authoritative: !pure && !local, tenantBoundary: 'Session-derived tenant/workspace; composite references and tenant-leading indices. A payload target tenant is a checked selector only.',
      indices: pure || local ? [] : ['UNIQUE (tenant_id, operation, command_id)', '(tenant_id, aggregate_id, version)', '(tenant_id, workspace_id, state, updated_at, id)'],
      immutable: ['published revisions','accepted evidence','prior attempts'], layoutStorage: 'per-principal view preference; no semantic write' },
    events: [{ type: pure || local ? 'NoDomainEvent' : `${operation}Recorded`, meaning: pure || local ? 'Read/local diagnostics publish no authoritative event.' : 'Draft event name to reconcile with canonical registered events before approval; emitted only after durable commit.',
      envelopeFields: ['eventId','schemaVersion','tenantId','workspaceId','aggregateId','version','type','actor','occurredAt','correlationId','causationId','data','evidenceRefs'],
      consumers: pure || local ? [] : ['ledger-audit','authorized-read-projection'], delivery: 'Outbox at least once; deduplicate eventId, reject obsolete head promotion.' }],
    requiredEvents: task.implementation_contract?.events || [],
    transitions: [{ from, command: operation, to, precondition: 'Valid schema, authorized actor, current version and domain conditions in the source scenario; async acceptance alone does not reach terminal state.', failureRecovery: 'Retain draft and prior evidence; show safe error and permitted recovery. Resolve command status before retry.' },
      { from, command: `${operation}:invalid-or-denied`, to: from, precondition: 'Invalid payload, hidden object, stale context, unmet checkpoint or expired permission.', failureRecovery: 'No domain/effect transition; disclose no hidden object data. Rebase or obtain legitimate new authority.' }],
    ui: { screens: task.screens, source: 'docs/product/SCREEN-CONTRACTS.md + PORTFOLIO-UX.md + MIGRATION-AND-COVERAGE.md',
      controls: Object.entries(parsed.definition.properties).map(([field,schema])=>({ field, control: schema.enum ? 'select' : schema.type === 'boolean' ? 'checkbox' : schema.type === 'number' ? 'numeric-input' : schema.type === 'array' ? 'typed-reference-list' : 'text-or-authorized-reference', required: true, valueSource: 'server-validated record or retained user draft', validation: schema })),
      primaryAction: operation, permissionVisibility: 'Explain disabled visible actions; omit inaccessible resources. Server repeats authorization.',
      keyboard: 'Tab reaches all controls in reading order; visible focus, labeled errors, focus first invalid field. Escape closes dialog and restores trigger focus; graph has list/table alternative.',
      reload: 'Use durable result ID and pinned baseline, then restore selection/filter. Never replay a mutation just because the page reloads.',
      legacyException: local ? 'Implement against existing client/local boundaries. Do not require the unbuilt /api/v1 backend for independent T-01/T-02/T-03 diagnostics.' : null },
    uiStates: states.map(state=>({ state, behavior: ({
      loading: 'Show pending request and retain selection; disable duplicate submission without blocking unrelated navigation.',
      empty: 'Show zero only after successful authorized empty response; offer the relevant create/import action if allowed.',
      stale: 'Show source timestamp and baseline/watermark mismatch; allow inspect/refresh but prevent protected stale action.',
      conflict: 'Keep unsaved values, show changed fields/current version, and require compare/rebase before new submission.',
      failed: 'Display safe error, trace ID and retry eligibility; do not replace data with successful example values.',
      denied: 'Explain denied action only on a visible resource; hide foreign resource details and purge revoked cached data.',
      success: 'Render actual server readback and explicit proposed/accepted/enabled/evidenced state; a queued job is still queued.',
      recovery: 'Inspect command/job outcome and unresolved effects; offer only permitted retry, resume, reconciliation or reviewed compensation.',
    })[state] })),
    fixtures, domainCounterexamples: specialCases(n),
    targetFiles: files, fileStatus: 'intended paths, not implementation evidence',
    slices: [
      { id: `${task.id}-contract`, dependsOn: [], covers: task.acceptance.map(a=>a.id), exit: 'Resolve open decisions, concrete domain oracles and independent review; schemas and examples must validate.' },
      { id: `${task.id}-domain`, dependsOn: [`${task.id}-contract`,...task.depends_on], covers: task.acceptance.map(a=>a.id), exit: 'Actual state, permission, concurrency and restart tests; no mock substituted for required real provider.' },
      { id: `${task.id}-experience`, dependsOn: [`${task.id}-domain`], covers: task.acceptance.map(a=>a.id), exit: 'Working role journey across all listed screens/states with keyboard and reload checks.' },
      { id: `${task.id}-qualification`, dependsOn: [`${task.id}-experience`], covers: task.acceptance.map(a=>a.id), exit: 'Independent revision-bound evidence for every original criterion and integration obligation; reconcile all child slices before parent closure.' },
    ],
    observability: 'Record correlation/command/job IDs, operation, authorized scope, version/generation/fence and safe error code. Redact content, credentials and foreign identifiers. Metrics include rejection, conflict, lag and unknown-effect counts; tenant labels are authorized and bounded.',
    sourceDecisions: ['docs/production/SOLUTION-ARCHITECTURE.md','docs/production/CHANGE-PROTOCOL.md','docs/production/DELIVERY-CONTRACTS.md','docs/production/IMPLEMENTATION-HANDOFF.md','docs/production/IMPLEMENTATION-BACKLOG.json', ...(module === 'sentinel' ? ['docs/product/SENTINEL-CONTRACT.md'] : [])],
    nonGoals: ['No implementation or independent approval claimed by this draft.', 'No public deployment, new authority, real transaction or customer-specific policy inferred.', 'Do not replace existing IDs, task dependencies, domain scenarios or source rule IDs with generated boundary checks.'],
    evidence: { status: 'not_run', receipts: [], commands: [`node --test ${testPath}`, 'npm run check', 'node ops/check-spec.mjs --self-test --verify-sources'],
      required: ['revision','fixture manifest','actual storage/event/effect assertions','role journey','environment/provider versions','raw results','unresolved findings','independent review'] },
  };
}

export async function buildDrafts() {
  const plan = await read('docs/production/IMPLEMENTATION-BACKLOG.json');
  const seeds = await read('contracts/enterprise/packet-blueprints.json');
  if (new Set(seeds.rows.map(r=>r[0])).size !== plan.tasks.length) throw Error('Task seed coverage differs');
  return plan.tasks.map(task => {
    const row = seeds.rows.find(r=>r[0] === Number(task.id.slice(2)));
    if (!row || !owners[row[1]]) throw Error(`Missing/unknown seed ${task.id}`);
    return buildPacket(task, row);
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const drafts = await buildDrafts();
  const start = Number(process.argv[2] || 1), end = Number(process.argv[3] || 132);
  console.log(JSON.stringify(drafts.filter(p=>Number(p.taskId.slice(2))>=start && Number(p.taskId.slice(2))<=end)));
}
