import { verifyManualFlowPlan, normalizeHumanDecisionChoice, projectManualFlowActivation } from '../enterprise/process-runtime.mjs';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalJson,
  contentHash,
  persistenceIntegrity,
  recordEvent,
  verifyAggregateRow,
  verifyCommandRow,
} from './postgres.mjs';
import { addRequirementFromSavedProcess as addSavedProcessRequirement, commandRequestHash, pinProjectSourceObject, releaseApprovalCandidate,
  sourceBindingSelection, verifyAcceptedG6Plan, verifyContextManifest, verifySourceBinding } from '../sdlc/engine.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { latestBlueprint } from '../model.mjs';
import { SOFTWARE_PLAN_COMPILER_VERSION, verifySoftwareDeliveryDraft } from '../sdlc/software-plan-compiler.mjs';
import { providerOutcomeDiagnosticForAttempt } from '../execution/provider-transport-diagnostic.mjs';
import { buildProcessBehaviorTestPlan, candidateChangesCoveredByPathMap, deriveScenarioMappingEvidence, parseNodeTestAssertions, processBehaviorCandidateDisposition, verifyProcessBehaviorTestPlan } from '../sdlc/behavior-test-evidence.mjs';
import { buildT91N1OrphanPathMapping, buildT91N2AuthorizationMapping, buildT91N2MissingAssertionMapping,
  buildT91N3DeletedFailingTestMapping, buildT91R1RecoveryMapping, buildT91R2RecoveryMapping, classifyT91R1RecoveryObservation,
  classifyT91R2RecoveryObservation,
  t91R1RecoveryFixtureHash, t91R1RecoveryReceiptStatement, T91_R1_CRITERION_RECOVERY_HARNESS,
  t91R2RecoveryFixtureHash, t91R2RecoveryReceiptStatement, T91_R2_SHARED_DRAFT_RECOVERY_HARNESS,
  isSupportedT91R2RecoveryDefinition,
  isIndependentT91N2MappingReviewer,
  T91_N2_AUTHORIZATION_HARNESS, T91_N2_MISSING_ASSERTION_HARNESS, t91N2AuthorizationFixtureHash,
  T91_N1_ORPHAN_PATH_HARNESS, T91_N3_DELETED_FAILING_TEST_HARNESS, classifyT91N1OrphanPathObservation,
  classifyT91N3DeletedFailingTestObservation, t91N3DeletedFailingTestFixtureHash,
  t91N3DeletedFailingTestReceiptStatement, T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH,
  isValidT91ProductHarnessInvocationPair, isValidT91N3ReceiptObservedPins,
  t91N1OrphanPathFixtureHash, t91N1OrphanPathReceiptStatement,
  T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, t91N2AuthorizationInvocationFixtureHash,
  projectT91N2AuthorizationExecutionIntegrity, classifyT91N2AuthorizationObservation,
  classifyT91N2MissingAssertionObservation, isSupportedT91N1OrphanPathDefinition, isSupportedT91N2AuthorizationDefinition,
  isSupportedT91N2MissingAssertionDefinition, isSupportedT91N3DeletedFailingTestDefinition, isSupportedT91R1RecoveryDefinition,
  t91N2MissingAssertionFixtureHash, verifyT91N2AuthorizationReservationPins,
  verifyT91N2AuthorizationMapping } from '../sdlc/product-harness.mjs';
import { verifyRequirementCriterionContract } from '../sdlc/criterion-contract.mjs';
import { isViewOnlyProcessFlowSuccessor } from '../enterprise/process-flow-sensitivity.mjs';
import { isValidEnterpriseIntegrityAssessment } from '../enterprise/integrity.mjs';
import { softwareRuntimePlanSnapshot, verifySoftwareRuntimePlanSnapshot } from '../sdlc/software-runtime-plan.mjs';
import { buildBlueprintProposalPrompt, buildLegacyBlueprintProposalPrompt } from '../execution/proposals.mjs';
import {
  cancelProcessTaskExecutionRun,
  cancelProcessTaskExecutionRunByInstance,
  amendPausedProcessTaskExecutionRun,
  executionApprovalRequestHash,
  pauseProcessTaskExecutionRun,
  pauseUndispatchedProcessTaskExecutionRun,
  resumeProcessTaskExecutionRun,
} from '../execution/contracts.mjs';

const IDENTIFIERS = {
  project: /^project-[0-9a-f-]{36}$/,
  change_case: /^change-case-[0-9a-f-]{36}$/,
  execution_run: /^execution-run-[0-9a-f-]{36}$/,
};
const HUMAN_APPROVER_ROLES = new Set(['execution-approver', 'release-approver', 'control-owner']);
const PROCESS_CONTROL_ACTORS = Object.freeze({
  ProcessTaskInstancePauseRequested: 'authorized controller',
  ProcessTaskInstancePaused: 'authorized controller',
  ProcessTaskInstanceResumed: 'authorized controller',
  ProcessTaskInstanceAbandonedUnverified: 'project owner',
  ProcessTaskInstanceCancelled: 'authorized controller',
});

function safeProcessTaskControlEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.slice(-100).flatMap((event) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)
      || typeof event.type !== 'string' || !Object.hasOwn(PROCESS_CONTROL_ACTORS, event.type)
      || typeof event.at !== 'string' || event.at.length > 64 || !Number.isFinite(Date.parse(event.at))) return [];
    const source = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {};
    const data = {};
    if (typeof source.reason === 'string' && source.reason.trim()) data.reason = source.reason.trim().slice(0, 1000);
    if (event.type === 'ProcessTaskInstanceAbandonedUnverified') {
      for (const field of ['runIds', 'attemptIds', 'evidence']) {
        const maximumLength = field === 'evidence' ? 1000 : 160;
        data[field] = Array.isArray(source[field]) ? source[field].slice(0, 20)
          .flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim().slice(0, maximumLength)] : []) : [];
      }
      data.acknowledgeDuplicateCostWork = source.acknowledgeDuplicateCostWork === true;
    }
    return [{ type: event.type, at: event.at,
      actor: event.actor === 'system' ? 'system' : PROCESS_CONTROL_ACTORS[event.type], data }];
  });
}

function requiresHumanApprover(roles) {
  return Array.isArray(roles) && roles.some((role) => HUMAN_APPROVER_ROLES.has(role));
}

function conflict(message, currentVersion = null, code = 'VERSION_CONFLICT') {
  const error = new Error(message);
  Object.assign(error, {
    statusCode: 409,
    code,
    currentVersion,
    retryable: code === 'VERSION_CONFLICT',
    recoveryActions: code === 'VERSION_CONFLICT'
      ? [{ type: 'reload', label: 'Reload current version' }, { type: 'retry', label: 'Retry with retained input' }]
      : [],
  });
  return error;
}

function processPlanUsesCurrentOrViewOnlyBlueprint(project, plan) {
  const currentBlueprint = project?.blueprintVersions?.at(-1);
  if (!currentBlueprint || project.id !== plan?.source?.projectId) return false;
  if (currentBlueprint.version === plan.source.blueprintVersion
    && currentBlueprint.id === plan.source.blueprintId) return true;
  return isViewOnlyProcessFlowSuccessor({ plan,
    sourceBlueprint: project.blueprintVersions.find((entry) => entry.id === plan.source.blueprintId
      && entry.version === plan.source.blueprintVersion),
    currentBlueprint,
    blueprintHistory: project.blueprintVersions,
  });
}

function projectAccessDenied() {
  const error = new Error('Project membership does not allow this action.');
  Object.assign(error, { statusCode: 403, code: 'ACTION_FORBIDDEN', retryable: false });
  return error;
}

async function resolveRuntimeProcessPlan(client, { tenantId, projectId, project, planId, revision }) {
  if (!project) {
    const projectRow = await client.query(`select * from orgward.aggregates
      where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, projectId]);
    if (!projectRow.rowCount) return null;
    project = verifyAggregateRow(projectRow.rows[0]);
  }
  const saved = (project?.processPlans ?? []).find((candidate) => candidate.id === planId
    && Number(candidate.revision ?? 1) === Number(revision));
  if (saved) {
    verifyManualFlowPlan(saved, project.blueprintVersions?.find((blueprint) => blueprint.id === saved.source.blueprintId && blueprint.version === saved.source.blueprintVersion));
    return saved;
  }
  const result = await client.query(`select project_id, case_id, runtime_revision, snapshot_hash, snapshot
    from orgward.software_delivery_runtime_plans
    where tenant_id=$1 and project_id=$2 and plan_id=$3 and runtime_revision=$4 for share`, [tenantId, projectId, planId, revision]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (Number(row.runtime_revision) !== Number(revision) || row.project_id !== projectId || row.snapshot?.binding?.caseId !== row.case_id
    || row.snapshot?.id !== planId || row.snapshot_hash !== row.snapshot?.snapshotHash
    || row.snapshot?.binding?.projectId !== projectId || !verifySoftwareRuntimePlanSnapshot(row.snapshot)) {
    throw persistenceIntegrity('An immutable software delivery runtime snapshot failed provenance verification.');
  }
  const sourceRows = await client.query(`select d.plan_hash,d.plan,r.review_hash,r.review
    from orgward.software_delivery_plans d
    join orgward.software_delivery_assignment_reviews r
      on r.tenant_id=d.tenant_id and r.project_id=d.project_id and r.case_id=d.case_id and r.plan_id=d.plan_id
    where d.tenant_id=$1 and d.project_id=$2 and d.case_id=$3 and d.plan_id=$4 and r.review_revision=$5`,
  [tenantId, projectId, row.case_id, planId, row.snapshot.binding.reviewRevision]);
  if (sourceRows.rowCount !== 1 || sourceRows.rows[0].plan_hash !== contentHash(sourceRows.rows[0].plan)
    || sourceRows.rows[0].review_hash !== sourceRows.rows[0].review?.reviewHash
    || digest(Object.fromEntries(Object.entries(sourceRows.rows[0].review).filter(([key]) => key !== 'reviewHash')))
      !== sourceRows.rows[0].review_hash) {
    throw persistenceIntegrity('The immutable runtime snapshot no longer matches its stored draft and owner review.');
  }
  try {
    const recomputed = softwareRuntimePlanSnapshot({ draft: sourceRows.rows[0].plan, review: sourceRows.rows[0].review,
      project, principal: row.snapshot.createdBy });
    if (canonicalJson(recomputed) !== canonicalJson(row.snapshot)) {
      throw persistenceIntegrity('The immutable runtime snapshot does not match its source draft and reviewed assignments.');
    }
  } catch (error) {
    if (error?.statusCode) throw error;
    throw persistenceIntegrity('The immutable runtime snapshot could not be rebuilt from its source draft and review.');
  }
  return row.snapshot;
}

function verifyRuntimePlanTasks(plan, runtimes) {
  if (!plan || !Array.isArray(plan.tasks)) throw persistenceIntegrity('A process runtime references a missing saved task graph.');
  const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
  if (tasks.size !== plan.tasks.length) throw persistenceIntegrity('A saved task graph contains duplicate task identities.');
  for (const runtime of runtimes) {
    const task = tasks.get(runtime.task_id);
    if (!task || runtime.process_plan_id !== plan.id || Number(runtime.plan_revision) !== Number(plan.revision ?? 1)
      || runtime.blueprint_id !== plan.source.blueprintId || Number(runtime.blueprint_version) !== Number(plan.source.blueprintVersion)) {
      throw persistenceIntegrity('A process task runtime does not match its immutable graph snapshot.');
    }
    if (plan.kind === 'manual_process_flow_plan' && (!['human', 'workload'].includes(runtime.actor_type)
      || (runtime.actor_type === 'human' && runtime.execution_run_id)
      || (runtime.actor_type === 'workload' && !['manual', 'manual-exception'].includes(task.flowRef?.kind))
      || runtime.actor_id !== task.assignee?.actorId || runtime.role_id !== task.assignee?.roleId
      || runtime.process_id !== plan.source.processId)) throw persistenceIntegrity('A manual flow runtime does not match its pinned human assignment.');
    if (plan.kind === 'software_delivery_runtime_plan'
      && (runtime.actor_type !== 'human' || runtime.execution_run_id
        || task.assignee?.actorId !== runtime.actor_id || task.assignee?.roleId !== runtime.role_id
        || task.assignee?.principal !== runtime.assigned_principal
        || task.assignee?.membershipGeneration !== Number(runtime.assigned_membership_generation)
        || task.assignee?.authzGeneration !== Number(runtime.assigned_authz_generation))) {
      throw persistenceIntegrity('A human software runtime row does not match its immutable reviewed assignment.');
    }
  }
  return tasks;
}

function verifyCompleteSoftwareRuntimeInstance(plan, runtimes, tasks = new Map(plan?.tasks?.map((task) => [task.id, task]) ?? [])) {
  if (plan?.kind !== 'software_delivery_runtime_plan') return;
  const taskIds = new Set(runtimes.map((runtime) => runtime.task_id));
  if (taskIds.size !== tasks.size || [...tasks.keys()].some((taskId) => !taskIds.has(taskId))) {
    throw persistenceIntegrity('A promoted software checkpoint instance is missing one or more snapshot task rows.');
  }
}

async function loadProcessInstancePlan(client, { tenantId, projectId, control, runtimes }) {
  const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId,
    planId: control.process_plan_id, revision: Number(control.plan_revision) });
  const tasks = verifyRuntimePlanTasks(plan, runtimes);
  verifyCompleteSoftwareRuntimeInstance(plan, runtimes, tasks);
  if (plan.kind === 'software_delivery_runtime_plan'
    && runtimes.some((runtime) => runtime.actor_type !== 'human' || runtime.execution_run_id)) {
    throw persistenceIntegrity('A human-only software delivery instance contains unsupported agent runtime state.');
  }
  return { plan, tasks };
}

async function verifyProcessRuntimeTaskDefinition(client, { tenantId, projectId, planId, revision, taskId, runtime }) {
  const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId, planId, revision });
  const tasks = verifyRuntimePlanTasks(plan, [runtime]);
  if (plan?.kind === 'software_delivery_runtime_plan') {
    const instanceRows = await client.query(`select * from orgward.process_task_instances
      where tenant_id=$1 and project_id=$2 and plan_instance_id=$3 order by task_id for share`,
    [tenantId, projectId, runtime.plan_instance_id]);
    const instanceTasks = verifyRuntimePlanTasks(plan, instanceRows.rows);
    verifyCompleteSoftwareRuntimeInstance(plan, instanceRows.rows, instanceTasks);
  }
  const task = tasks.get(taskId);
  if (plan.kind === 'software_delivery_runtime_plan'
    && (!task || task.assignee?.kind !== 'blueprint-actor' || task.assignee.actorId !== runtime.actor_id
      || task.assignee.roleId !== runtime.role_id || task.assignee.principal !== runtime.assigned_principal
      || task.assignee.membershipGeneration !== Number(runtime.assigned_membership_generation)
      || task.assignee.authzGeneration !== Number(runtime.assigned_authz_generation)
      || runtime.actor_type !== 'human' || runtime.execution_run_id)) {
    throw persistenceIntegrity('A human software runtime task no longer matches its immutable assignment snapshot.');
  }
  return { plan, task };
}

export async function lockProjectAccess(client, { tenantId, projectId, principal, minimum = 'reader' }) {
  if (!principal || !projectId) throw projectAccessDenied();
  const identity = await client.query(`
    select principal from orgward.oidc_principals
    where tenant_id = $1 and principal = $2 and status = 'active'
    for share
  `, [tenantId, principal]);
  if (!identity.rowCount) throw projectAccessDenied();
  const membership = await client.query(`
    select access, generation from orgward.project_memberships
    where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
    for share
  `, [tenantId, projectId, principal]);
  if (!membership.rowCount) throw projectAccessDenied();
  const access = membership.rows[0].access;
  if (minimum === 'editor' && !['owner', 'editor'].includes(access)) throw projectAccessDenied();
  if (minimum === 'owner' && access !== 'owner') throw projectAccessDenied();
  const project = await client.query(`
    select state, version, state_hash from orgward.aggregates
    where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
    for key share
  `, [tenantId, projectId]);
  if (!project.rowCount) throw projectAccessDenied();
  if (minimum !== 'reader') {
    const parent = verifyAggregateRow({ ...project.rows[0], aggregate_id: projectId, tenant_id: tenantId });
    if (parent.lifecycle?.status === 'archived') throw conflict('This workspace is archived and read-only. Its owner must restore it before making changes.', parent.version, 'PROJECT_ARCHIVED');
  }
  return { access, generation: Number(membership.rows[0].generation) };
}

async function verifyCurrentHumanSoftwareAssignments(client, { tenantId, projectId, project, plan }) {
  const blueprint = project.blueprintVersions?.find((entry) => entry.id === plan.source.blueprintId
    && entry.version === plan.source.blueprintVersion);
  const objects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const assignments = new Map();
  for (const task of plan.tasks) {
    const actor = byId.get(task.assignee?.actorId);
    const role = byId.get(task.assignee?.roleId);
    const linked = actor && role?.type === 'role' && ((actor.assignedRoles ?? []).includes(role.id)
      || (blueprint.relations ?? []).some((relation) => relation.source === actor.id
        && relation.target === role.id && relation.type === 'assigned-to'));
    if (actor?.type !== 'actor-human' || !linked) throw conflict(
      'Software delivery promotion supports only currently bound human checkpoint assignments.', null, 'SOFTWARE_AGENT_RUNTIME_UNSUPPORTED');
    const result = await client.query(`select b.status, b.target_principal, b.target_membership_generation,
        b.target_authz_generation, identity.actor_type, identity.status as identity_status,
        identity.display_name, identity.authz_generation as current_authz_generation, membership.access,
        membership.generation as current_membership_generation, membership.revoked_at
      from orgward.project_actor_binding_proposals b
      join orgward.oidc_principals identity on identity.tenant_id=b.tenant_id and identity.principal=b.target_principal
      join orgward.project_memberships membership on membership.tenant_id=b.tenant_id
        and membership.project_id=b.project_id and membership.principal=b.target_principal
      where b.tenant_id=$1 and b.project_id=$2 and b.blueprint_version=$3 and b.actor_id=$4 and b.role_id=$5
      for update of b, identity, membership`, [tenantId, projectId, plan.source.blueprintVersion, actor.id, role.id]);
    const matches = result.rows.filter((row) => row.status === 'enabled' && row.actor_type === 'human'
      && row.identity_status === 'active' && row.revoked_at === null && ['owner', 'editor'].includes(row.access)
      && Number(row.target_authz_generation) === Number(row.current_authz_generation)
      && Number(row.target_membership_generation) === Number(row.current_membership_generation)
      && row.target_principal === task.assignee?.principal
      && `${projectId}:${row.target_principal}` === task.assignee?.membershipId
      && Number(row.current_membership_generation) === Number(task.assignee?.membershipGeneration)
      && Number(row.current_authz_generation) === Number(task.assignee?.authzGeneration));
    const current = matches.length === 1 ? matches[0] : null;
    if (!current) throw conflict('A reviewed human assignment is no longer uniquely current. Review assignments again before continuing.', null, 'ACTOR_BINDING_STALE');
    assignments.set(task.id, { actor, role, principal: current.target_principal,
      membershipGeneration: Number(current.current_membership_generation), authzGeneration: Number(current.current_authz_generation) });
  }
  return assignments;
}

async function lockIdentityRows(client, tenantId, principals) {
  const keys = [...new Set(principals.filter((principal) => typeof principal === 'string' && principal))].sort();
  if (!keys.length) return new Map();
  const result = await client.query(`
    select principal, status, actor_type, roles, authz_generation
    from orgward.oidc_principals
    where tenant_id = $1 and principal = any($2::text[])
    order by principal
    for share
  `, [tenantId, keys]);
  return new Map(result.rows.map((row) => [row.principal, row]));
}

export async function requirePrincipalAuthority(client, {
  tenantId, principal, roles = [], anyRoleGroups = [], authzGeneration, actorType = null,
}) {
  const identity = await client.query(`
    select status, actor_type, roles, authz_generation from orgward.oidc_principals
    where tenant_id = $1 and principal = $2 for share
  `, [tenantId, principal]);
  if (!identity.rowCount || identity.rows[0].status !== 'active'
    || roles.some((role) => !identity.rows[0].roles.includes(role))
    || anyRoleGroups.some((group) => !group.some((role) => identity.rows[0].roles.includes(role)))) {
    const error = new Error('The identity no longer has the required authority for this operation.');
    Object.assign(error, { statusCode: 403, code: 'ACTION_FORBIDDEN', retryable: false });
    throw error;
  }
  if (actorType && identity.rows[0].actor_type !== actorType) {
    const error = new Error('Human identity is required for this approval.');
    Object.assign(error, { statusCode: 403, code: 'HUMAN_APPROVER_REQUIRED', retryable: false });
    throw error;
  }
  if (!Number.isSafeInteger(authzGeneration)
    || Number(identity.rows[0].authz_generation) !== authzGeneration) {
    throw conflict('The identity authority changed before this operation was saved.', null, 'AUTHORITY_GENERATION_STALE');
  }
}

function verifyPersistedOutputRecords(row) {
  const outcome = row.outcome ?? {};
  if (outcome.outputSchemaVersion === undefined) return;
  if (outcome.outputSchemaVersion !== 1 || !Array.isArray(outcome.outputRecords)) {
    throw persistenceIntegrity('The persisted human task output schema is unsupported or malformed.');
  }
  for (const record of outcome.outputRecords) {
    if (!record || record.schemaVersion !== 1 || record.tenantId !== row.tenant_id
      || record.projectId !== row.project_id || record.planId !== row.process_plan_id
      || Number(record.revision) !== Number(row.plan_revision) || record.planInstanceId !== row.plan_instance_id
      || record.taskId !== row.task_id || !['HUMAN_REPORTED', 'UNAVAILABLE'].includes(record.status)) {
      throw persistenceIntegrity('A persisted human task output has mismatched source provenance.');
    }
    const { recordHash, ...core } = record;
    if (!recordHash || recordHash !== contentHash(core)
      || (record.status === 'UNAVAILABLE' && Object.hasOwn(record, 'value'))
      || (record.status === 'HUMAN_REPORTED' && !Object.hasOwn(record, 'value'))) {
      throw persistenceIntegrity('A persisted human task output record failed its content hash.');
    }
  }
  const events = (row.events ?? []).filter((event) => event.type === 'HumanTaskCompleted'
    && event.data?.taskId === row.task_id && event.data?.planInstanceId === row.plan_instance_id);
  if (events.length !== 1 || events[0].data.outputSchemaVersion !== 1
    || contentHash(events[0].data.outputRecords ?? null) !== contentHash(outcome.outputRecords)) {
    throw persistenceIntegrity('The human task output records do not match their completion event.');
  }
  const { contentHash: eventHash, ...eventCore } = events[0];
  if (!eventHash || eventHash !== contentHash(eventCore)) throw persistenceIntegrity('The human task completion event failed its content hash.');
}

function processTaskRuntimeView(row, principal = null) {
  verifyPersistedOutputRecords(row);
  const events = Array.isArray(row.events) ? row.events.map((entry) => ({
    id: entry.id, type: entry.type, at: entry.at,
    actor: entry.type === 'HumanTaskEscalationResolved' ? 'project owner'
      : String(entry.type ?? '').startsWith('HumanTask') ? 'assigned human' : entry.actor,
    data: (() => {
      const data = entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data)
        ? structuredClone(entry.data) : {};
      delete data.fromPrincipal;
      delete data.toPrincipal;
      return data;
    })(),
  })) : [];
  const canResolveEscalation = Boolean(principal && row.can_resolve_escalation);
  return {
    ...(row.manual_flow_activation ? { activation: row.manual_flow_activation } : {}),
    projectId: row.project_id,
    processPlanId: row.process_plan_id,
    revision: Number(row.plan_revision),
    planInstanceId: row.plan_instance_id,
    taskId: row.task_id,
    blueprintId: row.blueprint_id,
    blueprintVersion: Number(row.blueprint_version),
    processId: row.process_id,
    actorId: row.actor_id,
    roleId: row.role_id,
    actorType: row.actor_type,
    status: row.status,
    executionRunId: row.execution_run_id,
    version: Number(row.version),
    outcome: structuredClone(row.outcome ?? {}),
    evidence: structuredClone(row.evidence ?? []),
    events,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedToCurrentPrincipal: Boolean(principal && row.assigned_to_current_principal),
    effectiveAssignmentOverridden: Boolean(row.has_effective_assignment_override),
    ...(row.can_view_effective_assignee && typeof row.effective_assignee_display_name === 'string'
      && row.effective_assignee_display_name.trim()
      ? { effectiveAssigneeDisplayName: row.effective_assignee_display_name.trim() } : {}),
    canResolveEscalation,
    canApplyHumanTaskOutput: Boolean(principal && row.can_apply_human_task_output),
    ...(canResolveEscalation && row.status === 'ESCALATED'
      ? { humanReassignmentCandidates: structuredClone(row.human_reassignment_candidates ?? []) } : {}),
    instanceControl: row.instance_control_status ? {
      status: row.instance_control_status,
      version: Number(row.instance_control_version),
      canControl: Boolean(row.can_control_instance),
      canRecover: Boolean(row.can_recover_instance),
      pauseReason: row.instance_control_pause_reason ?? null,
      pauseBoundary: structuredClone(row.instance_control_pause_boundary ?? {}),
      events: safeProcessTaskControlEvents(row.instance_control_events),
      canAbandonUnverified: Boolean(row.can_abandon_unverified),
      canCancel: Boolean(row.can_cancel_instance),
    } : null,
  };
}

function effectiveHumanAssignee(runtime) {
  return {
    principal: runtime.effective_assigned_principal ?? runtime.assigned_principal,
    membershipGeneration: Number(runtime.effective_assigned_membership_generation ?? runtime.assigned_membership_generation),
    authzGeneration: Number(runtime.effective_assigned_authz_generation ?? runtime.assigned_authz_generation),
  };
}

function validateHumanTaskNotes(evidence, { required = false } = {}) {
  if (!Array.isArray(evidence) || evidence.length > 20
    || evidence.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.trim().length > 1000)
    || (required && evidence.length === 0)) {
    throw conflict('Provide up to 20 short evidence notes; at least one is required for a succeeded or reassigned resolution.', null, 'INVALID_HUMAN_TASK_OUTCOME');
  }
  return evidence.map((entry) => entry.trim());
}

function validateReportedOutputValue(value, depth = 0) {
  if (depth > 4) throw conflict('A reported output is nested too deeply.', null, 'INVALID_HUMAN_TASK_OUTPUTS');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && value.length <= 1000) return;
  if (Array.isArray(value)) {
    if (value.length > 32) throw conflict('A reported output has too many list entries.', null, 'INVALID_HUMAN_TASK_OUTPUTS');
    value.forEach((entry) => validateReportedOutputValue(entry, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 32 || entries.some(([key]) => !key || key.length > 80)) {
      throw conflict('A reported output object is too large.', null, 'INVALID_HUMAN_TASK_OUTPUTS');
    }
    entries.forEach(([, entry]) => validateReportedOutputValue(entry, depth + 1));
    return;
  }
  throw conflict('A reported output must contain bounded JSON values.', null, 'INVALID_HUMAN_TASK_OUTPUTS');
}

async function normalizeHumanTaskOutputRecords(client, { tenantId, projectId, plan, task, runtime, principal, outputs, result }) {
  if (!Array.isArray(outputs ?? []) || (outputs ?? []).length > 20) {
    throw conflict('Provide at most 20 declared task outputs.', null, 'INVALID_HUMAN_TASK_OUTPUTS');
  }
  const supplied = outputs ?? [];
  if (supplied.length && result !== 'succeeded') {
    throw conflict('Outputs can only be reported for a succeeded human task.', null, 'INVALID_HUMAN_TASK_OUTPUTS');
  }
  const encoded = canonicalJson(supplied);
  if (Buffer.byteLength(encoded, 'utf8') > 16_384) {
    throw conflict('Reported task outputs exceed the 16 KB limit.', null, 'INVALID_HUMAN_TASK_OUTPUTS');
  }
  const projectRow = await client.query(`select * from orgward.aggregates
    where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, projectId]);
  if (!projectRow.rowCount) throw persistenceIntegrity('The pinned task project is unavailable.');
  const project = verifyAggregateRow(projectRow.rows[0]);
  const blueprint = project.blueprintVersions?.find((entry) => entry.id === plan.source?.blueprintId
    && Number(entry.version) === Number(plan.source?.blueprintVersion));
  if (!blueprint || blueprint.id !== runtime.blueprint_id || Number(blueprint.version) !== Number(runtime.blueprint_version)) {
    throw persistenceIntegrity('The task output blueprint snapshot is unavailable or mismatched.');
  }
  const blueprintObjects = new Map(Object.values(blueprint.areas ?? {}).flatMap((area) => area.items ?? []).map((object) => [object.id, object]));
  if ((task.outputs ?? []).length > 20) throw conflict('This task exceeds the supported typed-output count.', null, 'UNSUPPORTED_HUMAN_TASK_OUTPUTS');
  const declared = new Map((task.outputs ?? []).map((ref) => [ref.objectId ?? ref.id, ref]));
  if (declared.size !== (task.outputs ?? []).length || [...declared].some(([id, ref]) => {
    const object = blueprintObjects.get(id);
    return !object || object.type !== ref.type || !['information', 'decision'].includes(object.type);
  })) throw persistenceIntegrity('A declared process output does not match its pinned blueprint reference.');
  const submitted = new Map();
  for (const entry of supplied) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((key) => !['outputId', 'value'].includes(key))
      || typeof entry.outputId !== 'string' || !declared.has(entry.outputId) || !Object.hasOwn(entry, 'value')
      || submitted.has(entry.outputId)) {
      throw conflict('Each output must uniquely identify a declared saved output and contain only its value.', null, 'INVALID_HUMAN_TASK_OUTPUTS');
    }
    validateReportedOutputValue(entry.value);
    if (declared.get(entry.outputId).type === 'decision') {
      const value = entry.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some((key) => !['outcome', 'observations', 'reason'].includes(key))
        || typeof value.outcome !== 'string' || !value.outcome.trim() || value.outcome.length > 120
        || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000
        || !Array.isArray(value.observations) || value.observations.length > 20
        || value.observations.some((observation) => !observation || typeof observation !== 'object'
          || Array.isArray(observation) || Object.keys(observation).some((key) => !['informationId', 'value'].includes(key))
          || typeof observation.informationId !== 'string' || !Object.hasOwn(observation, 'value'))) {
        throw conflict('A decision output must report an outcome, observations, and reason.', null, 'INVALID_HUMAN_TASK_OUTPUTS');
      }
    }
    submitted.set(entry.outputId, entry.value);
  }
  const records = (task.outputs ?? []).map((ref) => {
    const outputId = ref.objectId ?? ref.id;
    const object = blueprintObjects.get(outputId);
    const core = {
      schemaVersion: 1, tenantId, outputId, outputType: ref.type,
      referenceHash: contentHash({ id: outputId, type: ref.type, definition: object }),
      status: submitted.has(outputId) ? 'HUMAN_REPORTED' : 'UNAVAILABLE',
      projectId, planId: plan.id, revision: Number(plan.revision), planInstanceId: runtime.plan_instance_id,
      taskId: task.id, sourceProcessId: task.sourceProcessId,
      planHash: contentHash(plan), taskHash: contentHash(task), sourceRuntimeVersion: Number(runtime.version),
      blueprintId: blueprint.id, blueprintVersion: Number(blueprint.version), blueprintHash: contentHash(blueprint),
      reporterPrincipal: principal, assignedPrincipal: effectiveHumanAssignee(runtime).principal,
      ...(submitted.has(outputId) ? { value: submitted.get(outputId) } : {}),
    };
    return { ...core, recordHash: contentHash(core) };
  });
  if (Buffer.byteLength(canonicalJson(records), 'utf8') > 32_768) {
    throw conflict('The normalized task output records exceed the 32 KB persistence limit.', null, 'INVALID_HUMAN_TASK_OUTPUTS');
  }
  return records;
}

function validateHumanTaskReason(reason) {
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) {
    throw conflict('Provide a short reason of up to 1000 characters.', null, 'INVALID_HUMAN_TASK_ESCALATION');
  }
  return reason.trim();
}

export async function hasVerifiedHumanTaskSuccess(client, runtime) {
  const outcome = runtime?.outcome;
  const evidence = runtime?.evidence;
  const assignee = effectiveHumanAssignee(runtime);
  if (runtime?.actor_type !== 'human' || outcome?.result !== 'succeeded'
    || !Array.isArray(evidence) || evidence.length === 0
    || evidence.some((entry) => typeof entry !== 'string' || !entry.trim())
    || !runtime.completed_at || !Array.isArray(runtime.events)) return false;

  const sameEvidence = (candidate) => contentHash(candidate) === contentHash(evidence);
  const sameTaskRef = (data) => data?.taskId === runtime.task_id
    && data.processPlanId === runtime.process_plan_id
    && Number(data.revision) === Number(runtime.plan_revision)
    && data.planInstanceId === runtime.plan_instance_id;
  const successfulEvents = runtime.events.filter((event) => {
    if (!sameTaskRef(event?.data) || !event.id || typeof event.actor !== 'string' || !event.actor) return false;
    const { contentHash: declaredContentHash, ...eventContent } = event;
    if (!declaredContentHash || contentHash(eventContent) !== declaredContentHash) return false;
    if (event.type === 'HumanTaskCompleted') {
      return event.actor === assignee.principal
        && event.data.result === 'succeeded' && Array.isArray(event.data.evidence)
        && sameEvidence(event.data.evidence)
        && sameEvidence(evidence);
    }
    if (event.type === 'HumanTaskEscalationResolved') {
      return event.data.disposition === 'succeeded'
        && typeof event.data.reason === 'string' && Boolean(event.data.reason.trim())
        && Array.isArray(event.data.evidence) && event.data.evidence.length > 0
        && sameEvidence(event.data.evidence) && sameEvidence(evidence);
    }
    return false;
  });
  if (successfulEvents.length !== 1) return false;

  const event = successfulEvents[0];
  const aggregateId = `${runtime.plan_instance_id}:${runtime.task_id}`;
  const audited = await client.query(`
    select 1 from orgward.audit_log
    where tenant_id=$1 and aggregate_kind='process_task_instance' and aggregate_id=$2
      and event_type=$3 and actor=$4 and event=$5::jsonb and event_hash=$6
  `, [runtime.tenant_id, aggregateId, event.type, event.actor,
    canonicalJson(event), contentHash(event)]);
  return audited.rowCount === 1;
}

async function verifiedManualFlowOutcome(client, plan, runtime) {
  const task = plan.tasks.find((task) => task.id === runtime.task_id);
  const result = runtime.outcome?.result;
  if (runtime.actor_type !== 'human' || !['succeeded', 'failed'].includes(result)
    || runtime.status !== (result === 'succeeded' ? 'SUCCEEDED' : 'FAILED') || !runtime.completed_at
    || !Array.isArray(runtime.evidence) || (result === 'succeeded' && !runtime.evidence.length)
    || runtime.evidence.some((note) => typeof note !== 'string' || !note.trim())) return { verified: false, result };
  let choice = null;
  if (task.flowRef.decisionId && result === 'succeeded') {
    try {
      const saved = runtime.outcome.decisionChoice;
      choice = normalizeHumanDecisionChoice(task, saved && { outcome: saved.outcome, observations: saved.observations, reason: saved.reason }, result);
      if (contentHash(choice) !== contentHash(saved)) return { verified: false, result };
    } catch { return { verified: false, result }; }
  } else if (runtime.outcome.decisionChoice) return { verified: false, result };
  const matches = (runtime.events ?? []).filter((event) => {
    const { contentHash: hash, ...core } = event;
    const data = event.data;
    return ['HumanTaskCompleted', 'HumanTaskEscalationResolved'].includes(event.type)
      && hash && hash === contentHash(core) && data?.taskId === runtime.task_id
      && Array.isArray(data.evidence)
      && data.processPlanId === runtime.process_plan_id && Number(data.revision) === Number(runtime.plan_revision)
      && data.planInstanceId === runtime.plan_instance_id && data.snapshotHash === plan.snapshotHash && data.flowHash === plan.flow.definitionHash && contentHash(data.evidence) === contentHash(runtime.evidence)
      && contentHash(data.decisionChoice ?? null) === contentHash(choice)
      && (event.type === 'HumanTaskCompleted' && data.result === result && event.actor === effectiveHumanAssignee(runtime).principal
        || event.type === 'HumanTaskEscalationResolved' && data.disposition === result && typeof data.reason === 'string' && data.reason.trim());
  });
  if (matches.length !== 1) return { verified: false, result };
  const event = matches[0];
  const audit = await client.query(`select 1 from orgward.audit_log where tenant_id=$1 and aggregate_kind='process_task_instance'
    and aggregate_id=$2 and event_type=$3 and actor=$4 and event=$5::jsonb and event_hash=$6`,
  [runtime.tenant_id, `${runtime.plan_instance_id}:${runtime.task_id}`, event.type, event.actor, canonicalJson(event), contentHash(event)]);
  return { verified: audit.rowCount === 1, result, ...(choice ? { decisionChoice: choice } : {}), eventHash: contentHash(event) };
}
function verifyAdvancedFlowRunRef(plan, runtime, run) {
  assertLinkedWorkloadRuntime(runtime, run);
  const requested = run.events?.find((event) => event.type === 'ExecutionRequested');
  const { contentHash: requestedHash, ...requestCore } = requested ?? {};
  if (!requestedHash || requestedHash !== contentHash(requestCore)
    || contentHash(requested.data?.processTaskRef?.flowBinding ?? null) !== contentHash(run.processTaskRef?.flowBinding ?? null)
    || contentHash(requested.data?.processTaskRef?.delegation ?? null) !== contentHash(run.processTaskRef?.delegation ?? null)) throw persistenceIntegrity('The agent flow or delegation binding differs from its saved request event.');
  if (run.processTaskRef.delegation
    && (run.workItem?.delegatedContext?.parentRunId !== run.processTaskRef.delegation.parentRunId
      || contentHash(run.workItem?.delegatedContext) !== run.processTaskRef.delegation.contextHash
      || run.workItem?.delegatedContext?.parentExecutionHash !== run.processTaskRef.delegation.parentExecutionHash)) {
    throw persistenceIntegrity('The delegated parent outcome differs from its immutable handoff reference.');
  }
  if (!run.processTaskRef.delegation && run.workItem?.delegatedContext) {
    throw persistenceIntegrity('A process task contains parent outcome data without a handoff reference.');
  }
  if (run.processTaskRef?.flowBinding?.snapshotHash !== plan.snapshotHash
    || run.processTaskRef.flowBinding.definitionHash !== plan.flow.definitionHash
    || !/^[a-f0-9]{64}$/.test(run.processTaskRef.flowBinding.activationIdentity ?? '')) throw persistenceIntegrity('The agent run does not match its pinned advanced flow identity.');
}
async function verifiedAdvancedAgentOutcome(client, plan, runtime) {
  const pending = { verified: false, result: null, status: runtime.status, version: Number(runtime.version),
    ...(runtime.status === 'CANCELLED' || runtime.status === 'INTERRUPTED' ? { reason: `${runtime.status === 'CANCELLED' ? 'Cancelled' : 'Interrupted'} agent work has no verified business outcome; no success or exception route is authorized.` } : {}) };
  if (!runtime.execution_run_id) return pending;
  const selected = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for share`, [runtime.tenant_id, runtime.execution_run_id]);
  if (!selected.rowCount) throw persistenceIntegrity('An advanced agent occurrence has no saved linked execution run.');
  const run = verifyAggregateRow(selected.rows[0]); verifyAdvancedFlowRunRef(plan, runtime, run);
  if (!['SUCCEEDED', 'FAILED'].includes(run.status) || !runtime.completed_at || !run.execution) return pending;
  const unresolved = await client.query(`select status from orgward.provider_dispatch_attempts where tenant_id=$1 and run_id=$2 and status in ('reserved','handed_off','outcome_unknown')`, [run.tenantId, run.id]);
  if (unresolved.rowCount) return { ...pending, reason: 'Provider outcome remains unresolved; no business result or exception route is verified.' };
  const type = run.status === 'SUCCEEDED' ? 'ExecutionSucceeded' : 'ExecutionFailed';
  const terminals = (run.events ?? []).filter((event) => event.type === type);
  if (terminals.length !== 1) return pending;
  const event = terminals[0]; const { contentHash: hash, ...core } = event;
  if (hash !== contentHash(core) || event.data?.executionHash !== contentHash(run.execution)) return pending;
  if (run.status === 'SUCCEEDED' && (run.execution.status !== 'COMPLETED'
    || !/^[a-f0-9]{64}$/.test(run.execution.evidenceHash ?? '') || event.data?.evidenceHash !== run.execution.evidenceHash)) return pending;
  if (run.status === 'FAILED' && run.execution.status !== 'FAILED') return pending;
  const runtimeEvents = (runtime.events ?? []).filter((entry) => entry.type === 'ProcessTaskRunStatusChanged'
    && entry.data?.runId === run.id && entry.data.status === run.status && Number.isSafeInteger(Number(entry.data.runVersion)) && Number(entry.data.runVersion) <= Number(run.version)
    && contentHash(entry.data.flowBinding ?? null) === contentHash(run.processTaskRef.flowBinding));
  if (runtimeEvents.length !== 1) return pending;
  const runtimeEvent = runtimeEvents[0]; const { contentHash: runtimeHash, ...runtimeCore } = runtimeEvent;
  if (runtimeHash !== contentHash(runtimeCore)) return pending;
  for (const [kind, id, auditedEvent] of [['execution_run', run.id, run.events.find((entry) => entry.type === 'ExecutionRequested')], ['execution_run', run.id, event], ['process_task_instance', `${runtime.plan_instance_id}:${runtime.task_id}`, runtimeEvent]]) {
    const audit = await client.query(`select aggregate_version from orgward.audit_log where tenant_id=$1 and aggregate_kind=$2 and aggregate_id=$3
      and event_type=$4 and actor=$5 and event=$6::jsonb and event_hash=$7`,
    [run.tenantId, kind, id, auditedEvent.type, auditedEvent.actor, canonicalJson(auditedEvent), contentHash(auditedEvent)]);
    if (audit.rowCount !== 1 || (auditedEvent === event && Number(audit.rows[0].aggregate_version) !== Number(runtimeEvent.data.runVersion))) return pending;
  }
  return { verified: true, result: run.status === 'SUCCEEDED' ? 'succeeded' : 'failed', runId: run.id,
    eventHash: contentHash(event), executionHash: contentHash(run.execution), runtimeEventHash: contentHash(runtimeEvent) };
}
async function requireAdvancedLinkedRunActivation(client, run, suppliedControl = null) {
  const ref = run.processTaskRef; if (!ref) return;
  const plan = await resolveRuntimeProcessPlan(client, { tenantId: run.tenantId, projectId: run.projectId, planId: ref.processPlanId, revision: ref.revision });
  if (plan?.kind !== 'manual_process_flow_plan') return;
  const rows = await client.query(`select * from orgward.process_task_instances where tenant_id=$1 and plan_instance_id=$2 order by task_id for share`, [run.tenantId, ref.planInstanceId]);
  const runtime = rows.rows.find((row) => row.task_id === ref.taskId);
  if (!runtime) throw persistenceIntegrity('The advanced agent run has no runtime occurrence.');
  // The saved run is still at its prior version during a state mutation; verify immutable linkage here.
  const stored = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for share`, [run.tenantId, run.id]);
  if (!stored.rowCount) throw persistenceIntegrity('The advanced agent run is missing.');
  const current = verifyAggregateRow(stored.rows[0]); verifyAdvancedFlowRunRef(plan, runtime, current);
  if (contentHash(current.processTaskRef) !== contentHash(run.processTaskRef)) throw persistenceIntegrity('The advanced agent linkage cannot change.');
  const binding = await client.query(`select b.status,b.target_principal,b.target_membership_generation,b.target_authz_generation,
    p.status as principal_status,p.actor_type,p.authz_generation,m.access,m.generation,m.revoked_at
    from orgward.project_actor_binding_proposals b
    join orgward.oidc_principals p on p.tenant_id=b.tenant_id and p.principal=b.target_principal
    join orgward.project_memberships m on m.tenant_id=b.tenant_id and m.project_id=b.project_id and m.principal=b.target_principal
    where b.tenant_id=$1 and b.project_id=$2 and b.blueprint_version=$3 and b.actor_id=$4 and b.role_id=$5 for share of b,p,m`,
  [run.tenantId, run.projectId, ref.blueprintVersion, ref.actorId, ref.roleId]);
  const actorBinding = binding.rows[0];
  if (binding.rowCount !== 1 || actorBinding.status !== 'enabled' || actorBinding.principal_status !== 'active'
    || actorBinding.actor_type !== 'workload' || actorBinding.revoked_at || !['owner','editor'].includes(actorBinding.access)
    || actorBinding.target_principal !== runtime.assigned_principal
    || Number(actorBinding.target_authz_generation) !== Number(actorBinding.authz_generation)
    || Number(actorBinding.target_membership_generation) !== Number(actorBinding.generation)
    || Number(runtime.assigned_authz_generation) !== Number(actorBinding.authz_generation)
    || Number(runtime.assigned_membership_generation) !== Number(actorBinding.generation)) throw conflict('The pinned agent identity, binding or project membership is no longer current.', run.version, 'PROCESS_TASK_ACTOR_BINDING_STALE');
  const control = suppliedControl ?? await lockProcessTaskControl(client, run.tenantId, ref.planInstanceId);
  requireActiveProcessTaskControl(control, run.version);
  await requireManualFlowTaskReady(client, plan, ref.taskId, rows.rows.filter((row) => row.task_id !== ref.taskId), control, ref.planInstanceId);
}
async function verifyManualFlowControl(client, plan, control, instanceId) {
  if (!control) return;
  if (control.project_id !== plan.source.projectId || control.process_plan_id !== plan.id
    || Number(control.plan_revision) !== Number(plan.revision) || control.plan_instance_id !== instanceId
    || !Array.isArray(control.events)) throw persistenceIntegrity('The manual flow control does not match its pinned instance.');
  if (!control.events.length) {
    if (control.status !== 'ACTIVE' || Number(control.version) !== 0 || control.pause_reason || contentHash(control.pause_boundary) !== contentHash({})) throw persistenceIntegrity('The initial manual flow control is invalid.');
    return;
  }
  const event = control.events.at(-1);
  if (!event || typeof event !== 'object' || !event.data || typeof event.data !== 'object'
    || !Object.hasOwn(event.data, 'reason') || !event.data.boundary || typeof event.data.boundary !== 'object'
    || Array.isArray(event.data.boundary)) throw persistenceIntegrity('The manual flow control event is missing its reason or boundary.');
  const { contentHash: hash, ...core } = event;
  if (hash !== contentHash(core) || event.data?.planInstanceId !== instanceId || event.data.resultingStatus !== control.status
    || event.data.reason !== control.pause_reason || contentHash(event.data.boundary) !== contentHash(control.pause_boundary)) throw persistenceIntegrity('The manual flow control differs from its saved event.');
  const audited = await client.query(`select 1 from orgward.audit_log where tenant_id=$1 and aggregate_kind='process_task_instance_control'
    and aggregate_id=$2 and event_type=$3 and actor=$4 and event=$5::jsonb and event_hash=$6`,
  [control.tenant_id, instanceId, event.type, event.actor, canonicalJson(event), contentHash(event)]);
  if (audited.rowCount !== 1) throw persistenceIntegrity('The manual flow control has no matching durable audit event.');
}
async function manualFlowActivation(client, plan, rows, control = null, instanceId = null) {
  verifyRuntimePlanTasks(plan, rows);
  if (rows.length && !control) throw persistenceIntegrity('The manual flow rows have no durable instance control.');
  await verifyManualFlowControl(client, plan, control, instanceId);
  const outcomes = new Map();
  for (const row of rows) outcomes.set(row.task_id, row.actor_type === 'workload' ? await verifiedAdvancedAgentOutcome(client, plan, row) : await verifiedManualFlowOutcome(client, plan, row));
  return projectManualFlowActivation(plan, outcomes, { planInstanceId: instanceId, control: control ? { status: control.status, version: Number(control.version), boundary: control.pause_boundary, eventsHash: contentHash(control.events) } : null });
}
async function requireManualFlowTaskReady(client, plan, taskId, rows, control, instanceId) {
  const activation = await manualFlowActivation(client, plan, rows, control, instanceId);
  const task = activation.tasks.find((task) => task.taskId === taskId);
  if (task?.state !== 'READY') throw conflict(task?.reason ?? 'The flow occurrence is not activated.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
  return activation;
}

async function selectProcessTaskRuntimeForPrincipal(client, {
  tenantId, projectId, planInstanceId, taskId, principal, authzGeneration, forUpdate = false,
}) {
  return client.query(`
    select r.*,
      (coalesce(r.effective_assigned_principal, r.assigned_principal) = $5 and assigned.status = 'active'
        and coalesce(r.effective_assigned_authz_generation, r.assigned_authz_generation) = assigned.authz_generation
        and coalesce(r.effective_assigned_membership_generation, r.assigned_membership_generation) = assigned_membership.generation
        and assigned_membership.revoked_at is null) as assigned_to_current_principal,
      (r.effective_assigned_principal is not null) as has_effective_assignment_override,
      assigned.display_name as effective_assignee_display_name,
      (caller.status = 'active' and caller.actor_type = 'human'
        and caller.authz_generation = $6 and caller.roles @> array['workspace-write']::text[]
        and caller_membership.access = 'owner' and caller_membership.revoked_at is null)
        as can_view_effective_assignee,
      (caller.status = 'active' and caller.actor_type = 'human'
        and caller.authz_generation = $6 and caller.roles @> array['workspace-write']::text[]
        and caller_membership.access = 'owner' and caller_membership.revoked_at is null)
        as can_resolve_escalation,
      case when r.status = 'ESCALATED' and r.actor_type = 'human'
        and caller.status = 'active' and caller.actor_type = 'human'
        and caller.authz_generation = $6 and caller.roles @> array['workspace-write']::text[]
        and caller_membership.access = 'owner' and caller_membership.revoked_at is null then (
          select coalesce(jsonb_agg(jsonb_build_object('principal', eligible.principal, 'displayName', eligible.display_name)
            order by eligible.display_name, eligible.principal), '[]'::jsonb)
          from orgward.project_memberships eligible_membership
          join orgward.oidc_principals eligible
            on eligible.tenant_id = eligible_membership.tenant_id and eligible.principal = eligible_membership.principal
          where eligible_membership.tenant_id = r.tenant_id and eligible_membership.project_id = r.project_id
            and eligible_membership.revoked_at is null and eligible_membership.access in ('owner','editor')
            and eligible.status = 'active' and eligible.actor_type = 'human'
            and eligible.roles @> array['workspace-write']::text[]
            and eligible.principal <> coalesce(r.effective_assigned_principal, r.assigned_principal)
        ) else '[]'::jsonb end as human_reassignment_candidates
    from orgward.process_task_instances r
    left join orgward.oidc_principals assigned
      on assigned.tenant_id = r.tenant_id and assigned.principal = coalesce(r.effective_assigned_principal, r.assigned_principal)
    left join orgward.project_memberships assigned_membership
      on assigned_membership.tenant_id = r.tenant_id and assigned_membership.project_id = r.project_id
        and assigned_membership.principal = coalesce(r.effective_assigned_principal, r.assigned_principal)
    left join orgward.oidc_principals caller
      on caller.tenant_id = r.tenant_id and caller.principal = $5
    left join orgward.project_memberships caller_membership
      on caller_membership.tenant_id = r.tenant_id and caller_membership.project_id = r.project_id
        and caller_membership.principal = $5
    where r.tenant_id = $1 and r.project_id = $2 and r.plan_instance_id = $3 and r.task_id = $4
    ${forUpdate ? 'for update of r' : ''}
  `, [tenantId, projectId, planInstanceId, taskId, principal, authzGeneration]);
}

function processTaskRuntimeEvent(type, actor, data, causationId = null) {
  const value = { id: `process-task-event-${randomUUID()}`, type, actor, at: new Date().toISOString(), data,
    ...(causationId ? { causationId } : {}) };
  return { ...value, contentHash: contentHash(value) };
}

function assertLinkedWorkloadRuntime(runtime, run) {
  const ref = run.processTaskRef;
  if (!ref || !runtime || runtime.project_id !== run.projectId
    || runtime.process_plan_id !== ref.processPlanId || Number(runtime.plan_revision) !== ref.revision
    || runtime.plan_instance_id !== ref.planInstanceId || runtime.task_id !== ref.taskId
    || runtime.blueprint_id !== ref.blueprintId || Number(runtime.blueprint_version) !== ref.blueprintVersion
    || runtime.actor_id !== ref.actorId || runtime.role_id !== ref.roleId
    || runtime.actor_type !== 'workload' || runtime.execution_run_id !== run.id
    || runtime.status !== run.status) {
    throw persistenceIntegrity('The canonical process task runtime does not match its linked run reference.');
  }
  return runtime;
}

function verifiedRepositoryCheckEvidence(run, ref, trace) {
  const candidate = run.execution?.repositoryCandidate;
  const selection = run.githubPatchSelection;
  const evidence = candidate?.candidateEvidence;
  if (!candidate?.checkPlan || !Array.isArray(candidate.checkReceipts) || !selection?.checkPlan
    || !Array.isArray(selection.checkPlan.requiredChecks) || !evidence
    || evidence.version !== 'github-candidate-evidence-v1' || evidence.hash !== run.execution?.evidenceHash
    || candidate.checkPlan.planHash !== selection.checkPlan.planHash
    || contentHash(candidate.checkPlan) !== contentHash(selection.checkPlan)) return null;
  const pinned = ref.repository;
  const expectedPinned = { id: `github-${selection.sourceSnapshot?.repositoryId}`, kind: 'github-app',
    snapshotId: selection.sourceSnapshot?.snapshotId, treeDigest: selection.repositoryTreeDigest,
    source: { type: 'github-app', ...selection.sourceSnapshot }, selectedFiles: selection.selectedFiles,
    verification: selection.verifier, checkPlan: selection.checkPlan,
    ...(Object.hasOwn(selection, 'buildPlan') ? { buildPlan: selection.buildPlan } : {}) };
  if (!selection.sourceSnapshot || !Array.isArray(selection.selectedFiles) || !selection.verifier
    || contentHash(pinned) !== contentHash(expectedPinned)
    || candidate.repositoryId !== pinned.id || candidate.snapshotId !== pinned.snapshotId
    || contentHash(candidate.source ?? null) !== contentHash(pinned.source)
    || candidate.sourceTreeDigest !== pinned.treeDigest
    || candidate.treeDigest !== candidate.checkReceipts[0]?.candidateTreeDigest
    || candidate.checkReceipts.length !== selection.checkPlan.requiredChecks.length) return null;
  const checks = candidate.checkReceipts.map(({ stdout, stderr, ...receipt }) => receipt);
  const checksValid = checks.every((receipt, index) => {
    const check = selection.checkPlan.requiredChecks[index];
    return check && receipt.checkId === check.id && receipt.checkVersion === check.version
      && receipt.commandHash === check.commandHash && receipt.planHash === selection.checkPlan.planHash
      && receipt.candidateTreeDigest === candidate.treeDigest
      && (receipt.status !== 'PASSED' || (receipt.candidateTreeDigestAfter === candidate.treeDigest
        && receipt.executionStatus === 'COMPLETED' && receipt.exitCode === 0));
  });
  if (!checksValid) return null;
  const diffMetadata = (candidate.changes ?? []).map(({ path, change, beforeMode, afterMode, beforeHash, afterHash }) => ({
    path, change, beforeMode, afterMode, beforeHash, afterHash,
  }));
  const verification = candidate.verification;
  const verifierReceipt = verification ? { id: verification.id, version: verification.version,
    profileHash: selection.verifier.profileHash, commandHash: verification.commandHash,
    treeDigest: verification.treeDigest, status: verification.status, exitCode: verification.exitCode,
    outputHash: verification.outputHash, stdoutTruncated: verification.stdoutTruncated,
    stderrTruncated: verification.stderrTruncated } : null;
  const receiptHash = contentHash({ version: 'github-candidate-evidence-v1', sourceSnapshot: pinned.source,
    sourceTreeDigest: candidate.sourceTreeDigest,
    selectedFileHashes: selection.selectedFiles.map(({ path, mode, size, contentHash: hash }) => ({ path, mode, size, contentHash: hash })),
    candidateTreeDigest: candidate.treeDigest, diffMetadata, verifierReceipt,
    checkPlan: selection.checkPlan, checkReceipts: checks,
    ...(Object.hasOwn(candidate, 'buildReceipt') ? { buildPlan: candidate.buildPlan, buildReceipt: candidate.buildReceipt } : {}) });
  const terminalEvents = (run.events ?? []).filter((event) => ['ExecutionSucceeded', 'ExecutionFailed'].includes(event.type));
  if (receiptHash !== evidence.hash || terminalEvents.length !== 1
    || terminalEvents[0].data?.candidateEvidenceHash !== evidence.hash
    || terminalEvents[0].data?.evidenceHash !== evidence.hash
    || trace.source.projectId !== run.projectId) return null;
  return checks.map((receipt) => ({ category: 'REPOSITORY_CHECK', id: receipt.checkId,
    version: receipt.checkVersion, status: receipt.status, commandHash: receipt.commandHash,
    planHash: receipt.planHash, repositoryId: candidate.repositoryId, sourceSnapshotId: candidate.snapshotId,
    sourceCommitOid: pinned.source.commitOid ?? null, sourceTreeDigest: candidate.sourceTreeDigest,
    candidateTreeDigest: candidate.treeDigest, candidateEvidenceHash: evidence.hash,
    outputHash: receipt.outputHash }));
}

export function behaviorEvaluationVersionFields(behaviorPlan, scenarioMappings = [], persistedSchemaVersion = null) {
  const defaultVersion = behaviorPlan?.schemaVersion >= 4 ? 2 : 1;
  const schemaVersion = persistedSchemaVersion ?? defaultVersion;
  const supported = behaviorPlan?.schemaVersion >= 4 ? [1, 2] : [1];
  if (!supported.includes(schemaVersion)) return null;
  return { schemaVersion,
    ...(schemaVersion === 2 ? { scenarioMappings } : {}) };
}

function evaluateAuthorizedBehaviorPlan(run, behaviorPlan, trace, persistedSchemaVersion = null) {
  const selected = run.processTaskRef?.behaviorTestPlan;
  if (!selected || selected.caseId !== behaviorPlan.caseId || selected.planId !== behaviorPlan.id
    || selected.planHash !== behaviorPlan.planHash || selected.requirementId !== behaviorPlan.requirementId
    || selected.requirementHash !== behaviorPlan.requirementHash || selected.draftRevision !== behaviorPlan.draftRevision
    || selected.traceHash !== behaviorPlan.traceHash || selected.createdAt !== behaviorPlan.createdAt
    || selected.checkPlanHash !== behaviorPlan.checkPlan?.hash
    || selected.criterionContractVersion !== behaviorPlan.criterionContractVersion
    || selected.criterionContractHash !== behaviorPlan.criterionContractHash
    || selected.fileMappingsHash !== contentHash(behaviorPlan.fileMappings)
    || contentHash(selected.fileMappings) !== contentHash(behaviorPlan.fileMappings)
    || contentHash(run.processTaskRef?.repository ?? null) !== contentHash(behaviorPlan.repository)) return null;
  const repositorySelection = run.githubPatchSelection;
  if (!repositorySelection || repositorySelection.sourceSnapshot?.snapshotId !== behaviorPlan.repository.source?.snapshotId
    || repositorySelection.repositoryTreeDigest !== behaviorPlan.repository.treeDigest
    || contentHash(repositorySelection.selectedFiles) !== contentHash(behaviorPlan.repository.selectedFiles)
    || contentHash(repositorySelection.checkPlan) !== contentHash(behaviorPlan.repository.checkPlan)) return null;
  const requested = (run.events ?? []).filter((event) => event.type === 'ExecutionRequested');
  if (requested.length !== 1 || requested[0].timestamp <= behaviorPlan.createdAt) return null;
  const terminal = (run.events ?? []).filter((event) => ['ExecutionSucceeded', 'ExecutionFailed'].includes(event.type));
  if (terminal.length !== 1) return null;
  const checkEvidence = verifiedRepositoryCheckEvidence(run, run.processTaskRef, trace);
  const candidate = run.execution?.repositoryCandidate;
  if (!candidate || !candidateChangesCoveredByPathMap(behaviorPlan.fileMappings, candidate.changes ?? [])) return null;
  const checkReceipts = candidate?.checkReceipts;
  const mappingAwareEvaluation = behaviorPlan.schemaVersion >= 4;
  const evaluationFields = behaviorEvaluationVersionFields(behaviorPlan, [], persistedSchemaVersion);
  if (!evaluationFields) return null;
  const unknownAssertions = (reason) => behaviorPlan.assertions.map((assertion) => ({ id: assertion.id,
    testName: assertion.testName, criterionIndex: assertion.criterionIndex, status: 'UNKNOWN', reason }));
  if (!checkEvidence || !Array.isArray(checkReceipts) || !checkReceipts.length) {
    return { ...behaviorEvaluationVersionFields(behaviorPlan, deriveScenarioMappingEvidence({ plan: behaviorPlan, assertionResults: [], candidate,
      checkEvidenceVerified: false }), persistedSchemaVersion), status: 'NOT_EXECUTED', scope: 'NOT_EXECUTED', result: 'UNKNOWN',
      assertions: unknownAssertions('CHECK_RECEIPT_UNAVAILABLE'), planId: behaviorPlan.id, planHash: behaviorPlan.planHash,
      terminalEventHash: contentHash(terminal[0]), candidateEvidenceHash: candidate?.candidateEvidence?.hash ?? null,
      businessTruthStatus: 'UNVERIFIED', reason: 'The selected run has no verifiable per-assertion repository-check receipt.' };
  }
  const check = behaviorPlan.assertions[0].check;
  const receipt = checkReceipts.find((entry) => entry.checkId === check.id);
  if (!receipt || checkReceipts.filter((entry) => entry.checkId === check.id).length !== 1) return null;
  const results = parseNodeTestAssertions(receipt.stdout ?? '', behaviorPlan, receipt);
  if (!results) return null;
  const assertions = results.map((result) => ({ ...result,
    criterionIndex: behaviorPlan.assertions.find((entry) => entry.id === result.id).criterionIndex }));
  const scenarioMappings = mappingAwareEvaluation && evaluationFields.schemaVersion === 2 ? deriveScenarioMappingEvidence({ plan: behaviorPlan, assertionResults: assertions,
    candidate: { ...candidate, sourceSnapshotId: candidate.snapshotId }, checkEvidenceVerified: true }) : null;
  const statuses = assertions.map((entry) => entry.status);
  const result = statuses.includes('TEST_FAIL') ? 'TEST_FAIL'
    : statuses.length && statuses.every((status) => status === 'TEST_PASS') ? 'TEST_PASS' : 'UNKNOWN';
  const riskCoverage = behaviorPlan.assertions.every((assertion) => assertion.risk?.status === 'LINKED') ? 'LINKED' : 'UNKNOWN';
  // Reaching this point means a verified, completed check receipt was parsed.
  // An absent/skipped planned assertion is still an evaluated candidate and
  // must be rejected by the admission guard rather than downgraded to
  // NOT_EXECUTED.
  const executed = true;
  return { ...behaviorEvaluationVersionFields(behaviorPlan, scenarioMappings ?? [], persistedSchemaVersion), status: executed ? 'CHECKED_BEHAVIOR' : 'NOT_EXECUTED',
    scope: executed ? 'CHECKED_BEHAVIOR' : 'NOT_EXECUTED', result: riskCoverage === 'LINKED' ? result : 'UNKNOWN',
    assertionResult: result, riskCoverage, assertions,
    planId: behaviorPlan.id, planHash: behaviorPlan.planHash,
    checkId: receipt.checkId, checkVersion: receipt.checkVersion, commandHash: receipt.commandHash,
    checkPlanHash: receipt.planHash, candidateTreeDigest: receipt.candidateTreeDigest,
    candidateEvidenceHash: candidate?.candidateEvidence?.hash ?? null,
    outputHash: receipt.outputHash, terminalEventHash: contentHash(terminal[0]),
    businessTruthStatus: 'UNVERIFIED',
    reason: 'Per-assertion code checks are scoped evidence; they do not establish real-world business truth.' };
}

async function syncProcessTaskRuntimeFromRun(client, run, { commandId = null } = {}) {
  const ref = run.processTaskRef;
  if (!ref) return;
  const selected = await client.query(`
    select * from orgward.process_task_instances
    where tenant_id = $1 and plan_instance_id = $2 and task_id = $3
    for update
  `, [run.tenantId, ref.planInstanceId, ref.taskId]);
  if (!selected.rowCount) throw persistenceIntegrity('A linked execution run has no canonical process task instance.');
  const current = selected.rows[0];
  if (current.project_id !== run.projectId || current.process_plan_id !== ref.processPlanId
    || Number(current.plan_revision) !== ref.revision || current.blueprint_id !== ref.blueprintId
    || Number(current.blueprint_version) !== ref.blueprintVersion || current.actor_id !== ref.actorId
    || current.role_id !== ref.roleId || current.actor_type !== 'workload'
    || current.execution_run_id && current.execution_run_id !== run.id) {
    throw persistenceIntegrity('A process task runtime does not match its immutable execution run reference.');
  }
  if (current.status === run.status && current.execution_run_id === run.id) return;
  const runtimeEvent = processTaskRuntimeEvent('ProcessTaskRunStatusChanged', 'execution run', {
    runId: run.id, status: run.status, runVersion: run.version,
    ...(ref.flowBinding ? { flowBinding: structuredClone(ref.flowBinding) } : {}),
  }, commandId);
  const terminal = ['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(run.status);
  await client.query(`
    update orgward.process_task_instances
    set status = $4,
      execution_run_id = $5,
      version = version + 1,
      started_at = case when $4 = 'PAUSED' then null when $4 in ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED') then coalesce(started_at, $6::timestamptz) else started_at end,
      completed_at = case when $7 then $6::timestamptz else null end,
      updated_at = $6::timestamptz,
      events = events || $8::jsonb
    where tenant_id = $1 and plan_instance_id = $2 and task_id = $3
  `, [run.tenantId, ref.planInstanceId, ref.taskId, run.status, run.id, run.updatedAt, terminal, canonicalJson([runtimeEvent])]);
  await recordEvent(client, {
    tenantId: run.tenantId, kind: 'process_task_instance', id: `${ref.planInstanceId}:${ref.taskId}`,
    version: Number(current.version) + 1, commandId, event: runtimeEvent,
  });
}

function processTaskControlEvent(type, actor, planInstanceId, resultingStatus, commandId, data = {}) {
  const value = { id: `process-control-event-${randomUUID()}`, type, actor, at: new Date().toISOString(),
    causationId: commandId, data: { planInstanceId, resultingStatus, ...data } };
  return { ...value, contentHash: contentHash(value) };
}

async function lockProcessTaskControl(client, tenantId, planInstanceId) {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `${tenantId}:process-plan-instance:${planInstanceId}`,
  ]);
  const selected = await client.query(`select * from orgward.process_task_instance_controls
    where tenant_id=$1 and plan_instance_id=$2 for update`, [tenantId, planInstanceId]);
  return selected.rows[0] ?? null;
}

async function lockLinkedRunControl(client, tenantId, runId) {
  const hint = await client.query(`select state->'processTaskRef' as ref from orgward.aggregates
    where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, runId]);
  const planInstanceId = hint.rows[0]?.ref?.planInstanceId;
  return planInstanceId ? lockProcessTaskControl(client, tenantId, planInstanceId) : null;
}

function requireActiveProcessTaskControl(control, version = null) {
  requireProcessTaskControlNotAbandoned(control, version);
  if (!control || control.status !== 'ACTIVE') {
    throw conflict('This process instance is paused or pausing; no new task work can start.', version, 'PROCESS_INSTANCE_PAUSED');
  }
}

function requireProcessTaskControlNotAbandoned(control, version = null) {
  if (control?.status === 'ABANDONED_UNVERIFIED') {
    throw conflict('This process instance was closed with an unverified provider outcome and is terminal.',
      version ?? Number(control.version), 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
  }
  if (control?.status === 'CANCELLED') {
    throw conflict('This process instance was cancelled and is terminal.',
      version ?? Number(control.version), 'PROCESS_INSTANCE_CANCELLED');
  }
}

async function appendProcessTaskControl(client, control, { status, reason, boundary, actor, commandId, eventType, eventData = {} }) {
  const event = processTaskControlEvent(eventType, actor, control.plan_instance_id, status, commandId, {
    priorStatus: control.status, reason: reason ?? null, boundary: boundary ?? control.pause_boundary, ...eventData,
  });
  const updated = await client.query(`update orgward.process_task_instance_controls
    set status=$3,pause_reason=$4,pause_boundary=$5::jsonb,version=version+1,updated_at=now(),events=events || $6::jsonb
    where tenant_id=$1 and plan_instance_id=$2 and version=$7 returning *`,
  [control.tenant_id, control.plan_instance_id, status, reason ?? null, canonicalJson(boundary ?? control.pause_boundary),
    canonicalJson([event]), Number(control.version)]);
  if (!updated.rowCount) throw conflict('The process instance control changed concurrently.', Number(control.version), 'PROCESS_INSTANCE_CONTROL_CONFLICT');
  await recordEvent(client, { tenantId: control.tenant_id, kind: 'process_task_instance_control',
    id: control.plan_instance_id, version: Number(updated.rows[0].version), commandId, event });
  return updated.rows[0];
}

async function settleProcessTaskPauseIfDrained(client, tenantId, planInstanceId) {
  const controlResult = await client.query(`select * from orgward.process_task_instance_controls
    where tenant_id=$1 and plan_instance_id=$2 for update`, [tenantId, planInstanceId]);
  const control = controlResult.rows[0];
  if (!control || control.status !== 'PAUSE_REQUESTED') return control;
  const active = await client.query(`select 1 from orgward.process_task_instances r
    where r.tenant_id=$1 and r.plan_instance_id=$2 and r.status in ('IN_PROGRESS','ESCALATED','RUNNING') limit 1`, [tenantId, planInstanceId]);
  const lease = await client.query(`select 1 from orgward.execution_worker_leases l
    join orgward.aggregates a on a.tenant_id=l.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=l.run_id
    where l.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2 and l.lease_until>now() limit 1`, [tenantId, planInstanceId]);
  const unresolved = await client.query(`select 1 from orgward.provider_dispatch_attempts d
    join orgward.aggregates a on a.tenant_id=d.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
    where d.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2
      and d.status in ('handed_off','outcome_unknown') limit 1`, [tenantId, planInstanceId]);
  if (active.rowCount || lease.rowCount || unresolved.rowCount) return control;
  const priorPause = (control.events ?? []).findLast?.((entry) => entry.type === 'ProcessTaskInstancePauseRequested');
  const commandId = priorPause?.causationId;
  if (!commandId) throw persistenceIntegrity('A pausing process instance has no durable pause command event.');
  return appendProcessTaskControl(client, control, {
    status: 'PAUSED', reason: control.pause_reason, boundary: control.pause_boundary,
    actor: priorPause.actor ?? control.initiated_by ?? 'system', commandId,
    eventType: 'ProcessTaskInstancePaused',
  });
}

async function requestExecutionLeaseCancellation(client, { tenantId, projectId = null, principal, reason }) {
  if (!principal) return;
  await client.query(`
    update orgward.execution_worker_leases
    set cancel_requested_at = coalesce(cancel_requested_at, now()),
      cancel_reason = coalesce(cancel_reason, $4), updated_at = now()
    where tenant_id = $1
      and ($3::text is null or project_id = $3)
      and lease_until > now() and cancel_requested_at is null
       and (
         principal = $2 or exists (
           select 1 from orgward.aggregates a
           where a.tenant_id = orgward.execution_worker_leases.tenant_id
             and a.aggregate_kind = 'execution_run'
             and a.aggregate_id = orgward.execution_worker_leases.run_id
             and a.state #>> '{approval,principal}' = $2
         )
       )
  `, [tenantId, principal, projectId, reason]);
}

function rowValues(state, kind) {
  if (!IDENTIFIERS[kind]?.test(state?.id ?? '') || !state?.tenantId || !Number.isInteger(state.version) || state.version < 0) {
    throw persistenceIntegrity('Aggregate identity, tenant, or version is invalid.');
  }
  return [state.tenantId, kind, state.id, state.version, canonicalJson(state), contentHash(state), state.updatedAt ?? new Date().toISOString()];
}

async function insertAggregate(client, state, kind) {
  await client.query(`
    insert into orgward.aggregates
      (tenant_id, aggregate_kind, aggregate_id, version, state, state_hash, updated_at)
    values ($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz)
  `, rowValues(state, kind));
}

async function updateAggregate(client, state, kind, expectedVersion) {
  const values = rowValues(state, kind);
  const result = await client.query(`
    update orgward.aggregates
    set version = $4, state = $5::jsonb, state_hash = $6, updated_at = $7::timestamptz
    where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3 and version = $8
  `, [...values, expectedVersion]);
  if (result.rowCount !== 1) throw conflict(`Version conflict: expected persisted version ${expectedVersion}. Reload before retrying.`);
}

class PostgresDocumentStore {
  constructor(persistence, kind) {
    this.persistence = persistence;
    this.kind = kind;
  }

  async init() { await this.persistence.init(); }

  async get(id, tenantId = null) {
    if (!tenantId) throw new Error('Tenant context is required for aggregate reads.');
    const result = await this.persistence.query(
      'select * from orgward.aggregates where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3',
      [tenantId, this.kind, id],
    );
    return result.rowCount ? verifyAggregateRow(result.rows[0]) : null;
  }

  async getForPrincipal(id, tenantId, principal) {
    if (!tenantId || !principal) return null;
    const result = await this.persistence.query(`
      select a.*, s.project_id as scoped_project_id
      from orgward.aggregates a
      join orgward.aggregate_project_scopes s
        on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
      join orgward.project_memberships m
        on m.tenant_id = s.tenant_id and m.project_id = s.project_id and m.principal = $3
      join orgward.oidc_principals p
        on p.tenant_id = m.tenant_id and p.principal = m.principal and p.status = 'active'
      where a.tenant_id = $1 and a.aggregate_kind = $2 and a.aggregate_id = $4
        and m.revoked_at is null
    `, [tenantId, this.kind, principal, id]);
    if (!result.rowCount) return null;
    const state = verifyAggregateRow(result.rows[0]);
    if (Object.hasOwn(state, 'projectId') && state.projectId !== result.rows[0].scoped_project_id) throw persistenceIntegrity('Aggregate project scope does not match aggregate state.');
    state.projectId = result.rows[0].scoped_project_id;
    return state;
  }

  async withPrincipalAuthority({
    id, tenantId, principal, minimumProjectAccess = 'reader',
    requiredPrincipalRoles = [], anyPrincipalRoleGroups = [], authzGeneration,
    verifyProcessEvidenceReviews = false, verifyProcessBehaviorTestPlans = false,
    verifyProcessBehaviorEvaluations = false, verifyRepositoryCheckObservations = false,
    verifyProcessIntentEvaluationAcceptances = false, verifyProcessBehaviorScenarioExecutions = false,
    verifyProcessBehaviorProductHarnessMappings = false,
    verifyT91N2AuthorizationExecutions = false, operation,
  }) {
    if (!id || !tenantId || !principal || typeof operation !== 'function') return null;
    return this.persistence.transaction(async (client) => {
      const scope = await client.query(`
        select project_id from orgward.aggregate_project_scopes
        where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
        for key share
      `, [tenantId, this.kind, id]);
      if (!scope.rowCount) return null;
      const projectId = scope.rows[0].project_id;
      let membershipAuthority;
      try { membershipAuthority = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: minimumProjectAccess }); }
      catch (error) {
        if (['ACTION_FORBIDDEN', 'PROJECT_NOT_FOUND'].includes(error.code)) return null;
        throw error;
      }
      if (requiredPrincipalRoles.length || anyPrincipalRoleGroups.length) {
        await requirePrincipalAuthority(client, {
          tenantId, principal, roles: requiredPrincipalRoles,
          anyRoleGroups: anyPrincipalRoleGroups, authzGeneration,
          actorType: requiresHumanApprover(requiredPrincipalRoles) ? 'human' : null,
        });
      }
      const selected = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
        for share
      `, [tenantId, this.kind, id]);
      if (!selected.rowCount) return null;
      const state = verifyAggregateRow(selected.rows[0]);
      if (Object.hasOwn(state, 'projectId') && state.projectId !== projectId) {
        throw persistenceIntegrity('Aggregate project scope does not match aggregate state.');
      }
      state.projectId = projectId;
      if (verifyProcessEvidenceReviews && this.kind === 'change_case' && typeof this.verifyProcessEvidenceReviews === 'function') {
        await this.verifyProcessEvidenceReviews(state, client);
      }
      if (verifyProcessBehaviorTestPlans && this.kind === 'change_case' && typeof this.verifyProcessBehaviorTestPlans === 'function') {
        await this.verifyProcessBehaviorTestPlans(state, client);
      }
      if (verifyProcessBehaviorEvaluations && this.kind === 'change_case' && typeof this.verifyProcessBehaviorEvaluations === 'function') {
        await this.verifyProcessBehaviorEvaluations(state, client);
      }
      if (verifyRepositoryCheckObservations && this.kind === 'change_case' && typeof this.verifyRepositoryCheckObservations === 'function') {
        await this.verifyRepositoryCheckObservations(state, client);
      }
      if (verifyProcessIntentEvaluationAcceptances && this.kind === 'change_case'
        && typeof this.verifyProcessIntentEvaluationAcceptances === 'function') {
        await this.verifyProcessIntentEvaluationAcceptances(state, client);
      }
      if (verifyProcessBehaviorScenarioExecutions && this.kind === 'change_case'
        && typeof this.verifyProcessBehaviorScenarioExecutions === 'function') {
        await this.verifyProcessBehaviorScenarioExecutions(state, client);
      }
      if (verifyProcessBehaviorProductHarnessMappings && this.kind === 'change_case'
        && typeof this.verifyProcessBehaviorProductHarnessMappings === 'function') {
        await this.verifyProcessBehaviorProductHarnessMappings(state, client);
      }
      if (verifyT91N2AuthorizationExecutions && this.kind === 'change_case'
        && typeof this.verifyT91N2AuthorizationExecutions === 'function') {
        const verified = await this.verifyT91N2AuthorizationExecutions(state, client);
        state.artifacts ??= {};
        state.artifacts.processBehaviorProductHarnessExecutionIntegrity = verified.receipts;
      }
      return operation(state, { projectId, ...membershipAuthority });
    });
  }

  async listWithDiagnosticsForPrincipal(tenantId, principal) {
    const result = await this.persistence.query(`
      select a.*, s.project_id as scoped_project_id
      from orgward.aggregates a
      join orgward.aggregate_project_scopes s
        on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
      join orgward.project_memberships m
        on m.tenant_id = s.tenant_id and m.project_id = s.project_id and m.principal = $2
      join orgward.oidc_principals p
        on p.tenant_id = m.tenant_id and p.principal = m.principal and p.status = 'active'
      where a.tenant_id = $1 and a.aggregate_kind = $3 and m.revoked_at is null
      order by a.updated_at desc, a.aggregate_id
    `, [tenantId, principal, this.kind]);
    const records = [];
    let corruptRecords = 0;
    for (const row of result.rows) {
      try {
        const state = verifyAggregateRow(row);
        if (Object.hasOwn(state, 'projectId') && state.projectId !== row.scoped_project_id) throw persistenceIntegrity('Aggregate project scope does not match aggregate state.');
        state.projectId = row.scoped_project_id;
        records.push(state);
      } catch { corruptRecords += 1; }
    }
    return { records, corruptRecords };
  }

  async listWithPrincipalAuthority({
    tenantId, principal, anyPrincipalRoleGroups = [], authzGeneration, operation,
  }) {
    if (!tenantId || !principal || typeof operation !== 'function') return null;
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: anyPrincipalRoleGroups, authzGeneration,
      });
      const result = await client.query(`
        select a.*, s.project_id as scoped_project_id
        from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        join orgward.project_memberships m
          on m.tenant_id = s.tenant_id and m.project_id = s.project_id and m.principal = $2
        where a.tenant_id = $1 and a.aggregate_kind = $3 and m.revoked_at is null
        order by a.updated_at desc, a.aggregate_id
        for share of a, m
      `, [tenantId, principal, this.kind]);
      const records = [];
      let corruptRecords = 0;
      for (const row of result.rows) {
        try {
          const state = verifyAggregateRow(row);
          if (Object.hasOwn(state, 'projectId') && state.projectId !== row.scoped_project_id) {
            throw persistenceIntegrity('Aggregate project scope does not match aggregate state.');
          }
          state.projectId = row.scoped_project_id;
          records.push(state);
        } catch { corruptRecords += 1; }
      }
      return operation({ records, corruptRecords });
    });
  }

  async listForPrincipal(tenantId, principal) {
    return (await this.listWithDiagnosticsForPrincipal(tenantId, principal)).records;
  }

  async list(tenantId) { return (await this.listWithDiagnostics(tenantId)).records; }

  async listWithDiagnostics(tenantId) {
    const result = await this.persistence.query(`
      select * from orgward.aggregates
      where tenant_id = $1 and aggregate_kind = $2
      order by updated_at desc, aggregate_id
    `, [tenantId, this.kind]);
    const records = [];
    let corruptRecords = 0;
    for (const row of result.rows) {
      try { records.push(verifyAggregateRow(row)); }
      catch { corruptRecords += 1; }
    }
    return { records, corruptRecords };
  }

  async all() {
    const result = await this.persistence.query('select * from orgward.aggregates where aggregate_kind = $1 order by aggregate_id', [this.kind]);
    return result.rows.map(verifyAggregateRow);
  }

  async save(state, { expectedVersion = null, principal = null, requiredPrincipalRoles = null, authzGeneration = null, validateCurrent = null } = {}) {
    return this.persistence.transaction((client) => this.saveInTransaction(client, state, {
      expectedVersion, principal, requiredPrincipalRoles, authzGeneration, validateCurrent,
    }));
  }

  async saveInTransaction(client, state, {
    expectedVersion = null, principal = null, requiredPrincipalRoles = null,
    authzGeneration = null, workerFinalization = false, instanceControlMutation = false,
    validateCurrent = null, runtimeCommandId = null,
  } = {}) {
      let membershipAuthority = null;
      if (this.kind !== 'project' && principal) {
        membershipAuthority = await lockProjectAccess(client, { tenantId: state.tenantId, projectId: state.projectId, principal, minimum: 'editor' });
      }
      if (this.kind !== 'project' && state.projectId) {
        const parentProject = await client.query(`select * from orgward.aggregates
          where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [state.tenantId, state.projectId]);
        if (!parentProject.rowCount) throw projectAccessDenied();
        const parentState = verifyAggregateRow(parentProject.rows[0]);
        if (parentState.lifecycle?.status === 'archived') throw conflict('This workspace is archived and read-only. Its owner must restore it before making changes.', parentState.version, 'PROJECT_ARCHIVED');
      }
      if (requiredPrincipalRoles) {
        if (!principal || !Array.isArray(requiredPrincipalRoles) || !requiredPrincipalRoles.length) throw projectAccessDenied();
        await requirePrincipalAuthority(client, {
          tenantId: state.tenantId, principal, roles: requiredPrincipalRoles, authzGeneration,
          actorType: requiresHumanApprover(requiredPrincipalRoles) ? 'human' : null,
        });
      }
      if (this.kind === 'execution_run' && state.processTaskRef && expectedVersion !== null) {
        await client.query(`select aggregate_id from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [state.tenantId, state.projectId]);
        const control = await lockProcessTaskControl(client, state.tenantId, state.processTaskRef.planInstanceId);
        if (!control) throw persistenceIntegrity('A linked process task has no durable instance control record.');
        if (workerFinalization && ['ABANDONED_UNVERIFIED', 'CANCELLED'].includes(control.status)) {
          throw conflict('A late worker result cannot advance a terminal process instance.', state.version,
            control.status === 'CANCELLED' ? 'PROCESS_INSTANCE_CANCELLED' : 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
        }
        if (!instanceControlMutation && ['AWAITING_APPROVAL', 'APPROVED', 'RUNNING'].includes(state.status)) {
          requireActiveProcessTaskControl(control, state.version);
          await requireAdvancedLinkedRunActivation(client, state, control);
        }
      }
      if (this.kind === 'execution_run' && principal && requiredPrincipalRoles?.includes('execution-approver')) {
        if (state.approval?.principal !== principal || !membershipAuthority?.generation) {
          throw persistenceIntegrity('An execution approval must bind the authenticated project membership.');
        }
        state.approval.projectMembershipGeneration = membershipAuthority.generation;
      }
      let currentProjectId = null;
      if (this.kind !== 'project' && expectedVersion !== null) {
        const scope = await client.query(`
          select project_id from orgward.aggregate_project_scopes
          where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
          for key share
        `, [state.tenantId, this.kind, state.id]);
        currentProjectId = scope.rows[0]?.project_id ?? null;
        if (currentProjectId !== (state.projectId ?? null)) {
          throw conflict('The aggregate project scope cannot be changed by this command.', null, 'PROJECT_SCOPE_CONFLICT');
        }
      }
      const existing = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
        for update
      `, [state.tenantId, this.kind, state.id]);
      if (this.kind === 'execution_run' && state.processTaskRef && existing.rowCount) {
        const control = await client.query(`select status from orgward.process_task_instance_controls
          where tenant_id=$1 and plan_instance_id=$2`, [state.tenantId, state.processTaskRef.planInstanceId]);
        const current = verifyAggregateRow(existing.rows[0]);
        if (['PAUSED', 'ABANDONED_UNVERIFIED', 'CANCELLED'].includes(control.rows[0]?.status) && current.status === 'RUNNING'
          && ['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(state.status)) {
          throw conflict('A late run result cannot change a process instance after its terminal boundary.', current.version,
            control.rows[0]?.status === 'ABANDONED_UNVERIFIED' ? 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED'
              : control.rows[0]?.status === 'CANCELLED' ? 'PROCESS_INSTANCE_CANCELLED' : 'PROCESS_INSTANCE_PAUSED');
        }
      }
      if (expectedVersion === null) {
        if (existing.rowCount) throw conflict('The aggregate already exists.', Number(existing.rows[0].version));
        await insertAggregate(client, state, this.kind);
        if (this.kind !== 'project' && state.projectId) {
          await client.query(`
            insert into orgward.aggregate_project_scopes
              (tenant_id, aggregate_kind, aggregate_id, project_id)
            values ($1, $2, $3, $4)
          `, [state.tenantId, this.kind, state.id, state.projectId]);
        }
      } else {
        if (!existing.rowCount) throw conflict('The aggregate no longer exists.', null);
        const current = verifyAggregateRow(existing.rows[0]);
        if (validateCurrent) await validateCurrent(current, client);
        if (current.version !== expectedVersion) throw conflict(`Version conflict: expected persisted version ${expectedVersion}. Reload before retrying.`, current.version);
        if (this.kind === 'execution_run' && principal && requiredPrincipalRoles?.includes('execution-approver')) {
          const latestResume = [...(current.events ?? [])].reverse().find((event) => event.type === 'ExecutionResumed');
          if (latestResume?.data?.ownerRecovery === true && latestResume.actor === principal) {
            throw conflict('The owner who recovered this task cannot approve its fresh request.', current.version, 'INDEPENDENT_APPROVER_REQUIRED');
          }
        }
        if (state.version <= expectedVersion) throw persistenceIntegrity('The aggregate version did not advance.');
        if (!workerFinalization && this.kind === 'execution_run' && current.state?.status === 'RUNNING' && state.status !== 'RUNNING') {
          const lease = await client.query(`
            select 1 from orgward.execution_worker_leases
            where tenant_id = $1 and run_id = $2
          `, [state.tenantId, state.id]);
          if (lease.rowCount) {
            throw conflict('Active execution outcomes must pass through the worker authorization fence.', current.version, 'WORKER_FINALIZATION_REQUIRED');
          }
        }
        if (this.kind !== 'project') {
          if (Object.hasOwn(current, 'projectId') && current.projectId !== currentProjectId) {
            throw conflict('The aggregate project scope cannot be changed by this command.', current.version, 'PROJECT_SCOPE_CONFLICT');
          }
        }
        const currentEvents = Array.isArray(current.events) ? current.events : [];
        const nextEvents = Array.isArray(state.events) ? state.events : [];
        if (nextEvents.length < currentEvents.length || contentHash(nextEvents.slice(0, currentEvents.length)) !== contentHash(currentEvents)) {
          throw persistenceIntegrity('Persisted event history cannot be removed or rewritten.');
        }
        await updateAggregate(client, state, this.kind, expectedVersion);
      }
      const priorEventCount = existing.rowCount && Array.isArray(existing.rows[0].state?.events) ? existing.rows[0].state.events.length : 0;
      const newEvents = Array.isArray(state.events) ? state.events.slice(priorEventCount) : [];
      for (const event of newEvents) {
        await recordEvent(client, {
          tenantId: state.tenantId, kind: this.kind, id: state.id,
          version: event.aggregateVersion ?? event.version ?? state.version,
          commandId: event.type === 'RequirementCriterionBaselineRevised'
            ? event.data?.commandId ?? null : event.causationId ?? null, event,
        });
      }
      if (this.kind === 'execution_run' && state.processTaskRef) {
        await syncProcessTaskRuntimeFromRun(client, state, { commandId: runtimeCommandId });
        if (['SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(state.status)) {
          await settleProcessTaskPauseIfDrained(client, state.tenantId, state.processTaskRef.planInstanceId);
        }
      }
    return state;
  }

  async authorizeExecutionDispatch({ tenantId, projectId, principal, authzGeneration, runId, expectedVersion, workerId,
    leaseDurationMs = 5_000, start, validateCurrentProfile = null }) {
    if (this.kind !== 'execution_run' || typeof start !== 'function'
      || (validateCurrentProfile !== null && typeof validateCurrentProfile !== 'function')) throw projectAccessDenied();
    if (!/^[a-f0-9-]{36}$/.test(workerId ?? '') || !Number.isInteger(leaseDurationMs)
      || leaseDurationMs < 1_000 || leaseDurationMs > 60_000) throw new Error('The execution worker lease is invalid.');
    return this.persistence.transaction(async (client) => {
      const hintResult = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
      `, [tenantId, runId]);
      if (!hintResult.rowCount) throw projectAccessDenied();
      const hint = verifyAggregateRow(hintResult.rows[0]);
      if (hint.projectId !== projectId || hint.status !== 'RUNNING' || hint.version !== expectedVersion) {
        throw conflict('Execution dispatch no longer matches the authorized run version.', hint.version, 'DISPATCH_CONFLICT');
      }
      if (hint.processTaskRef) {
        const currentProjectResult = await client.query(`select * from orgward.aggregates
          where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, projectId]);
        if (!currentProjectResult.rowCount) throw projectAccessDenied();
        const currentProject = verifyAggregateRow(currentProjectResult.rows[0]);
        const linkedPlan = await resolveRuntimeProcessPlan(client, {
          tenantId, projectId, project: currentProject,
          planId: hint.processTaskRef.processPlanId, revision: hint.processTaskRef.revision,
        });
        if (linkedPlan?.kind === 'manual_process_flow_plan'
          && !processPlanUsesCurrentOrViewOnlyBlueprint(currentProject, linkedPlan)) {
          throw conflict('The linked process plan is stale against the current saved blueprint; start a new instance from a current plan.',
            currentProject.version, 'PROCESS_PLAN_BLUEPRINT_STALE');
        }
        const control = await lockProcessTaskControl(client, tenantId, hint.processTaskRef.planInstanceId);
        if (!control) throw persistenceIntegrity('A linked process task has no durable instance control record.');
        requireActiveProcessTaskControl(control, hint.version);
        await requireAdvancedLinkedRunActivation(client, hint, control);
      }
      const approvalPrincipal = hint.approval?.principal;
      const lockedIdentities = await lockIdentityRows(client, tenantId, [principal, approvalPrincipal]);
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration,
      });
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      const selected = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
        for key share
      `, [tenantId, runId]);
      if (!selected.rowCount) throw projectAccessDenied();
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.projectId !== projectId || run.status !== 'RUNNING' || run.version !== expectedVersion) {
        throw conflict('Execution dispatch no longer matches the authorized run version.', run.version, 'DISPATCH_CONFLICT');
      }
      const approval = run.approval;
      const approver = lockedIdentities.get(approval?.principal);
      if (approval?.principal !== approvalPrincipal || !approver || approver.status !== 'active'
        || approver.actor_type !== 'human'
        || !approver.roles.includes('execution-approver')
        || !Number.isSafeInteger(approval.authorityGeneration)
        || Number(approver.authz_generation) !== approval.authorityGeneration
        || (approval.requestHash !== executionApprovalRequestHash(run)
          && (run.interventionRevisions?.length || approval.requestHash !== contentHash(run.workItem)))) {
        throw conflict('Execution approval is stale; obtain a new approval before dispatch.', run.version, 'EXECUTION_APPROVAL_STALE');
      }
      const approverMembership = await client.query(`
        select access, generation from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
        for share
      `, [tenantId, projectId, approvalPrincipal]);
      if (!approverMembership.rowCount
        || !['owner', 'editor'].includes(approverMembership.rows[0].access)
        || !Number.isSafeInteger(approval.projectMembershipGeneration)
        || Number(approverMembership.rows[0].generation) !== approval.projectMembershipGeneration) {
        throw conflict('Execution approval is stale after a project membership change; obtain a new approval.', run.version, 'EXECUTION_APPROVAL_STALE');
      }
      if (validateCurrentProfile) await validateCurrentProfile(run, client);
      const lease = await client.query(`
        select worker_id from orgward.execution_worker_leases
        where tenant_id = $1 and run_id = $2 and lease_until > now()
        for update
      `, [tenantId, runId]);
      if (lease.rowCount) throw conflict('Another worker currently holds this execution lease.', run.version, 'WORKER_LEASE_HELD');
      await client.query(`
        insert into orgward.execution_worker_leases
          (tenant_id, run_id, project_id, principal, worker_id, lease_until)
        values ($1, $2, $3, $4, $5, now() + ($6 * interval '1 millisecond'))
        on conflict (tenant_id, run_id) do update set
          project_id = excluded.project_id, principal = excluded.principal,
          worker_id = excluded.worker_id, lease_until = excluded.lease_until,
          cancel_requested_at = null, cancel_reason = null, updated_at = now()
      `, [tenantId, runId, projectId, principal, workerId, leaseDurationMs]);
      return start();
    });
  }

  async renewExecutionLease({ tenantId, projectId, principal, authzGeneration, runId, workerId, leaseDurationMs = 5_000 }) {
    if (this.kind !== 'execution_run' || !/^[a-f0-9-]{36}$/.test(workerId ?? '')
      || !Number.isInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 60_000) {
      return { active: false, reason: 'worker_lease_invalid' };
    }
    return this.persistence.transaction(async (client) => {
      try { await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' }); }
      catch (error) {
        if (['ACTION_FORBIDDEN', 'PROJECT_NOT_FOUND'].includes(error.code)) {
          await client.query(`
            update orgward.execution_worker_leases
            set cancel_requested_at = coalesce(cancel_requested_at, now()),
              cancel_reason = coalesce(cancel_reason, 'authorization_revoked'), updated_at = now()
            where tenant_id = $1 and run_id = $2 and worker_id = $3
          `, [tenantId, runId, workerId]);
          const lease = await client.query(`
            select cancel_reason from orgward.execution_worker_leases
            where tenant_id = $1 and run_id = $2 and worker_id = $3
          `, [tenantId, runId, workerId]);
          await client.query(`
            update orgward.execution_worker_leases
            set lease_until = greatest(lease_until, now() + ($4 * interval '1 millisecond')),
              updated_at = now()
            where tenant_id = $1 and run_id = $2 and worker_id = $3
          `, [tenantId, runId, workerId, leaseDurationMs]);
          return { active: false, reason: lease.rows[0]?.cancel_reason ?? 'authorization_revoked' };
        }
        throw error;
      }
      try {
        await requirePrincipalAuthority(client, {
          tenantId, principal, roles: ['workspace-write'], authzGeneration,
        });
      } catch (error) {
        if (!['ACTION_FORBIDDEN', 'AUTHORITY_GENERATION_STALE'].includes(error.code)) throw error;
        await client.query(`
          update orgward.execution_worker_leases
          set cancel_requested_at = coalesce(cancel_requested_at, now()),
            cancel_reason = coalesce(cancel_reason, 'principal_authority_changed'), updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId]);
        const lease = await client.query(`
          select cancel_reason from orgward.execution_worker_leases
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId]);
        await client.query(`
          update orgward.execution_worker_leases
          set lease_until = greatest(lease_until, now() + ($4 * interval '1 millisecond')),
            updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId, leaseDurationMs]);
        return { active: false, reason: lease.rows[0]?.cancel_reason ?? 'principal_authority_changed' };
      }
      const lease = await client.query(`
        select worker_id, lease_until, cancel_requested_at, cancel_reason
        from orgward.execution_worker_leases
        where tenant_id = $1 and run_id = $2
        for update
      `, [tenantId, runId]);
      if (!lease.rowCount || lease.rows[0].worker_id !== workerId) return { active: false, reason: 'worker_lease_lost' };
      if (lease.rows[0].cancel_requested_at) {
        await client.query(`
          update orgward.execution_worker_leases
          set lease_until = greatest(lease_until, now() + ($4 * interval '1 millisecond')),
            updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId, leaseDurationMs]);
        return { active: false, reason: lease.rows[0].cancel_reason ?? 'authorization_revoked' };
      }
      if (new Date(lease.rows[0].lease_until).getTime() <= Date.now()) {
        await client.query(`
          update orgward.execution_worker_leases
          set cancel_requested_at = now(), cancel_reason = 'worker_lease_expired', updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId]);
        return { active: false, reason: 'worker_lease_expired' };
      }
      const run = await client.query(`
        select state from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
      `, [tenantId, runId]);
      if (!run.rowCount || run.rows[0].state.projectId !== projectId || run.rows[0].state.status !== 'RUNNING') {
        await client.query(`
          update orgward.execution_worker_leases
          set cancel_requested_at = now(), cancel_reason = 'execution_no_longer_running', updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId]);
        return { active: false, reason: 'execution_no_longer_running' };
      }
      await client.query(`
        update orgward.execution_worker_leases
        set lease_until = now() + ($4 * interval '1 millisecond'), updated_at = now()
        where tenant_id = $1 and run_id = $2 and worker_id = $3
      `, [tenantId, runId, workerId, leaseDurationMs]);
      return { active: true };
    });
  }

  async finalizeExecution({ tenantId, projectId, principal, runId, workerId, expectedVersion, dispatchStarted = true, forceInterruptionReason = null, complete, interrupt }) {
    if (this.kind !== 'execution_run' || typeof complete !== 'function' || typeof interrupt !== 'function'
      || !/^[a-f0-9-]{36}$/.test(workerId ?? '')) {
      throw new Error('The execution finalization request is invalid.');
    }
    return this.persistence.transaction(async (client) => {
      let authorized = true;
      try { await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' }); }
      catch (error) {
        if (error.code === 'ACTION_FORBIDDEN' || error.code === 'PROJECT_NOT_FOUND') authorized = false;
        else throw error;
      }

      const runHint = await client.query(`select state->'processTaskRef' as ref from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, runId]);
      const processTaskRef = runHint.rows[0]?.ref;
      if (processTaskRef?.planInstanceId) {
        const control = await lockProcessTaskControl(client, tenantId, processTaskRef.planInstanceId);
        if (['ABANDONED_UNVERIFIED', 'CANCELLED'].includes(control?.status)) {
          throw conflict('A late worker result cannot advance a terminal process instance.', expectedVersion,
            control.status === 'CANCELLED' ? 'PROCESS_INSTANCE_CANCELLED' : 'PROCESS_INSTANCE_ABANDONED_UNVERIFIED');
        }
      }

      const selected = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'execution_run' and aggregate_id = $2
        for update
      `, [tenantId, runId]);
      if (!selected.rowCount) throw projectAccessDenied();
      const current = verifyAggregateRow(selected.rows[0]);
      if (current.projectId !== projectId || current.status !== 'RUNNING' || current.version !== expectedVersion) {
        throw conflict('Execution finalization no longer matches the active run version.', current.version, 'WORKER_FINALIZATION_CONFLICT');
      }

      const lease = await client.query(`
        select worker_id, project_id, principal, lease_until <= clock_timestamp() expired,
          cancel_requested_at, cancel_reason
        from orgward.execution_worker_leases
        where tenant_id = $1 and run_id = $2
        for update
      `, [tenantId, runId]);
      if (!lease.rowCount && dispatchStarted) {
        throw conflict('The worker no longer owns this execution lease.', current.version, 'WORKER_LEASE_LOST');
      }
      if (lease.rowCount && (lease.rows[0].worker_id !== workerId
        || lease.rows[0].project_id !== projectId || lease.rows[0].principal !== principal)) {
        throw conflict('The worker no longer owns this execution lease.', current.version, 'WORKER_LEASE_LOST');
      }

      const leaseState = lease.rows[0] ?? {};
      let interruptionReason = forceInterruptionReason
        ?? (!authorized ? leaseState.cancel_reason ?? 'authorization_revoked' : null);
      if (leaseState.cancel_requested_at) interruptionReason ??= leaseState.cancel_reason ?? 'execution_cancelled';
      if (leaseState.expired) {
        interruptionReason ??= 'worker_lease_expired';
        await client.query(`
          update orgward.execution_worker_leases
          set cancel_requested_at = coalesce(cancel_requested_at, now()),
            cancel_reason = coalesce(cancel_reason, 'worker_lease_expired'), updated_at = now()
          where tenant_id = $1 and run_id = $2 and worker_id = $3
        `, [tenantId, runId, workerId]);
      }

      const nextRun = interruptionReason ? await interrupt(interruptionReason) : await complete();
      if (!nextRun || nextRun.id !== runId || nextRun.tenantId !== tenantId || nextRun.projectId !== projectId
        || nextRun.version !== expectedVersion + 1 || !['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(nextRun.status)) {
        throw persistenceIntegrity('The worker finalization produced an invalid terminal run.');
      }
      if (interruptionReason && (nextRun.status !== 'INTERRUPTED'
        || nextRun.execution?.changedArtifacts?.length !== 0)) {
        throw persistenceIntegrity('A revoked or expired worker cannot persist successful artifact metadata.');
      }
      // The dispatch ledger remains the sole authority for the unknown outcome
      // marker. Copy only a closed transport class from the failure event.
      const uncertainAttempt = await client.query(`select 1 from orgward.provider_dispatch_attempts
        where tenant_id=$1 and run_id=$2 and status='outcome_unknown' limit 1`, [tenantId, runId]);
      if (uncertainAttempt.rowCount && ['FAILED', 'INTERRUPTED'].includes(nextRun.status)) {
        nextRun.execution ??= {};
        const failureDiagnostic = nextRun.events?.findLast((event) => event.type === 'ExecutionFailed' || event.type === 'ExecutionInterrupted')?.data?.providerDiagnostic;
        nextRun.execution.providerDiagnostic = providerOutcomeDiagnosticForAttempt('outcome_unknown', failureDiagnostic);
      }
      await this.saveInTransaction(client, nextRun, { expectedVersion, workerFinalization: true });
      return { run: nextRun, status: nextRun.status, interrupted: Boolean(interruptionReason), reason: interruptionReason };
    });
  }

  async releaseExecutionLease({ tenantId, runId, workerId }) {
    if (this.kind !== 'execution_run') return false;
    return this.persistence.transaction(async (client) => {
      const run = await client.query(`select state->'processTaskRef' as process_task_ref from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, runId]);
      const instanceId = run.rows[0]?.process_task_ref?.planInstanceId;
      if (instanceId) await lockProcessTaskControl(client, tenantId, instanceId);
      const deleted = await client.query(`delete from orgward.execution_worker_leases
        where tenant_id=$1 and run_id=$2 and worker_id=$3`, [tenantId, runId, workerId]);
      if (instanceId) await settleProcessTaskPauseIfDrained(client, tenantId, instanceId);
      return deleted.rowCount === 1;
    });
  }
}

export class PostgresProjectStore extends PostgresDocumentStore {
  constructor(persistence) { super(persistence, 'project'); }

  async listWithPrincipalAuthority({
    tenantId, principal, anyPrincipalRoleGroups = [], authzGeneration, operation, lifecycle = 'active',
  }) {
    if (!tenantId || !principal || typeof operation !== 'function') return null;
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: anyPrincipalRoleGroups, authzGeneration,
      });
      const result = await client.query(`
        select a.*, m.access as scoped_membership_access,
          coalesce(outcomes.open_incident_count, 0)::int as open_incident_count,
          coalesce(outcomes.open_support_count, 0)::int as open_support_count
        from orgward.aggregates a
        join orgward.project_memberships m
          on m.tenant_id = a.tenant_id and m.project_kind = a.aggregate_kind and m.project_id = a.aggregate_id
        left join lateral (
          select count(*) filter (where state->>'category'='incident' and state->>'status' in ('OPEN','IN_PROGRESS')) as open_incident_count,
            count(*) filter (where state->>'category'='support' and state->>'status' in ('OPEN','IN_PROGRESS')) as open_support_count
          from orgward.customer_outcomes
          where tenant_id=a.tenant_id and project_id=a.aggregate_id
        ) outcomes on true
        where a.tenant_id = $1 and a.aggregate_kind = 'project'
          and m.principal = $2 and m.revoked_at is null
          and (($3 = 'active' and coalesce(a.state #>> '{lifecycle,status}', 'active') = 'active')
            or ($3 = 'archived' and a.state #>> '{lifecycle,status}' = 'archived'))
        order by a.updated_at desc, a.aggregate_id
        for share of a, m
      `, [tenantId, principal, lifecycle]);
      const caseRows = await client.query(`
        select a.*, s.project_id as scoped_project_id
        from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id=a.tenant_id and s.aggregate_kind=a.aggregate_kind and s.aggregate_id=a.aggregate_id
        join orgward.project_memberships m
          on m.tenant_id=s.tenant_id and m.project_kind='project'
          and m.project_id=s.project_id and m.principal=$2 and m.revoked_at is null
        where a.tenant_id=$1 and a.aggregate_kind='change_case'
        order by a.updated_at desc, a.aggregate_id
        for share of a, m
      `, [tenantId, principal]);
      const caseSummaryByProject = new Map(result.rows.map((row) => [row.aggregate_id, {
        activeChangeCaseCount: 0, latestActiveChangeCaseId: null, latestActiveChangeCaseTitle: null,
        changeCaseProjectionIncomplete: false,
      }]));
      for (const row of caseRows.rows) {
        const summary = caseSummaryByProject.get(row.scoped_project_id);
        if (!summary) continue;
        try {
          const changeCase = verifyAggregateRow(row);
          if (Object.hasOwn(changeCase, 'projectId') && changeCase.projectId !== row.scoped_project_id) {
            throw persistenceIntegrity('Change case project scope does not match aggregate state.');
          }
          if (['PASSED', 'STOPPED'].includes(changeCase.status)) continue;
          summary.activeChangeCaseCount += 1;
          if (!summary.latestActiveChangeCaseId) {
            summary.latestActiveChangeCaseId = changeCase.id;
            summary.latestActiveChangeCaseTitle = changeCase.title;
          }
        } catch {
          summary.changeCaseProjectionIncomplete = true;
        }
      }
      const records = [];
      let corruptRecords = 0;
      for (const row of result.rows) {
        try {
          const project = verifyAggregateRow(row);
          const integritySummary = projectPortfolioIntegritySummary(project);
          records.push({
            id: project.id, name: project.name, tenantId: project.tenantId,
            version: project.version, phase: project.phase, updatedAt: project.updatedAt,
            lifecycle: project.lifecycle ?? { status: 'active' },
            historyEventCount: Array.isArray(project.events) ? project.events.length : 0,
            blueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null,
            workspaceAccess: row.scoped_membership_access,
            openIncidentCount: row.open_incident_count,
            openSupportCount: row.open_support_count,
            ...caseSummaryByProject.get(project.id),
            ...integritySummary,
          });
        } catch { corruptRecords += 1; }
      }
      return operation({ records, corruptRecords });
    });
  }

  async getWithPrincipalAuthority({
    id, tenantId, principal, anyPrincipalRoleGroups = [], authzGeneration, operation,
  }) {
    if (!id || !tenantId || !principal || typeof operation !== 'function') return null;
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: anyPrincipalRoleGroups, authzGeneration,
      });
      const result = await client.query(`
        select a.*, m.access as membership_access from orgward.aggregates a
        join orgward.project_memberships m
          on m.tenant_id = a.tenant_id and m.project_kind = a.aggregate_kind and m.project_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'project' and a.aggregate_id = $2
          and m.principal = $3 and m.revoked_at is null
        for share of a, m
      `, [tenantId, id, principal]);
      return result.rowCount ? operation(verifyAggregateRow(result.rows[0]), { access: result.rows[0].membership_access }) : null;
    });
  }

  async withPrincipalFoundationAuthority({ tenantId, principal, authzGeneration, operation }) {
    if (!tenantId || !principal || typeof operation !== 'function') return null;
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']], authzGeneration,
      });
      const projects = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.project_memberships m
          on m.tenant_id = a.tenant_id and m.project_kind = 'project' and m.project_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'project'
          and m.principal = $2 and m.revoked_at is null
        order by a.aggregate_id
        for share of a, m
      `, [tenantId, principal]);
      const scopedAggregates = await client.query(`
        select a.*, s.project_id as scoped_project_id
        from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        join orgward.project_memberships m
          on m.tenant_id = s.tenant_id and m.project_kind = 'project'
          and m.project_id = s.project_id and m.principal = $2
        where a.tenant_id = $1 and a.aggregate_kind in ('change_case', 'execution_run')
          and m.revoked_at is null
        order by a.aggregate_kind, a.aggregate_id
        for share of a, m
      `, [tenantId, principal]);
      const snapshot = {
        projects: { records: [], corruptRecords: 0 },
        changeCases: { records: [], corruptRecords: 0 },
        executionRuns: { records: [], corruptRecords: 0 },
      };
      for (const row of projects.rows) {
        try { snapshot.projects.records.push(verifyAggregateRow(row)); }
        catch { snapshot.projects.corruptRecords += 1; }
      }
      for (const row of scopedAggregates.rows) {
        const target = row.aggregate_kind === 'change_case' ? snapshot.changeCases : snapshot.executionRuns;
        try {
          const state = verifyAggregateRow(row);
          if (state.projectId !== row.scoped_project_id) {
            throw persistenceIntegrity('Aggregate project scope does not match aggregate state.');
          }
          state.projectId = row.scoped_project_id;
          target.records.push(state);
        } catch { target.corruptRecords += 1; }
      }
      return operation(snapshot);
    });
  }

  async createWithCommandForPrincipal(project, commandId, payloadHash, principal, {
    requiredPrincipalRoles = ['workspace-write'], authzGeneration = null,
  } = {}) {
    if (!principal || principal !== project.createdBy) throw projectAccessDenied();
    return this.createWithCommand(project, commandId, payloadHash, principal, { requiredPrincipalRoles, authzGeneration });
  }

  async updateWithCommandForPrincipal(id, tenantId, command, principal, {
    requiredPrincipalRoles = ['workspace-write'], authzGeneration = null, minimumProjectAccess = null,
  } = {}) {
    if (!principal) throw projectAccessDenied();
    return this.updateWithCommand(id, tenantId, {
      ...command, principal, requiredPrincipalRoles, authzGeneration, minimumProjectAccess,
    });
  }

  async #membership(client, { tenantId, projectId, principal, lock = false }) {
    if (lock) {
      const identity = await client.query(`
        select principal from orgward.oidc_principals
        where tenant_id = $1 and principal = $2 and status = 'active' for share
      `, [tenantId, principal]);
      if (!identity.rowCount) return { rowCount: 0, rows: [] };
    }
    return client.query(`
      select m.access, m.generation
      from orgward.project_memberships m
      where m.tenant_id = $1 and m.project_id = $2 and m.principal = $3
        and m.revoked_at is null
      ${lock ? 'for share of m' : ''}
    `, [tenantId, projectId, principal]);
  }

  async #recordMembershipEvent(client, { tenantId, projectId, principal, eventType, access, actor, generation }) {
    await client.query(`
      insert into orgward.project_membership_events
        (tenant_id, project_id, principal, event_type, access, actor, generation)
      values ($1, $2, $3, $4, $5, $6, $7)
    `, [tenantId, projectId, principal, eventType, access, actor, generation]);
  }

  async #hasReadableMembership(client, tenantId, projectId, principal, lock = false) {
    const member = await this.#membership(client, { tenantId, projectId, principal, lock });
    return member.rowCount > 0;
  }

  async listWithDiagnosticsForPrincipal(tenantId, principal) {
    const result = await this.persistence.query(`
      select a.* from orgward.aggregates a
      join orgward.project_memberships m
        on m.tenant_id = a.tenant_id and m.project_kind = a.aggregate_kind and m.project_id = a.aggregate_id
      join orgward.oidc_principals p
        on p.principal = m.principal and p.tenant_id = m.tenant_id
      where a.tenant_id = $1 and a.aggregate_kind = 'project' and m.principal = $2
        and m.revoked_at is null and p.status = 'active'
      order by a.updated_at desc, a.aggregate_id
    `, [tenantId, principal]);
    const records = [];
    let corruptRecords = 0;
    for (const row of result.rows) {
      try { records.push(verifyAggregateRow(row)); }
      catch { corruptRecords += 1; }
    }
    return {
      corruptRecords,
      records: records.map((project) => ({
        id: project.id, name: project.name, tenantId: project.tenantId,
        version: project.version, phase: project.phase, updatedAt: project.updatedAt,
        blueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null,
      })),
    };
  }

  async listForPrincipal(tenantId, principal) {
    return (await this.listWithDiagnosticsForPrincipal(tenantId, principal)).records;
  }

  async getForPrincipal(id, tenantId, principal, {
    minimumProjectAccess = null, requiredPrincipalRoles = null, authzGeneration = null,
  } = {}) {
    const read = async (client) => {
      if (requiredPrincipalRoles) await requirePrincipalAuthority(client, {
        tenantId, principal, roles: requiredPrincipalRoles, authzGeneration,
      });
      const result = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.project_memberships m
          on m.tenant_id = a.tenant_id and m.project_kind = a.aggregate_kind and m.project_id = a.aggregate_id
        join orgward.oidc_principals p
          on p.principal = m.principal and p.tenant_id = m.tenant_id
        where a.tenant_id = $1 and a.aggregate_kind = 'project' and a.aggregate_id = $2
          and m.principal = $3 and m.revoked_at is null and p.status = 'active'
          and ($4::text is null or ($4 = 'owner' and m.access = 'owner')
            or ($4 = 'editor' and m.access in ('owner', 'editor')))
      `, [tenantId, id, principal, minimumProjectAccess]);
      return result.rowCount ? verifyAggregateRow(result.rows[0]) : null;
    };
    return requiredPrincipalRoles ? this.persistence.transaction(read) : read(this.persistence);
  }

  async listMembers(tenantId, projectId, actor, { actorAuthzGeneration = null, operation = null } = {}) {
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal: actor,
        anyRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']],
        authzGeneration: actorAuthzGeneration,
      });
      const identity = await client.query(`
        select principal from orgward.oidc_principals
        where tenant_id = $1 and principal = $2 and status = 'active'
        for share
      `, [tenantId, actor]);
      if (!identity.rowCount) return null;
      const membership = await client.query(`
        select access from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
        for share
      `, [tenantId, projectId, actor]);
      if (!membership.rowCount || !['owner', 'editor'].includes(membership.rows[0].access)) return null;
      const project = await client.query(`
        select 1 from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
        for key share
      `, [tenantId, projectId]);
      if (!project.rowCount) return null;
      const result = await client.query(`
        select m.principal, p.display_name, p.actor_type, m.access, m.generation, m.granted_at
        from orgward.project_memberships m
        join orgward.oidc_principals p on p.principal = m.principal and p.tenant_id = m.tenant_id
        where m.tenant_id = $1 and m.project_id = $2 and m.revoked_at is null and p.status = 'active'
        order by case m.access when 'owner' then 0 when 'editor' then 1 else 2 end, p.display_name
        for share of m, p
      `, [tenantId, projectId]);
      const members = result.rows.map((row) => ({
        principal: row.principal, displayName: row.display_name, actorType: row.actor_type,
        access: row.access, generation: Number(row.generation), grantedAt: row.granted_at,
      }));
      return operation ? operation(members) : members;
    });
  }

  async listActorBindingProposals({ tenantId, projectId, principal, authzGeneration = null }) {
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']], authzGeneration,
      });
      const membership = await client.query(`
        select access from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
        for share
      `, [tenantId, projectId, principal]);
      if (!membership.rowCount || !['owner', 'editor'].includes(membership.rows[0].access)) return null;
      const canReviewExactAssignments = membership.rows[0].access === 'owner';
      const selected = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
        for key share
      `, [tenantId, projectId]);
      if (!selected.rowCount) return null;
      const project = verifyAggregateRow(selected.rows[0]);
      const result = await client.query(`
        select b.blueprint_version, b.actor_id, b.role_id, b.target_principal, b.execution_profile_ids,
          b.target_membership_generation, b.target_authz_generation,
          b.status, b.proposed_by, b.proposed_at, b.enabled_at,
          target.display_name as target_name, target.actor_type as target_type, target.status as identity_status,
          target.authz_generation as current_authz_generation,
          member.access as member_access, member.generation as current_membership_generation, member.revoked_at as member_revoked_at,
          proposer.display_name as proposer_name
        from orgward.project_actor_binding_proposals b
        join orgward.oidc_principals target
          on target.tenant_id = b.tenant_id and target.principal = b.target_principal
        left join orgward.project_memberships member
          on member.tenant_id = b.tenant_id and member.project_id = b.project_id and member.principal = b.target_principal
        join orgward.oidc_principals proposer
          on proposer.tenant_id = b.tenant_id and proposer.principal = b.proposed_by
        where b.tenant_id = $1 and b.project_id = $2
        order by b.blueprint_version desc, b.proposed_at desc, b.actor_id, b.role_id
        for share of b, target, proposer
      `, [tenantId, projectId]);
      const proposals = result.rows.map((row) => {
        const blueprint = project.blueprintVersions?.find((candidate) => candidate.version === row.blueprint_version);
        const objects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
        const actor = objects.find((object) => object.id === row.actor_id);
        const role = objects.find((object) => object.id === row.role_id);
        const targetEligible = row.identity_status === 'active' && row.member_revoked_at === null
          && ['owner', 'editor'].includes(row.member_access)
          && Number(row.target_authz_generation) === Number(row.current_authz_generation)
          && Number(row.target_membership_generation) === Number(row.current_membership_generation)
          && ((actor?.type === 'actor-human' && row.target_type === 'human')
            || (actor?.type === 'actor-agent' && row.target_type === 'workload'));
        const blueprintCurrent = row.blueprint_version === (project.blueprintVersions?.at(-1)?.version ?? null);
        const eligibilityStatus = [
          ...(!blueprintCurrent ? ['stale_blueprint'] : []),
          ...(!targetEligible ? ['no_longer_eligible'] : []),
        ];
        if (!eligibilityStatus.length) eligibilityStatus.push('eligible');
        return {
          blueprintVersion: row.blueprint_version,
          currentBlueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null,
          actorId: row.actor_id,
          actorName: actor?.name ?? 'Unknown blueprint actor',
          roleId: row.role_id,
          roleName: role?.name ?? 'Unknown blueprint role',
          executionProfileIds: row.execution_profile_ids ?? [],
          targetName: row.target_name,
          ...(canReviewExactAssignments ? { targetPrincipal: row.target_principal } : {}),
          targetMembershipGeneration: Number(row.target_membership_generation),
          targetAuthzGeneration: Number(row.target_authz_generation),
          targetType: row.target_type,
          targetStatus: targetEligible ? 'active_project_member' : 'no_longer_eligible',
          eligibilityStatus,
          status: row.status,
          proposedByName: row.proposer_name,
          proposedAt: row.proposed_at,
          enabledAt: row.enabled_at,
        };
      });
      return { currentBlueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null, proposals };
    });
  }

  async grantMember({ tenantId, projectId, actor, actorAuthzGeneration, principal, access, beforeReaderAccess = null }) {
    if (!['reader', 'editor'].includes(access) || actor === principal) throw projectAccessDenied();
    const outcome = await this.persistence.transaction(async (client) => {
      const identities = await lockIdentityRows(client, tenantId, [actor, principal]);
      if (identities.get(actor)?.status !== 'active') return null;
      await requirePrincipalAuthority(client, {
        tenantId, principal: actor, roles: ['workspace-write'], authzGeneration: actorAuthzGeneration,
      });
      await lockProjectAccess(client, { tenantId, projectId, principal: actor, minimum: 'owner' });
      const ownerMembership = await client.query(`
        select access from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
        for share
      `, [tenantId, projectId, actor]);
      if (!ownerMembership.rowCount) return null;
      if (ownerMembership.rows[0].access !== 'owner') throw projectAccessDenied();
      if (identities.get(principal)?.status !== 'active') return null;
      const existing = await client.query(`
        select access, generation, revoked_at from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 for update
      `, [tenantId, projectId, principal]);
      if (existing.rowCount && existing.rows[0].revoked_at === null && existing.rows[0].access === access) {
        if (access === 'reader') {
          await requestExecutionLeaseCancellation(client, { tenantId, projectId, principal, reason: 'project_access_downgraded' });
        }
        return { result: { principal, access, generation: Number(existing.rows[0].generation) }, cancelWorker: access === 'reader' };
      }
      if (existing.rowCount && existing.rows[0].revoked_at === null && existing.rows[0].access === 'owner') {
        throw projectAccessDenied();
      }
      if (access === 'reader') {
        await requestExecutionLeaseCancellation(client, { tenantId, projectId, principal, reason: 'project_access_downgraded' });
      }
      const upserted = await client.query(`
        insert into orgward.project_memberships
          (tenant_id, project_id, principal, access, granted_by)
        values ($1, $2, $3, $4, $5)
        on conflict (tenant_id, project_id, principal) do update set
          access = excluded.access, generation = orgward.project_memberships.generation + 1,
          granted_by = excluded.granted_by, granted_at = now(), revoked_at = null, revoked_by = null
        returning generation
      `, [tenantId, projectId, principal, access, actor]);
      const generation = Number(upserted.rows[0].generation);
      await this.#recordMembershipEvent(client, {
        tenantId, projectId, principal, eventType: 'MembershipGranted', access, actor, generation,
      });
      return { result: { principal, access, generation }, cancelWorker: access === 'reader' };
    });
    if (outcome?.cancelWorker) await beforeReaderAccess?.({ tenantId, projectId, principal });
    return outcome?.result ?? null;
  }

  async revokeMember({ tenantId, projectId, actor, actorAuthzGeneration, principal, beforeRevoke = null }) {
    if (actor === principal) throw projectAccessDenied();
    const outcome = await this.persistence.transaction(async (client) => {
      const identities = await lockIdentityRows(client, tenantId, [actor, principal]);
      if (identities.get(actor)?.status !== 'active') return null;
      await requirePrincipalAuthority(client, {
        tenantId, principal: actor, roles: ['workspace-write'], authzGeneration: actorAuthzGeneration,
      });
      await lockProjectAccess(client, { tenantId, projectId, principal: actor, minimum: 'owner' });
      const ownerMembership = await client.query(`
        select access from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 and revoked_at is null
        for share
      `, [tenantId, projectId, actor]);
      if (!ownerMembership.rowCount) return null;
      if (ownerMembership.rows[0].access !== 'owner') throw projectAccessDenied();
      if (!identities.has(principal)) return false;
      const member = await client.query(`
        select access, generation, revoked_at from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3 for update
      `, [tenantId, projectId, principal]);
      if (!member.rowCount) return false;
      if (member.rows[0].access === 'owner') throw projectAccessDenied();
      if (member.rows[0].revoked_at) {
        await requestExecutionLeaseCancellation(client, { tenantId, projectId, principal, reason: 'project_membership_revoked' });
        return { result: true, cancelWorker: true };
      }
      await requestExecutionLeaseCancellation(client, { tenantId, projectId, principal, reason: 'project_membership_revoked' });
      const revoked = await client.query(`
        update orgward.project_memberships
        set revoked_at = now(), revoked_by = $4, generation = generation + 1
        where tenant_id = $1 and project_id = $2 and principal = $3
        returning access, generation
      `, [tenantId, projectId, principal, actor]);
      await this.#recordMembershipEvent(client, {
        tenantId, projectId, principal, eventType: 'MembershipRevoked',
        access: revoked.rows[0].access, actor, generation: Number(revoked.rows[0].generation),
      });
      return { result: true, cancelWorker: true };
    });
    if (outcome?.cancelWorker) await beforeRevoke?.({ tenantId, projectId, principal });
    return outcome?.result ?? outcome;
  }

  async listWithDiagnostics(tenantId) {
    const result = await super.listWithDiagnostics(tenantId);
    return {
      corruptRecords: result.corruptRecords,
      records: result.records.map((project) => ({
        id: project.id,
        name: project.name,
        tenantId: project.tenantId,
        version: project.version,
        phase: project.phase,
        updatedAt: project.updatedAt,
        blueprintVersion: project.blueprintVersions?.at(-1)?.version ?? null,
      })),
    };
  }

  commandSnapshot(project) {
    const { commandRecords: _commandRecords, ...snapshot } = project;
    return structuredClone(snapshot);
  }

  async #priorCommand(client, tenantId, operation, commandId, payloadHash) {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
    const prior = await client.query(`
      select * from orgward.command_results
      where tenant_id = $1 and operation = $2 and command_id = $3
    `, [tenantId, operation, commandId]);
    if (!prior.rowCount) return null;
    if (prior.rows[0].payload_hash !== payloadHash) {
      throw conflict('This command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
    }
    const result = verifyCommandRow(prior.rows[0]);
    if (prior.rows[0].aggregate_kind !== 'project'
      || result.id !== prior.rows[0].aggregate_id
      || result.tenantId !== tenantId) {
      throw persistenceIntegrity('A durable command result does not match its aggregate identity.');
    }
    const aggregate = await client.query(`
      select * from orgward.aggregates
      where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
    `, [tenantId, prior.rows[0].aggregate_kind, prior.rows[0].aggregate_id]);
    if (!aggregate.rowCount) throw persistenceIntegrity('A durable command result has no aggregate state.');
    const current = verifyAggregateRow(aggregate.rows[0]);
    if (current.version < result.version) throw persistenceIntegrity('A durable command result is ahead of aggregate state.');
    return result;
  }

  async #recordCommand(client, { tenantId, operation, commandId, payloadHash, project }) {
    const result = this.commandSnapshot(project);
    await client.query(`
      insert into orgward.command_results
        (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
      values ($1, $2, $3, $4, 'project', $5, $6::jsonb, $7)
    `, [tenantId, operation, commandId, payloadHash, project.id, canonicalJson(result), contentHash(result)]);
    await recordEvent(client, {
      tenantId, kind: 'project', id: project.id, version: project.version, commandId, event: project.events.at(-1),
    });
    return result;
  }

  async createWithCommand(project, commandId, payloadHash, principal = project.createdBy, {
    requiredPrincipalRoles = null, authzGeneration = null,
  } = {}) {
    const operation = 'project.create';
    const result = await this.persistence.transaction(async (client) => {
      if (requiredPrincipalRoles) await requirePrincipalAuthority(client, {
        tenantId: project.tenantId, principal, roles: requiredPrincipalRoles, authzGeneration,
      });
      const prior = await this.#priorCommand(client, project.tenantId, operation, commandId, payloadHash);
      if (prior) {
        const member = await this.#membership(client, {
          tenantId: project.tenantId, projectId: prior.id, principal, lock: true,
        });
        return member.rowCount ? { project: prior, replayed: true } : null;
      }
      if (principal !== project.createdBy) throw projectAccessDenied();
      delete project.commandRecords;
      await insertAggregate(client, project, 'project');
      const owner = await client.query(`
        insert into orgward.project_memberships
          (tenant_id, project_id, principal, access, granted_by)
        values ($1, $2, $3, 'owner', $3)
        returning generation
      `, [project.tenantId, project.id, principal]);
      await this.#recordMembershipEvent(client, {
        tenantId: project.tenantId, projectId: project.id, principal,
        eventType: 'MembershipGranted', access: 'owner', actor: principal,
        generation: Number(owner.rows[0].generation),
      });
      const snapshot = await this.#recordCommand(client, { tenantId: project.tenantId, operation, commandId, payloadHash, project });
      return { project: snapshot, replayed: false };
    });
    if (result && !result.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId: project.tenantId });
    return result;
  }

  async updateWithCommand(id, tenantId, {
    commandId, operation = 'project.record-answer', payloadHash, expectedVersion, principal = null,
    requiredPrincipalRoles = null, authzGeneration = null, minimumProjectAccess = null, apply,
    authorizeBeforeReplay = null, useCurrentVersion = false,
  }) {
    const result = await this.persistence.transaction(async (client) => {
      if (principal) {
        const member = await this.#membership(client, { tenantId, projectId: id, principal, lock: true });
        if (!member.rowCount) return null;
        if (!['owner', 'editor'].includes(member.rows[0].access)) throw projectAccessDenied();
        if (minimumProjectAccess === 'owner' && member.rows[0].access !== 'owner') throw projectAccessDenied();
      }
      if (requiredPrincipalRoles) await requirePrincipalAuthority(client, {
        tenantId, principal, roles: requiredPrincipalRoles, authzGeneration,
      });
      let prior = authorizeBeforeReplay ? null : await this.#priorCommand(client, tenantId, operation, commandId, payloadHash);
      if (prior) {
        if (prior.id !== id) throw conflict('This command ID belongs to a different project.', null, 'IDEMPOTENCY_CONFLICT');
        return { project: prior, replayed: true };
      }
      const selected = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
        for update
      `, [tenantId, id]);
      if (!selected.rowCount) return null;
      const project = verifyAggregateRow(selected.rows[0]);
      if (authorizeBeforeReplay) {
        await authorizeBeforeReplay(project, client);
        prior = await this.#priorCommand(client, tenantId, operation, commandId, payloadHash);
      }
      if (prior) {
        if (prior.id !== id) throw conflict('This command ID belongs to a different project.', null, 'IDEMPOTENCY_CONFLICT');
        return { project: prior, replayed: true };
      }
      if (project.lifecycle?.status === 'archived' && operation !== 'project.restore') {
        throw conflict('This workspace is archived and read-only. Its owner must restore it before making changes.', project.version, 'PROJECT_ARCHIVED');
      }
      if (!useCurrentVersion && project.version !== expectedVersion) {
        throw conflict(`Version conflict: the current version is ${project.version}. Reload before retrying.`, project.version);
      }
      const startingVersion = project.version;
      const priorEvents = structuredClone(project.events ?? []);
      await apply(project, client);
      if (project.version !== startingVersion + 1) throw persistenceIntegrity('The project version did not advance exactly once.');
      if (!Array.isArray(project.events) || project.events.length !== priorEvents.length + 1
        || contentHash(project.events.slice(0, priorEvents.length)) !== contentHash(priorEvents)) {
        throw persistenceIntegrity('A project command must append exactly one event without rewriting history.');
      }
      delete project.commandRecords;
      await updateAggregate(client, project, 'project', startingVersion);
      const snapshot = await this.#recordCommand(client, { tenantId, operation, commandId, payloadHash, project });
      return { project: snapshot, replayed: false };
    });
    if (result && !result.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return result;
  }

  async transitionLifecycle({ id, tenantId, principal, authzGeneration = null, expectedVersion, action, reason = null }) {
    if (!['archive', 'restore'].includes(action)) throw new TypeError('Unsupported workspace lifecycle action.');
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const membership = await client.query(`select access from orgward.project_memberships
        where tenant_id=$1 and project_id=$2 and principal=$3 and revoked_at is null for update`, [tenantId, id, principal]);
      if (!membership.rowCount) return null;
      if (membership.rows[0].access !== 'owner') throw projectAccessDenied();
      const selected = await client.query(`select * from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for update`, [tenantId, id]);
      if (!selected.rowCount) return null;
      const project = verifyAggregateRow(selected.rows[0]);
      if (project.version !== expectedVersion) throw conflict(`Version conflict: the current version is ${project.version}. Reload before retrying.`, project.version);
      const currentlyArchived = project.lifecycle?.status === 'archived';
      if (action === 'archive' && currentlyArchived) throw conflict('This workspace is already archived.', project.version, 'PROJECT_ALREADY_ARCHIVED');
      if (action === 'restore' && !currentlyArchived) throw conflict('This workspace is already active.', project.version, 'PROJECT_ALREADY_ACTIVE');
      if (action === 'archive') {
        const activeRuns = await client.query(`select count(*)::int as count from orgward.aggregates a
          join orgward.aggregate_project_scopes s on s.tenant_id=a.tenant_id and s.aggregate_kind=a.aggregate_kind and s.aggregate_id=a.aggregate_id
          where s.tenant_id=$1 and s.project_id=$2 and a.aggregate_kind='execution_run'
            and a.state->>'status' not in ('SUCCEEDED','FAILED','INTERRUPTED','CANCELLED')`, [tenantId, id]);
        const activeCases = await client.query(`select count(*)::int as count from orgward.aggregates a
          join orgward.aggregate_project_scopes s on s.tenant_id=a.tenant_id and s.aggregate_kind=a.aggregate_kind and s.aggregate_id=a.aggregate_id
          where s.tenant_id=$1 and s.project_id=$2 and a.aggregate_kind='change_case'
            and a.state->>'status' not in ('PASSED','STOPPED')`, [tenantId, id]);
        const runs = Number(activeRuns.rows[0]?.count ?? 0), cases = Number(activeCases.rows[0]?.count ?? 0);
        if (runs || cases) throw conflict(`Archive is paused because ${runs} execution run${runs === 1 ? '' : 's'} and ${cases} governed change${cases === 1 ? '' : 's'} are still active. Let them reach a terminal state, then retry. No work was cancelled.`, project.version, 'PROJECT_ARCHIVE_ACTIVE_WORK');
        project.lifecycle = { status: 'archived', archivedAt: new Date().toISOString(), archivedBy: principal, reason };
      } else {
        project.lifecycle = { status: 'active', restoredAt: new Date().toISOString(), restoredBy: principal,
          previousArchive: project.lifecycle };
      }
      project.version += 1;
      project.updatedAt = new Date().toISOString();
      project.updatedBy = principal;
      const event = { eventId: randomUUID(), type: action === 'archive' ? 'ProjectArchived' : 'ProjectRestored',
        at: project.updatedAt, actor: principal, version: project.version,
        data: action === 'archive' ? { reason } : { archivedAt: project.lifecycle.previousArchive?.archivedAt ?? null } };
      project.events ??= [];
      project.events.push(event);
      await updateAggregate(client, project, 'project', expectedVersion);
      await recordEvent(client, { tenantId, kind: 'project', id, version: project.version, event });
      return project;
    });
  }
}

export class PostgresGitHubSourceStore {
  static MAX_SNAPSHOTS_PER_BINDING = 32;
  static MAX_SNAPSHOTS_PER_PROJECT = 32;
  static MAX_SNAPSHOT_BYTES_PER_PROJECT = 64_000_000;
  constructor(persistence) { this.persistence = persistence; }

  async #authorize(client, { tenantId, projectId, principal, authzGeneration }) {
    await requirePrincipalAuthority(client, { tenantId, principal, roles: ['tenant-admin'], authzGeneration, actorType: 'human' });
    await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'owner' });
  }

  async #authorizeExecution(client, { tenantId, projectId, principal, authzGeneration }) {
    await requirePrincipalAuthority(client, { tenantId, principal, anyRoleGroups: [['workspace-write', 'tenant-admin']], authzGeneration, actorType: 'human' });
    await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
  }

  async createInstallationIntent({ tenantId, projectId, principal, authzGeneration, stateHash, expiresAt }) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, { tenantId, projectId, principal, authzGeneration });
      await client.query(`delete from orgward.github_app_installation_intents where expires_at <= now()`);
      const pending = await client.query(`select count(*)::int as count from orgward.github_app_installation_intents
        where tenant_id=$1 and principal=$2 and consumed_at is null and expires_at > now()`, [tenantId, principal]);
      if (Number(pending.rows[0].count) >= 10) throw Object.assign(new Error('Too many active GitHub installation flows. Wait for an existing flow to expire.'), {
        statusCode: 429, code: 'GITHUB_INSTALLATION_FLOW_LIMIT', retryable: false,
      });
      await client.query(`insert into orgward.github_app_installation_intents
        (state_hash,tenant_id,project_id,principal,authz_generation,expires_at)
        values ($1,$2,$3,$4,$5,$6)`, [stateHash, tenantId, projectId, principal, authzGeneration, expiresAt]);
    });
  }

  async validateInstallationIntent({ tenantId, principal, authzGeneration, stateHash }) {
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['tenant-admin'], authzGeneration, actorType: 'human' });
      const result = await client.query(`select project_id, provisional_installation_id as "installationId",
          provisional_app_id as "appId", provisional_account_id as "accountId",
          provisional_account_login as "accountLogin", provisional_account_type as "accountType"
        from orgward.github_app_installation_intents
        where state_hash=$1 and tenant_id=$2 and principal=$3 and authz_generation=$4
          and consumed_at is null and expires_at > now()`, [stateHash, tenantId, principal, authzGeneration]);
      if (!result.rowCount) return null;
      await lockProjectAccess(client, { tenantId, projectId: result.rows[0].project_id, principal, minimum: 'owner' });
      return { projectId: result.rows[0].project_id, provisionalInstallation: result.rows[0].installationId ? {
        installationId: result.rows[0].installationId, appId: result.rows[0].appId,
        accountId: result.rows[0].accountId, accountLogin: result.rows[0].accountLogin,
        accountType: result.rows[0].accountType,
      } : null };
    });
  }

  async setProvisionalInstallationIntent({ tenantId, principal, authzGeneration, stateHash, installation }) {
    return this.persistence.transaction(async (client) => {
      const intent = await client.query(`select project_id, provisional_installation_id from orgward.github_app_installation_intents
        where state_hash=$1 and tenant_id=$2 and principal=$3 and authz_generation=$4
          and consumed_at is null and expires_at > now() for update`, [stateHash, tenantId, principal, authzGeneration]);
      if (!intent.rowCount) return false;
      await this.#authorize(client, { tenantId, projectId: intent.rows[0].project_id, principal, authzGeneration });
      if (intent.rows[0].provisional_installation_id) return intent.rows[0].provisional_installation_id === installation.installationId;
      await client.query(`update orgward.github_app_installation_intents set provisional_installation_id=$2,
        provisional_app_id=$3, provisional_account_id=$4, provisional_account_login=$5, provisional_account_type=$6
        where state_hash=$1`, [stateHash, installation.installationId, installation.appId,
        installation.accountId, installation.accountLogin, installation.accountType]);
      return true;
    });
  }

  async completeInstallationIntent({ tenantId, principal, authzGeneration, stateHash, installation, githubUser }) {
    return this.persistence.transaction(async (client) => {
      const intent = await client.query(`select project_id, provisional_installation_id as "installationId",
          provisional_app_id as "appId", provisional_account_id as "accountId",
          provisional_account_login as "accountLogin", provisional_account_type as "accountType"
        from orgward.github_app_installation_intents
        where state_hash=$1 and tenant_id=$2 and principal=$3 and authz_generation=$4
          and consumed_at is null and expires_at > now() for update`,
      [stateHash, tenantId, principal, authzGeneration]);
      if (!intent.rowCount) return null;
      const provisional = intent.rows[0];
      if (!githubUser || !/^[1-9][0-9]{0,15}$/.test(String(githubUser.githubUserId ?? ''))
        || !/^[A-Za-z0-9_.-]{1,100}$/.test(githubUser.githubUserLogin ?? '')
        || provisional.installationId !== installation.installationId || provisional.appId !== installation.appId
        || provisional.accountId !== installation.accountId || provisional.accountLogin !== installation.accountLogin
        || provisional.accountType !== installation.accountType) return null;
      await this.#authorize(client, { tenantId, projectId: intent.rows[0].project_id, principal, authzGeneration });
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`github-installation:${installation.installationId}`]);
      const existing = await client.query(`select tenant_id, connection_revision from orgward.github_app_installations
        where installation_id=$1 for update`, [installation.installationId]);
      if (existing.rowCount && existing.rows[0].tenant_id !== tenantId) {
        throw Object.assign(new Error('This GitHub installation is already connected to another OrgWard tenant.'), {
          statusCode: 409, code: 'GITHUB_INSTALLATION_BOUND_TO_OTHER_TENANT', retryable: false,
        });
      }
      const revision = existing.rowCount ? Number(existing.rows[0].connection_revision) + 1 : 1;
      const eventType = existing.rowCount ? 'GitHubAppInstallationReconnected' : 'GitHubAppInstallationConnected';
      await client.query(`insert into orgward.github_app_installations
        (installation_id,tenant_id,app_id,account_login,account_type,connected_by,verified_at,connection_revision,github_account_id,github_user_id,github_user_login)
        values ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10)
        on conflict (installation_id) do update set app_id=excluded.app_id, account_login=excluded.account_login,
          account_type=excluded.account_type, connected_by=excluded.connected_by, verified_at=excluded.verified_at,
          connection_revision=excluded.connection_revision, github_account_id=excluded.github_account_id,
          github_user_id=excluded.github_user_id,
          github_user_login=excluded.github_user_login,
          updated_at=now()`, [installation.installationId, tenantId, installation.appId,
        installation.accountLogin, installation.accountType, principal, revision, installation.accountId,
        githubUser.githubUserId, githubUser.githubUserLogin]);
      const event = { eventId: `event-${randomUUID()}`, schemaVersion: '1.0', tenantId,
        aggregateId: installation.installationId, aggregateVersion: revision, type: eventType,
        actor: principal, at: new Date().toISOString(), data: { installationId: installation.installationId,
          appId: installation.appId, accountId: installation.accountId, accountLogin: installation.accountLogin, accountType: installation.accountType,
          githubUserId: githubUser.githubUserId, githubUserLogin: githubUser.githubUserLogin,
          authzGeneration } };
      await client.query(`insert into orgward.audit_log
        (tenant_id,aggregate_kind,aggregate_id,aggregate_version,event_type,actor,event,event_hash)
        values ($1,'github_app_installation',$2,$3,$4,$5,$6::jsonb,$7)`,
      [tenantId, installation.installationId, revision, eventType, principal, JSON.stringify(event), contentHash(event)]);
      await client.query(`update orgward.github_app_installation_intents set consumed_at=now()
        where state_hash=$1 and consumed_at is null`, [stateHash]);
      return { projectId: intent.rows[0].project_id };
    });
  }

  async listTenantInstallations({ tenantId, projectId, principal, authzGeneration }) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, { tenantId, projectId, principal, authzGeneration });
      const result = await client.query(`select installation_id as "installationId", account_login as "accountLogin",
        account_type as "accountType", verified_at as "verifiedAt"
        from orgward.github_app_installations where tenant_id=$1 and github_account_id is not null
          and github_user_id is not null order by account_login, installation_id`, [tenantId]);
      return result.rows.map((row) => ({ ...row, verifiedAt: row.verifiedAt.toISOString() }));
    });
  }

  async assertTenantInstallation({ tenantId, projectId, principal, authzGeneration, installationId }) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, { tenantId, projectId, principal, authzGeneration });
      const result = await client.query(`select 1 from orgward.github_app_installations
        where tenant_id=$1 and installation_id=$2
          and github_account_id is not null and github_user_id is not null`, [tenantId, installationId]);
      return Boolean(result.rowCount);
    });
  }

  async getTenantInstallation({ tenantId, projectId, principal, authzGeneration, installationId }) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, { tenantId, projectId, principal, authzGeneration });
      const result = await client.query(`select installation_id as "installationId", app_id as "appId",
          github_account_id as "accountId", account_login as "accountLogin", account_type as "accountType",
          verified_at as "verifiedAt"
        from orgward.github_app_installations where tenant_id=$1 and installation_id=$2
          and github_account_id is not null and github_user_id is not null`, [tenantId, installationId]);
      return result.rows[0] ? { ...result.rows[0], verifiedAt: result.rows[0].verifiedAt.toISOString() } : null;
    });
  }

  async listForProject({ tenantId, projectId, principal, authzGeneration }) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, { tenantId, projectId, principal, authzGeneration });
      const result = await client.query(`select source.binding,
          coalesce((select jsonb_agg(item.value - 'files' order by item.ordinality)
            from jsonb_array_elements(source.snapshots) with ordinality as item(value, ordinality)), '[]'::jsonb) as snapshots
        from orgward.github_repository_sources source
        join orgward.github_app_installations installation
          on installation.tenant_id=source.tenant_id and installation.installation_id=source.installation_id::text
            and installation.github_account_id is not null and installation.github_user_id is not null
        where source.tenant_id=$1 and source.project_id=$2 order by source.updated_at desc, source.repository_id, source.branch_ref`, [tenantId, projectId]);
      return result.rows.map((row) => ({ ...row.binding, snapshots: row.snapshots }));
    });
  }

  async listSnapshotsForExecution({ tenantId, projectId, principal, authzGeneration }) {
    return this.persistence.transaction(async (client) => {
      await this.#authorizeExecution(client, { tenantId, projectId, principal, authzGeneration });
      const result = await client.query(`select source.binding,
          coalesce((select jsonb_agg(item.value - 'files' order by item.ordinality)
            from jsonb_array_elements(source.snapshots) with ordinality as item(value, ordinality)), '[]'::jsonb) as snapshots
        from orgward.github_repository_sources source
        join orgward.github_app_installations installation
          on installation.tenant_id=source.tenant_id and installation.installation_id=source.installation_id::text
            and installation.github_account_id is not null and installation.github_user_id is not null
        where source.tenant_id=$1 and source.project_id=$2 order by source.updated_at desc, source.repository_id, source.branch_ref`, [tenantId, projectId]);
      return result.rows.flatMap((row) => (row.snapshots ?? []).map((snapshot) => ({ binding: row.binding, snapshot })));
    });
  }

  async resolveSnapshotForExecution({ tenantId, projectId, principal, authzGeneration, snapshotId }) {
    return this.persistence.transaction(async (client) => {
      await this.#authorizeExecution(client, { tenantId, projectId, principal, authzGeneration });
      const result = await client.query(`select source.binding, item.value as snapshot
        from orgward.github_repository_sources source
        join orgward.github_app_installations installation
          on installation.tenant_id=source.tenant_id and installation.installation_id=source.installation_id::text
            and installation.github_account_id is not null and installation.github_user_id is not null
        cross join lateral jsonb_array_elements(source.snapshots) item(value)
        where source.tenant_id=$1 and source.project_id=$2 and item.value->>'id'=$3
        limit 1`, [tenantId, projectId, snapshotId]);
      return result.rows[0] ? { binding: result.rows[0].binding, snapshot: result.rows[0].snapshot } : null;
    });
  }

  async listSnapshotFileManifestForExecution({ tenantId, projectId, principal, authzGeneration, snapshotId }) {
    return this.persistence.transaction(async (client) => {
      await this.#authorizeExecution(client, { tenantId, projectId, principal, authzGeneration });
      const result = await client.query(`select source.binding, item.value - 'files' as snapshot,
          coalesce((select jsonb_agg(jsonb_build_object(
              'path', file.value->'path', 'mode', file.value->'mode', 'size', file.value->'size',
              'contentHash', file.value->'contentHash', 'blobSha', file.value->'blobSha') order by file.ordinality)
            from jsonb_array_elements(coalesce(item.value->'files', '[]'::jsonb)) with ordinality as file(value, ordinality)), '[]'::jsonb) as files
        from orgward.github_repository_sources source
        join orgward.github_app_installations installation
          on installation.tenant_id=source.tenant_id and installation.installation_id=source.installation_id::text
            and installation.github_account_id is not null and installation.github_user_id is not null
        cross join lateral jsonb_array_elements(source.snapshots) item(value)
        where source.tenant_id=$1 and source.project_id=$2 and item.value->>'id'=$3
        limit 1`, [tenantId, projectId, snapshotId]);
      return result.rows[0] ? { binding: result.rows[0].binding, snapshot: result.rows[0].snapshot,
        files: result.rows[0].files } : null;
    });
  }

  async saveCapture({ tenantId, projectId, principal, authzGeneration, binding, snapshot }) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, { tenantId, projectId, principal, authzGeneration });
      const installed = await client.query(`select tenant_id from orgward.github_app_installations
        where installation_id=$1 and github_account_id is not null and github_user_id is not null
        for key share`, [binding.installationId]);
      if (!installed.rowCount || installed.rows[0].tenant_id !== tenantId) throw Object.assign(new Error('Connect this GitHub App installation to the current OrgWard tenant before capturing source.'), {
        statusCode: 403, code: 'GITHUB_INSTALLATION_NOT_BOUND', retryable: false,
      });
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`github-source-project:${tenantId}:${projectId}`]);
      const projectTotals = await client.query(`
        select count(*)::int as snapshot_count,
          coalesce(sum((item.value->>'totalBytes')::bigint), 0)::bigint as snapshot_bytes
        from orgward.github_repository_sources source
        cross join lateral jsonb_array_elements(source.snapshots) item
        where source.tenant_id=$1 and source.project_id=$2
      `, [tenantId, projectId]);
      const locked = await client.query(`select snapshots from orgward.github_repository_sources
        where tenant_id=$1 and project_id=$2 and repository_id=$3 and branch_ref=$4 for update`,
      [tenantId, projectId, binding.repositoryId, binding.branchRef]);
      const snapshots = locked.rows[0]?.snapshots ?? [];
      const replay = snapshots.some((entry) => entry.id === snapshot.id);
      if (!replay && snapshots.length >= PostgresGitHubSourceStore.MAX_SNAPSHOTS_PER_BINDING) {
        throw Object.assign(new Error('This repository ref has reached its 32-snapshot history limit. Existing immutable snapshots are retained; contact the installation operator before onboarding another revision.'), {
          statusCode: 409, code: 'GITHUB_SNAPSHOT_HISTORY_LIMIT', retryable: false,
        });
      }
      if (!replay && Number(projectTotals.rows[0].snapshot_count) >= PostgresGitHubSourceStore.MAX_SNAPSHOTS_PER_PROJECT) {
        throw Object.assign(new Error('This project has reached its 32-snapshot GitHub source limit. Existing immutable snapshots are retained; contact the installation operator before onboarding another revision.'), {
          statusCode: 409, code: 'GITHUB_PROJECT_SNAPSHOT_LIMIT', retryable: false,
        });
      }
      if (!replay && Number(projectTotals.rows[0].snapshot_bytes) + Number(snapshot.totalBytes) > PostgresGitHubSourceStore.MAX_SNAPSHOT_BYTES_PER_PROJECT) {
        throw Object.assign(new Error('This project has reached its 64,000,000-byte GitHub source snapshot limit. Existing immutable snapshots are retained; contact the installation operator before onboarding another revision.'), {
          statusCode: 409, code: 'GITHUB_PROJECT_SNAPSHOT_BYTES_LIMIT', retryable: false,
        });
      }
      const nextSnapshots = replay ? snapshots : [...snapshots, snapshot];
      await client.query(`insert into orgward.github_repository_sources
        (tenant_id, project_id, repository_id, installation_id, branch_ref, binding, snapshots)
        values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
        on conflict (tenant_id, project_id, repository_id, branch_ref) do update set
          installation_id=excluded.installation_id, binding=excluded.binding,
          snapshots=excluded.snapshots, updated_at=now()`,
      [tenantId, projectId, binding.repositoryId, binding.installationId, binding.branchRef, JSON.stringify(binding), JSON.stringify(nextSnapshots)]);
      return { ...binding, snapshots: nextSnapshots.map(({ files, ...metadata }) => metadata) };
    });
  }
}

export function projectPortfolioIntegritySummary(project) {
  const assessments = project.enterpriseIntegrityAssessments ?? [];
  if (!Array.isArray(assessments)) return { integrityProjectionIncomplete: true };
  if (!assessments.every((assessment) => isValidEnterpriseIntegrityAssessment(assessment, project.id))) return { integrityProjectionIncomplete: true };
  const assessment = assessments.at(-1);
  if (!assessment) return { integrityStatus: 'NOT_RUN', integritySourceCurrent: false, integrityReportId: null,
    integrityFindingCount: 0, integrityBlueprintVersion: null, integrityProjectionIncomplete: false };
  const current = latestBlueprint(project);
  return { integrityStatus: assessment.status,
    integritySourceCurrent: Boolean(current && assessment.source.blueprintId === current.id
      && assessment.source.blueprintVersion === current.version && assessment.source.snapshotHash === digest(current)),
    integrityReportId: assessment.id, integrityFindingCount: assessment.counts.findings,
    integrityBlueprintVersion: assessment.source.blueprintVersion, integrityProjectionIncomplete: false };
}

function processEvidenceReviewConflict(criteria) {
  const business = criteria.filter((entry) => entry.criterionType === 'BUSINESS');
  const technical = criteria.filter((entry) => entry.criterionType === 'TECHNICAL');
  const businessSupported = business.filter((entry) => entry.disposition === 'SUPPORTED');
  const businessContradicted = business.filter((entry) => entry.disposition === 'CONTRADICTED');
  const technicalSupported = technical.filter((entry) => entry.disposition === 'SUPPORTED');
  const technicalContradicted = technical.filter((entry) => entry.disposition === 'CONTRADICTED');
  const conflict = (businessSupported.length > 0 && technicalContradicted.length > 0)
    || (businessContradicted.length > 0 && technicalSupported.length > 0);
  const conflictBusinessCriterionIds = conflict
    ? [...new Set([...businessSupported, ...businessContradicted].map((entry) => entry.criterionId))].sort() : [];
  const conflictTechnicalCriterionIds = conflict
    ? [...new Set([...technicalSupported, ...technicalContradicted].map((entry) => entry.criterionId))].sort() : [];
  const failedMandatoryCriterionIds = criteria.filter((entry) => entry.mandatory && entry.disposition === 'CONTRADICTED')
    .map((entry) => entry.criterionId).filter(Boolean).sort();
  return { conflict, conflictBusinessCriterionIds, conflictTechnicalCriterionIds, failedMandatoryCriterionIds,
    requiresResolution: conflict || failedMandatoryCriterionIds.length > 0 };
}

function processEvidenceReviewState(changeCase, requirement, review) {
  if (!requirement || !review || typeof review.id !== 'string' || !/^process-evidence-review-[0-9a-f-]{36}$/i.test(review.id)) return null;
  const { reviewHash, integrityStatus: _integrityStatus, applicability: _applicability, ...reviewCore } = review;
  if (![1, 2, 3, 4].includes(review.schemaVersion) || contentHash(reviewCore) !== reviewHash || review.status !== 'HUMAN_REVIEWED'
    || review.verificationStatus !== 'NOT_EXECUTED' || review.truthStatus !== 'UNVERIFIED') return null;
  if (review.schemaVersion === 2 || review.schemaVersion === 3 || review.schemaVersion === 4) {
    const conflict = processEvidenceReviewConflict(review.criteria ?? []);
    const acceptanceStatus = conflict.failedMandatoryCriterionIds.length
      ? 'BLOCKED_MANDATORY_FAILURE' : 'REVIEW_ONLY_NOT_ACCEPTED';
    const resolution = review.conflictResolution;
    if (contentHash(review.failedMandatoryCriterionIds) !== contentHash(conflict.failedMandatoryCriterionIds)
      || review.acceptanceStatus !== acceptanceStatus
      || conflict.requiresResolution !== Boolean(resolution)
      || (resolution && (resolution.schemaVersion !== 1 || resolution.decision !== 'PRESERVE_CRITERION_OUTCOMES'
        || typeof resolution.rationale !== 'string' || !resolution.rationale.trim()
        || resolution.recordedBy !== review.reviewerPrincipal || resolution.recordedAt !== review.reviewedAt
        || contentHash(resolution.businessCriterionIds) !== contentHash(conflict.conflictBusinessCriterionIds)
        || contentHash(resolution.technicalCriterionIds) !== contentHash(conflict.conflictTechnicalCriterionIds)
        || contentHash(resolution.failedMandatoryCriterionIds) !== contentHash(conflict.failedMandatoryCriterionIds)))) return null;
    if (review.criterionContractVersion === null) {
      if (review.criterionContractHash !== null) return null;
    } else {
      const contract = requirement.criterionContractHistory?.find((entry) => entry.version === review.criterionContractVersion);
      if (!contract || contract.contentHash !== review.criterionContractHash) return null;
      const declared = contract.criteria.map((entry, index) => ({ index, criterion: entry.text, criterionHash: digest(entry),
        criterionId: entry.id, criterionType: entry.type, mandatory: entry.mandatory, source: entry.source, scope: entry.scope }));
      const reviewed = (review.criteria ?? []).map(({ disposition: _disposition, note: _note, ...entry }) => entry);
      if (contentHash(reviewed) !== contentHash(declared)) return null;
    }
  }
  const artifact = changeCase.artifacts?.requirements;
  const retained = (requirement.processRunEvidenceReviews ?? []).filter((entry) => entry.id === review.id);
  const aggregateCopies = (artifact?.processRunEvidenceReviews ?? []).filter((entry) => entry.id === review.id);
  const persistedReviewCore = (entry) => Object.fromEntries(Object.entries(entry ?? {})
    .filter(([key]) => !['integrityStatus', 'applicability'].includes(key)));
  if (retained.length !== 1 || aggregateCopies.length !== 1
    || contentHash(persistedReviewCore(retained[0])) !== contentHash(persistedReviewCore(aggregateCopies[0]))) return null;
  const linkMatches = (requirement.processRunEvidenceLinks ?? []).filter((entry) => entry.id === review.linkId);
  if (linkMatches.length !== 1) return null;
  const link = linkMatches[0];
  const { linkHash, applicability: _linkApplicability, ...linkCore } = link;
  if (contentHash(linkCore) !== linkHash || review.linkHash !== linkHash
    || review.tenantId !== changeCase.tenantId || review.projectId !== changeCase.projectId
    || review.caseId !== changeCase.id || review.requirementId !== requirement.id
    || review.requirementHash !== link.requirementHash || review.traceHash !== link.traceHash
    || review.contractHash !== link.contractHash || review.draftRevision !== link.draftRevision
    || contentHash(review.source) !== contentHash(link.source)
    || contentHash(review.plan) !== contentHash(link.plan)
    || contentHash(review.instance) !== contentHash(link.instance)
    || contentHash(review.outputPins) !== contentHash(link.outputs)
    || contentHash(review.outputEvidenceHashes) !== contentHash((link.outputEvidence ?? []).map((entry) => entry.recordHash ?? null))) return null;
  if (review.schemaVersion === 3 || review.schemaVersion === 4) {
    const plan = (changeCase.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === review.behaviorPlanId);
    if (!verifyProcessBehaviorTestPlan(plan) || plan.planHash !== review.behaviorPlanHash
      || plan.planHash !== link.behaviorEvaluation?.planHash || plan.id !== link.behaviorEvaluation?.planId
      || review.evaluationContextHash !== contentHash(plan.evaluationContext)
      || review.caseDefinitionsHash !== contentHash(plan.caseDefinitions)
      || review.scenarioCases?.length !== 3
      || review.scenarioCases.some((entry) => {
        const definition = plan.caseDefinitions.cases.find((candidate) => candidate.type === entry.type);
        const { disposition, note, executionDecision, executionReviewStatus, ...pinned } = entry;
        const allowedKeys = review.schemaVersion === 4
          ? ['type', 'definitionHash', 'definition', 'disposition', 'note', 'executionDecision', 'executionReviewStatus']
          : ['type', 'definitionHash', 'definition', 'disposition', 'note'];
        return !definition || entry.definitionHash !== digest(definition)
          || Object.keys(entry).some((key) => !allowedKeys.includes(key))
          || contentHash(pinned.definition) !== contentHash(definition)
          || !['SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'].includes(disposition)
          || typeof note !== 'string' || !note.trim()
          || (review.schemaVersion === 3 && (executionDecision !== undefined || executionReviewStatus !== undefined))
          || (review.schemaVersion === 4 && (!['APPROVE_FOR_TEST_EXECUTION', 'REQUEST_CHANGES'].includes(executionDecision)
            || executionReviewStatus !== (executionDecision === 'APPROVE_FOR_TEST_EXECUTION'
              ? 'REVIEWED_FOR_TEST_EXECUTION' : 'CHANGES_REQUESTED')
            || (executionDecision === 'APPROVE_FOR_TEST_EXECUTION'
              && (definition.executionMapping?.status !== 'OWNER_PROPOSED_UNVERIFIED'
                || !definition.dataset || !definition.expectedOutput))));
      })) return null;
  }
  const matchingEvents = (changeCase.events ?? []).filter((event) => event.type === 'ProcessRunEvidenceReviewed'
    && event.data?.reviewId === review.id);
  if (matchingEvents.length !== 1) return null;
  const event = matchingEvents[0];
  const expectedData = { reviewId: review.id, reviewHash, linkId: link.id, linkHash,
    requirementId: requirement.id, requirementHash: review.requirementHash, traceHash: review.traceHash,
    contractHash: review.contractHash, sourceHash: contentHash(review.source), planHash: contentHash(review.plan),
    instanceHash: contentHash(review.instance), outputPinsHash: contentHash(review.outputPins),
    criteriaHash: contentHash(review.criteria), disposition: review.disposition,
    reviewerPrincipal: review.reviewerPrincipal, requestHash: review.requestHash, recordedVersion: review.recordedVersion,
    status: 'HUMAN_REVIEWED',
    verificationStatus: 'NOT_EXECUTED', truthStatus: 'UNVERIFIED' };
  if (review.schemaVersion === 2) Object.assign(expectedData, { reviewSchemaVersion: 2,
    conflictResolutionHash: contentHash(review.conflictResolution),
    criterionContractVersion: review.criterionContractVersion,
    criterionContractHash: review.criterionContractHash,
    failedMandatoryCriterionIds: review.failedMandatoryCriterionIds,
    acceptanceStatus: review.acceptanceStatus });
  if (review.schemaVersion === 3 || review.schemaVersion === 4) Object.assign(expectedData, { reviewSchemaVersion: review.schemaVersion,
    conflictResolutionHash: contentHash(review.conflictResolution),
    criterionContractVersion: review.criterionContractVersion, criterionContractHash: review.criterionContractHash,
    failedMandatoryCriterionIds: review.failedMandatoryCriterionIds, acceptanceStatus: review.acceptanceStatus,
    behaviorPlanId: review.behaviorPlanId, behaviorPlanHash: review.behaviorPlanHash,
    evaluationContextHash: review.evaluationContextHash, caseDefinitionsHash: review.caseDefinitionsHash,
    scenarioCasesHash: contentHash(review.scenarioCases) });
  if (contentHash(event.data) !== contentHash(expectedData) || event.actor !== review.reviewerPrincipal
    || event.timestamp !== review.reviewedAt || event.tenantId !== changeCase.tenantId
    || ([2, 3, 4].includes(review.schemaVersion) && event.schemaVersion !== 2)
    || (review.schemaVersion === 1 && event.schemaVersion !== undefined && event.schemaVersion !== 1)
    || event.contentHash !== contentHash({ type: 'ProcessRunEvidenceReviewed', tenantId: changeCase.tenantId, data: expectedData })) return null;
  const idempotency = changeCase.idempotency?.[event.causationId];
  if (!idempotency || idempotency.action !== 'review-process-run-evidence'
    || idempotency.reviewId !== review.id || idempotency.requestHash !== review.requestHash
    || idempotency.at !== review.reviewedAt || Number(idempotency.version) !== Number(review.recordedVersion)
    || !/^[a-f0-9]{64}$/.test(idempotency.requestHash ?? '') || !Number.isSafeInteger(review.recordedVersion)) return null;
  return { event, idempotency };
}

function processIntentEvaluationAcceptanceState(changeCase, requirement, acceptance) {
  const invalid = () => null;
  if (!requirement || !acceptance || acceptance.schemaVersion !== 1
    || !/^intent-evaluation-acceptance-[0-9a-f-]{36}$/i.test(acceptance.id ?? '')) return invalid('identity');
  const { acceptanceHash, applicability: _applicability, integrityStatus: _integrityStatus, ...core } = acceptance;
  if (!/^[a-f0-9]{64}$/.test(acceptanceHash ?? '') || contentHash(core) !== acceptanceHash
    || acceptance.status !== 'ACCEPTED' || acceptance.verificationStatus !== 'NOT_EXECUTED'
    || acceptance.truthStatus !== 'UNVERIFIED') return invalid('record-core');
  const aggregate = (changeCase.artifacts?.processIntentEvaluationAcceptances ?? []).filter((entry) => entry.id === acceptance.id);
  if (aggregate.length !== 1) return invalid('aggregate-copy');
  const link = (requirement.processRunEvidenceLinks ?? []).find((entry) => entry.id === acceptance.linkId);
  const review = (requirement.processRunEvidenceReviews ?? []).find((entry) => entry.id === acceptance.reviewId);
  if (!link || !review || review.integrityStatus !== 'VALID'
    || processEvidenceReviewState(changeCase, requirement, review) === null) return invalid('review-state');
  const { linkHash, applicability: _linkApplicability, ...linkCore } = link;
  const { reviewHash, integrityStatus: _reviewIntegrity, applicability: _reviewApplicability, ...reviewCore } = review;
  const historicalContract = requirement.criterionContractHistory?.find((entry) => entry.version === acceptance.criterionContractVersion
    && entry.contentHash === acceptance.criterionContractHash);
  const evaluation = link.behaviorEvaluation;
  const behaviorPlan = (changeCase.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === evaluation?.planId);
  const declarations = historicalContract?.criteria ?? [];
  const traceHash = link.traceHash;
  if (contentHash(linkCore) !== linkHash || acceptance.linkHash !== linkHash
    || contentHash(reviewCore) !== reviewHash || acceptance.reviewHash !== reviewHash
    || acceptance.tenantId !== changeCase.tenantId || acceptance.projectId !== changeCase.projectId
    || acceptance.caseId !== changeCase.id || acceptance.requirementId !== requirement.id
    || !historicalContract || !verifyRequirementCriterionContract(requirement, historicalContract, { historical: true })
    || acceptance.requirementHash !== link.requirementHash || acceptance.traceHash !== traceHash
    || acceptance.draftRevision !== link.draftRevision
    || contentHash(acceptance.source) !== contentHash(link.source)
    || review.requirementHash !== acceptance.requirementHash || review.draftRevision !== acceptance.draftRevision
    || review.traceHash !== acceptance.traceHash || review.criterionContractVersion !== acceptance.criterionContractVersion
    || review.criterionContractHash !== acceptance.criterionContractHash
    || review.linkId !== link.id || review.linkHash !== linkHash
    || review.acceptanceStatus !== 'REVIEW_ONLY_NOT_ACCEPTED'
    || review.criteria.length !== declarations.length || review.criteria.some((entry) => entry.disposition !== 'SUPPORTED')
    || declarations.some((entry) => !review.criteria.some((reviewed) => reviewed.criterionId === entry.id
      && reviewed.criterionHash === digest(entry) && reviewed.disposition === 'SUPPORTED'))
    || !evaluation || evaluation.status !== 'CHECKED_BEHAVIOR' || evaluation.result !== 'TEST_PASS'
    || evaluation.businessTruthStatus !== 'UNVERIFIED' || evaluation.assertions.length !== declarations.length
    || !verifyProcessBehaviorTestPlan(behaviorPlan) || behaviorPlan.planHash !== evaluation.planHash
    || behaviorPlan.requirementId !== requirement.id || behaviorPlan.requirementHash !== acceptance.requirementHash
    || behaviorPlan.draftRevision !== acceptance.draftRevision || behaviorPlan.traceHash !== acceptance.traceHash
    || behaviorPlan.criterionContractVersion !== acceptance.criterionContractVersion
    || behaviorPlan.criterionContractHash !== acceptance.criterionContractHash
    || evaluation.assertions.some((entry) => entry.status !== 'TEST_PASS'
      || !behaviorPlan.assertions.some((planned) => planned.id === entry.id
        && declarations.some((criterion) => criterion.id === planned.criterionId
          && digest(criterion) === planned.criterionHash)))
    || acceptance.evaluationHash !== contentHash(evaluation)
    || link.status !== 'UNVERIFIED' || link.verificationStatus !== 'NOT_EXECUTED') return invalid('evidence-core');
  const matchingEvents = (changeCase.events ?? []).filter((event) => event.type === 'IntentEvaluationAccepted'
    && event.data?.acceptanceId === acceptance.id);
  if (matchingEvents.length !== 1) return invalid('event-count');
  const event = matchingEvents[0];
  const expectedData = { acceptanceId: acceptance.id, acceptanceHash, requirementId: requirement.id,
    requirementHash: acceptance.requirementHash, draftRevision: acceptance.draftRevision, traceHash: acceptance.traceHash,
    criterionContractVersion: acceptance.criterionContractVersion, criterionContractHash: acceptance.criterionContractHash,
    linkId: link.id, linkHash, reviewId: review.id, reviewHash, evaluationHash: contentHash(evaluation),
    acceptedBy: acceptance.acceptedBy, requestHash: acceptance.requestHash, recordedVersion: acceptance.recordedVersion,
    status: 'ACCEPTED', verificationStatus: 'NOT_EXECUTED', truthStatus: 'UNVERIFIED' };
  if (contentHash(event.data) !== contentHash(expectedData) || event.actor !== acceptance.acceptedBy
    || event.timestamp !== acceptance.acceptedAt || event.tenantId !== changeCase.tenantId
    || event.contentHash !== contentHash({ type: 'IntentEvaluationAccepted', tenantId: changeCase.tenantId, data: expectedData })) return invalid('event-data');
  const idempotency = changeCase.idempotency?.[event.causationId];
  if (!idempotency || idempotency.action !== 'accept-intent-evaluation'
    || idempotency.acceptanceId !== acceptance.id || idempotency.requestHash !== acceptance.requestHash
    || idempotency.at !== acceptance.acceptedAt || Number(idempotency.version) !== Number(acceptance.recordedVersion)
    || !Number.isSafeInteger(acceptance.recordedVersion)) return invalid('idempotency');
  return { event, idempotency };
}

function approvedProcessBehaviorScenario(changeCase, { requirementId, linkId, planId, caseType = 'POSITIVE', reviewId = null }) {
  const type = String(caseType ?? '').toUpperCase();
  const requirement = (changeCase.artifacts?.requirements?.requirements ?? []).find((entry) => entry.id === requirementId);
  const link = requirement?.processRunEvidenceLinks?.find((entry) => entry.id === linkId);
  const plan = (changeCase.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === planId);
  if (!requirement || !link || !plan || !['POSITIVE', 'NEGATIVE', 'RECOVERY'].includes(type) || !verifyProcessBehaviorTestPlan(plan)
    || link.behaviorEvaluation?.planId !== plan.id || link.behaviorEvaluation?.planHash !== plan.planHash
    || link.status !== 'UNVERIFIED' || link.verificationStatus !== 'NOT_EXECUTED'
    || plan.caseId !== changeCase.id || plan.requirementId !== requirement.id
    || plan.draftRevision !== link.draftRevision || plan.requirementHash !== link.requirementHash) return null;
  const definition = plan.caseDefinitions?.cases?.find((entry) => entry.type === type);
  const assertion = plan.assertions?.find((entry) => entry.id === definition?.executionMapping?.assertionId);
  const mapping = definition?.executionMapping;
  if (!definition || !assertion || definition.status !== 'NOT_EXECUTED' || !definition.dataset || !definition.expectedOutput
    || mapping?.status !== 'OWNER_PROPOSED_UNVERIFIED'
    || !plan.repository?.selectedFiles?.some((entry) => entry.path === mapping.testPath && entry.contentHash === mapping.testFileHash)
    || mapping.repositorySnapshotId !== plan.repository.snapshotId || mapping.repositoryTreeDigest !== plan.repository.treeDigest) return null;
  const matchingReviews = (requirement.processRunEvidenceReviews ?? []).filter((entry) => entry.schemaVersion === 4
    && entry.linkId === link.id && entry.behaviorPlanId === plan.id && entry.behaviorPlanHash === plan.planHash
    && (!reviewId || entry.id === reviewId) && processEvidenceReviewState(changeCase, requirement, entry));
  const review = reviewId ? matchingReviews[0] : matchingReviews.sort((left, right) =>
    Number(left.recordedVersion ?? 0) - Number(right.recordedVersion ?? 0)
      || String(left.reviewedAt ?? '').localeCompare(String(right.reviewedAt ?? ''))
      || String(left.id).localeCompare(String(right.id))).at(-1);
  const scenarioReview = review?.scenarioCases?.find((scenario) => scenario.type === type);
  const linkCore = Object.fromEntries(Object.entries(link).filter(([key]) => key !== 'linkHash' && key !== 'applicability'));
  if (!review || review.integrityStatus !== 'VALID' || review.reviewerPrincipal === plan.createdBy || !link.run?.id
    || scenarioReview?.executionDecision !== 'APPROVE_FOR_TEST_EXECUTION'
    || scenarioReview.executionReviewStatus !== 'REVIEWED_FOR_TEST_EXECUTION'
    || scenarioReview.definitionHash !== digest(definition) || contentHash(scenarioReview.definition) !== contentHash(definition)
    || contentHash(linkCore) !== link.linkHash) return null;
  return { requirement, link, plan, definition, mapping, assertion, review };
}

export class PostgresChangeCaseStore extends PostgresDocumentStore {
  constructor(persistence) { super(persistence, 'change_case'); }
  async verifyRequirementCriterionContracts(current, client = null) {
    const query = client ? client.query.bind(client) : this.persistence.query.bind(this.persistence);
    for (const requirement of current.artifacts?.requirements?.requirements ?? []) {
      const history = requirement.criterionContractHistory ?? [];
      if (!requirement.criterionContract && !history.length) continue; // historical string-only criteria remain explicitly unclassified
      if (!Array.isArray(history) || !history.length || requirement.criterionContract?.contentHash !== history.at(-1)?.contentHash
        || history.length !== requirement.criterionContract.version) throw persistenceIntegrity('A versioned criterion contract has incomplete immutable history.');
      let priorFloor = [];
      for (let index = 0; index < history.length; index += 1) {
        const contract = history[index];
        if (contract.version !== index + 1 || !verifyRequirementCriterionContract(requirement, contract, { historical: true })
          || priorFloor.some((id) => !contract.mandatoryFloor.includes(id))) throw persistenceIntegrity('A requirement criterion revision failed its immutable version or mandatory-floor check.');
        priorFloor = contract.mandatoryFloor;
        const events = (current.events ?? []).filter((event) => event.type === 'RequirementCriterionBaselineRevised'
          && event.data?.requirementId === requirement.id && event.data?.criterionContractVersion === contract.version);
        if (events.length !== 1 || events[0].data.criterionContractHash !== contract.contentHash
          || events[0].data.draftRevision !== contract.draftRevision
          || !/^[a-f0-9]{64}$/.test(events[0].data.commandRequestHash ?? '')
          || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,159}$/.test(events[0].data.commandId ?? '')
          || events[0].contentHash !== contentHash({ type: events[0].type, tenantId: current.tenantId, data: events[0].data })) {
          throw persistenceIntegrity('A versioned requirement criterion has no unique matching revision event.');
        }
        const event = events[0];
        const audit = await query(`select event_hash,command_id,actor,aggregate_version,event from orgward.audit_log
          where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
        [current.tenantId, current.id, contentHash(event)]);
        const row = audit.rows[0];
        const commandId = event.data.commandId;
        const command = typeof commandId === 'string' ? current.idempotency?.[commandId] : null;
        if (!command || command.action !== 'edit-requirements' || command.requestHash !== event.data.commandRequestHash
          || Number(command.version) !== Number(event.aggregateVersion ?? row?.aggregate_version)) {
          throw persistenceIntegrity('A requirement criterion revision has no exact matching command record.');
        }
        if (audit.rowCount !== 1 || row.command_id !== commandId || row.actor !== event.actor
          || Number(row.aggregate_version) !== Number(event.aggregateVersion ?? command.version) || contentHash(row.event) !== contentHash(event)) {
          throw persistenceIntegrity('A requirement criterion revision has no matching durable audit record.');
        }
      }
    }
    for (const requirement of current.artifacts?.requirements?.requirements ?? []) {
      if (requirement.criterionContract && !verifyRequirementCriterionContract(requirement)) {
        throw persistenceIntegrity('The current criterion contract no longer matches the requirement priority or acceptance text.');
      }
    }
    return current;
  }
  async verifyProcessBehaviorTestPlans(current, client = null) {
    const plans = current.artifacts?.processBehaviorTestPlans ?? [];
    await PostgresChangeCaseStore.prototype.verifyRequirementCriterionContracts.call(this, current, client);
    if (!plans.length) return current;
    const query = client ? client.query.bind(client) : this.persistence.query.bind(this.persistence);
    const seen = new Set();
    for (const plan of plans) {
      if (!verifyProcessBehaviorTestPlan(plan) || seen.has(plan.id) || plan.tenantId !== current.tenantId
        || plan.projectId !== current.projectId || plan.caseId !== current.id) throw persistenceIntegrity('A process behavior test plan failed its immutable identity or hash check.');
      seen.add(plan.id);
      const requirement = (current.artifacts?.requirements?.requirements ?? []).find((entry) => entry.id === plan.requirementId);
      const historicalContract = requirement?.criterionContractHistory?.find((entry) => entry.version === plan.criterionContractVersion
        && entry.contentHash === plan.criterionContractHash);
      if (!requirement || !historicalContract || !verifyRequirementCriterionContract(requirement, historicalContract, { historical: true })
        || plan.assertions.length !== historicalContract.criteria.length
        || plan.assertions.some((assertion) => {
          const criterion = historicalContract.criteria.find((entry) => entry.id === assertion.criterionId);
          return !criterion || assertion.criterionHash !== contentHash(criterion)
            || assertion.criterionContractVersion !== historicalContract.version;
        })) throw persistenceIntegrity('A process behavior plan does not cover its exact retained criterion contract.');
      if (plan.schemaVersion >= 3) {
        const trace = requirement.processTrace;
        const context = plan.evaluationContext;
        const cases = plan.caseDefinitions?.cases ?? [];
        const tracedRefs = new Map([
          [trace.process.id, { type: 'process', snapshotHash: trace.source.processSnapshotHash }],
          ...(trace.process.inputs ?? []).map((entry) => [entry.id, { type: 'input', snapshotHash: entry.snapshotHash }]),
          ...(trace.process.outputs ?? []).map((entry) => [entry.id, { type: 'output', snapshotHash: entry.snapshotHash }]),
          ...(trace.scope.capabilityRefs ?? []).map((entry) => [entry.id, { type: entry.type, snapshotHash: entry.snapshotHash }]),
          ...(trace.scope.systemRefs ?? []).map((entry) => [entry.id, { type: entry.type, snapshotHash: entry.snapshotHash }]),
          ...(trace.scope.resourceRefs ?? []).map((entry) => [entry.id, { type: entry.type, snapshotHash: entry.snapshotHash }]),
          ...(trace.risk.refs ?? []).map((entry) => [entry.id, { type: 'risk', snapshotHash: entry.snapshotHash }]),
          ...(trace.outcome.metricRefs ?? []).map((entry) => [entry.id, { type: 'metric', snapshotHash: entry.snapshotHash }]),
        ]);
        const caseTypes = new Map([['POSITIVE', ['output', 'metric']], ['NEGATIVE', ['risk']],
          ['RECOVERY', ['process', 'input', 'output']]]);
        const casesValid = cases.length === 3 && [...caseTypes.keys()].every((type) => {
          const entry = cases.find((candidate) => candidate.type === type);
          const ref = tracedRefs.get(entry?.sourceRef?.id);
          const criterion = historicalContract.criteria.find((candidate) => candidate.id === entry?.criterionId);
          return entry?.status === 'NOT_EXECUTED' && entry.authoredBy === plan.createdBy
            && entry.sourceRef?.type === ref?.type && entry.sourceRef?.snapshotHash === ref?.snapshotHash
            && caseTypes.get(type).includes(ref?.type) && criterion && digest(criterion) === entry.criterionHash;
        });
        const timeSource = tracedRefs.get(context?.effectiveTime?.sourceRef?.id);
        if (context?.workspace?.projectId !== plan.projectId || context.workspace.blueprintId !== trace.source.blueprintId
          || context.workspace.blueprintVersion !== trace.source.blueprintVersion
          || context.workspace.processId !== trace.process.id || context.workspace.processTraceHash !== trace.traceHash
          || context.branch?.snapshotId !== plan.repository.source?.snapshotId
          || context.branch?.repositoryId !== plan.repository.source?.repositoryId
          || context.branch?.branchRef !== plan.repository.source?.branchRef
          || context.branch?.commitOid !== plan.repository.source?.commitOid
          || context.branch?.treeDigest !== plan.repository.treeDigest
          || context.effectiveTime?.status !== 'OWNER_ASSERTED' || context.effectiveTime.assertedBy !== plan.createdBy
          || timeSource?.type !== 'input' || context.effectiveTime.sourceRef.type !== 'input'
          || context.effectiveTime.sourceRef.snapshotHash !== timeSource.snapshotHash || !casesValid) {
          throw persistenceIntegrity('A process behavior plan context or scenario case is not bound to the exact saved project/process trace.');
        }
      }
      const events = (current.events ?? []).filter((event) => event.type === 'ProcessBehaviorTestPlanAuthorized' && event.data?.planId === plan.id);
      const expectedEventData = { planId: plan.id, planHash: plan.planHash, requirementId: plan.requirementId,
        requirementHash: plan.requirementHash, draftRevision: plan.draftRevision, traceHash: plan.traceHash,
        criterionContractVersion: plan.criterionContractVersion, criterionContractHash: plan.criterionContractHash,
        processPlanId: plan.processPlan.id, processPlanRevision: plan.processPlan.revision,
        taskId: plan.processPlan.taskId, repositoryHash: plan.repositoryHash,
        repositorySnapshotId: plan.repository.source?.snapshotId, repositoryTreeDigest: plan.repository.treeDigest,
        checkPlanHash: plan.checkPlan.hash, fileMappingsHash: contentHash(plan.fileMappings) };
      if (plan.schemaVersion >= 3) Object.assign(expectedEventData, {
        evaluationContextHash: contentHash(plan.evaluationContext), caseDefinitionsHash: contentHash(plan.caseDefinitions),
      });
      if (events.length !== 1 || contentHash(events[0].data) !== contentHash(expectedEventData)
        || events[0].contentHash !== contentHash({ type: 'ProcessBehaviorTestPlanAuthorized', tenantId: current.tenantId, data: events[0].data })) {
        throw persistenceIntegrity('A process behavior test plan has no unique matching authorization event.');
      }
      const event = events[0];
      const command = current.idempotency?.[event.causationId];
      if (!command || command.action !== 'authorize-process-behavior-test-plan' || command.planId !== plan.id
        || command.requestHash !== plan.requestHash || command.at !== plan.createdAt
        || Number(command.version) !== Number(event.aggregateVersion ?? command.version)
        || event.actor !== plan.createdBy || event.timestamp !== plan.createdAt) throw persistenceIntegrity('A process behavior test plan has no matching idempotent command.');
      const audit = await query(`select event_hash,command_id,actor,aggregate_version,event from orgward.audit_log
        where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
      [current.tenantId, current.id, contentHash(event)]);
      const row = audit.rows[0];
      if (audit.rowCount !== 1 || row.command_id !== event.causationId || row.actor !== event.actor
        || Number(row.aggregate_version) !== Number(command.version) || contentHash(row.event) !== contentHash(event)) {
        throw persistenceIntegrity('A process behavior test plan authorization event has no matching durable audit command.');
      }
    }
    return current;
  }
  async verifyProcessBehaviorEvaluations(current, client = null) {
    const query = client ? client.query.bind(client) : this.persistence.query.bind(this.persistence);
    for (const requirement of current.artifacts?.requirements?.requirements ?? []) {
      for (const link of requirement.processRunEvidenceLinks ?? []) {
        if (!link.behaviorEvaluation) continue;
        const { linkHash, applicability: _applicability, ...linkCore } = link;
        if (!/^[a-f0-9]{64}$/.test(linkHash ?? '') || contentHash(linkCore) !== linkHash
          || link.status !== 'UNVERIFIED' || link.verificationStatus !== 'NOT_EXECUTED') throw persistenceIntegrity('A behavior evidence link failed its content or status verification.');
        const behaviorPlan = (current.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === link.behaviorEvaluation.planId);
        if (!verifyProcessBehaviorTestPlan(behaviorPlan) || behaviorPlan.planHash !== link.behaviorEvaluation.planHash
          || behaviorPlan.caseId !== current.id || behaviorPlan.requirementId !== requirement.id) throw persistenceIntegrity('A behavior evaluation has no matching retained owner-authorized plan.');
        const runRow = await query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`,
          [current.tenantId, link.run?.id]);
        if (!runRow.rowCount) throw persistenceIntegrity('A behavior evaluation has no retained execution run.');
        const run = verifyAggregateRow(runRow.rows[0]);
        const expectedRunPlan = { caseId: current.id, planId: behaviorPlan.id, planHash: behaviorPlan.planHash,
          requirementId: behaviorPlan.requirementId, requirementHash: behaviorPlan.requirementHash,
          draftRevision: behaviorPlan.draftRevision, traceHash: behaviorPlan.traceHash, createdAt: behaviorPlan.createdAt,
          checkPlanHash: behaviorPlan.checkPlan.hash, criterionContractVersion: behaviorPlan.criterionContractVersion,
          criterionContractHash: behaviorPlan.criterionContractHash, fileMappings: behaviorPlan.fileMappings,
          fileMappingsHash: contentHash(behaviorPlan.fileMappings) };
        if (run.tenantId !== current.tenantId || run.projectId !== current.projectId
          || contentHash(run) !== link.run.aggregateHash
          || contentHash(run.processTaskRef?.behaviorTestPlan) !== contentHash(expectedRunPlan)) throw persistenceIntegrity('The retained execution run no longer matches its behavior-plan or link aggregate pin.');
        const runAudit = await query(`select count(*)::int as count from orgward.audit_log where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 and event_hash = any($3::text[])`,
          [current.tenantId, run.id, (run.events ?? []).map((event) => contentHash(event))]);
        if (Number(runAudit.rows[0]?.count) !== (run.events ?? []).length) throw persistenceIntegrity('A behavior evaluation run event is missing its durable audit record.');
        const expectedEvaluation = evaluateAuthorizedBehaviorPlan(run, behaviorPlan, requirement.processTrace,
          link.behaviorEvaluation.schemaVersion);
        if (!expectedEvaluation || contentHash(expectedEvaluation) !== contentHash(link.behaviorEvaluation)) throw persistenceIntegrity('The stored behavior evaluation no longer matches the persisted per-assertion run output.');
        const linkEvents = (current.events ?? []).filter((event) => event.type === 'ProcessRunEvidenceLinked' && event.data?.linkId === link.id);
        if (linkEvents.length !== 1 || linkEvents[0].data.linkHash !== linkHash
          || linkEvents[0].contentHash !== contentHash({ type: 'ProcessRunEvidenceLinked', tenantId: current.tenantId, data: linkEvents[0].data })) throw persistenceIntegrity('The behavior link has no unique matching append-only event.');
        const linkAudit = await query(`select count(*)::int as count from orgward.audit_log where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
          [current.tenantId, current.id, contentHash(linkEvents[0])]);
        if (Number(linkAudit.rows[0]?.count) !== 1) throw persistenceIntegrity('The behavior link event has no durable audit record.');
      }
    }
    return current;
  }
  async verifyProcessEvidenceReviews(current, client = null) {
    const query = client ? client.query.bind(client) : this.persistence.query.bind(this.persistence);
    for (const requirement of current.artifacts?.requirements?.requirements ?? []) {
      for (const review of requirement.processRunEvidenceReviews ?? []) {
        const verified = processEvidenceReviewState(current, requirement, review);
        const audit = verified ? await query(`select event_hash,command_id,actor,aggregate_version,event
          from orgward.audit_log where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
        [current.tenantId, current.id, contentHash(verified.event)]) : { rowCount: 0, rows: [] };
        const auditRow = audit.rows[0];
        review.integrityStatus = verified && audit.rowCount === 1
          && auditRow.event_hash === contentHash(verified.event)
          && contentHash(auditRow.event) === contentHash(verified.event)
          && auditRow.actor === verified.event.actor && auditRow.command_id === verified.event.causationId
          && Number(auditRow.aggregate_version) === Number(verified.event.aggregateVersion ?? verified.idempotency.version)
          ? 'VALID' : 'INVALID';
      }
    }
    return current;
  }
  async verifyProcessIntentEvaluationAcceptances(current, client = null) {
    const query = client ? client.query.bind(client) : this.persistence.query.bind(this.persistence);
    for (const acceptance of current.artifacts?.processIntentEvaluationAcceptances ?? []) {
        const requirement = (current.artifacts?.requirements?.requirements ?? [])
          .find((entry) => entry.id === acceptance.requirementId);
        const verified = processIntentEvaluationAcceptanceState(current, requirement, acceptance);
        const audit = verified ? await query(`select event_hash,command_id,actor,aggregate_version,event
          from orgward.audit_log where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
        [current.tenantId, current.id, contentHash(verified.event)]) : { rowCount: 0, rows: [] };
        const row = audit.rows[0];
        acceptance.integrityStatus = verified && audit.rowCount === 1
          && row.event_hash === contentHash(verified.event) && contentHash(row.event) === contentHash(verified.event)
          && row.actor === verified.event.actor && row.command_id === verified.event.causationId
          && Number(row.aggregate_version) === Number(verified.idempotency.version) ? 'VALID' : 'INVALID';
    }
    return current;
  }
  async acceptIntentEvaluation({ id: caseId, tenantId, principal, authzGeneration, requirementId,
    linkId, reviewId, expectedVersion, expectedDraftRevision, reason, commandId }) {
    if (!principal || !/^REQ-PROC-[a-f0-9]{12}$/.test(requirementId ?? '')
      || !/^process-run-link-[0-9a-f-]{36}$/i.test(linkId ?? '')
      || !/^process-evidence-review-[0-9a-f-]{36}$/i.test(reviewId ?? '')
      || !Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(expectedDraftRevision)
      || typeof reason !== 'string' || !reason.trim() || reason.length > 1000
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(commandId ?? '')) throw projectAccessDenied();
    const operation = 'sdlc.accept-intent-evaluation';
    const requestHash = contentHash({ caseId, requirementId, linkId, reviewId, expectedVersion,
      expectedDraftRevision, reason: reason.trim(), principal });
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintRow.rowCount) return null;
      const hint = verifyAggregateRow(hintRow.rows[0]);
      if (!hint.projectId) throw projectAccessDenied();
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'owner' });
      const caseRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!caseRow.rowCount) return null;
      const current = verifyAggregateRow(caseRow.rows[0]);
      if (current.projectId !== hint.projectId) throw conflict('The case project scope changed during acceptance.', current.version, 'PROJECT_SCOPE_CONFLICT');
      if (current.accountableOwner !== principal) throw projectAccessDenied();
      await this.verifyProcessEvidenceReviews(current, client);
      await this.verifyProcessBehaviorTestPlans(current, client);
      await this.verifyProcessBehaviorEvaluations(current, client);
      await this.verifyProcessIntentEvaluationAcceptances(current, client);
      const prior = current.idempotency?.[commandId];
      if (prior) {
        if (prior.action !== 'accept-intent-evaluation' || prior.requestHash !== requestHash) throw conflict('This command ID was already used with different acceptance input.', current.version, 'IDEMPOTENCY_CONFLICT');
        const acceptance = current.artifacts?.processIntentEvaluationAcceptances?.find((entry) => entry.id === prior.acceptanceId);
        const requirement = current.artifacts?.requirements?.requirements?.find((entry) => entry.id === acceptance?.requirementId);
        const verified = processIntentEvaluationAcceptanceState(current, requirement, acceptance);
        const audit = verified ? await client.query(`select event_hash,command_id,actor,aggregate_version,event
          from orgward.audit_log where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
        [tenantId, current.id, contentHash(verified.event)]) : { rowCount: 0, rows: [] };
        const row = audit.rows[0];
        if (!verified || audit.rowCount !== 1 || row.event_hash !== contentHash(verified.event)
          || contentHash(row.event) !== contentHash(verified.event) || row.actor !== verified.event.actor
          || row.command_id !== verified.event.causationId || Number(row.aggregate_version) !== Number(verified.idempotency.version)) {
          throw persistenceIntegrity('Acceptance replay does not match its retained review, evaluation, event, and audit pins.');
        }
        acceptance.integrityStatus = 'VALID';
        return { changeCase: current, acceptance, replayed: true };
      }
      if (current.version !== expectedVersion) throw conflict('The case changed before evaluation acceptance.', current.version);
      if (!current.sourceBinding || current.tenantId !== tenantId || !current.projectId
        || verifySourceBinding(current.sourceBinding).valid !== true) throw projectAccessDenied();
      const manifest = verifyContextManifest(current);
      if (!current.artifacts?.context || manifest.valid !== true) throw persistenceIntegrity('The saved context manifest is invalid; intent evaluation cannot be accepted.');
      const artifact = current.artifacts?.requirements;
      if (!artifact || artifact.acceptedBaseline || current.currentStage !== 'S4'
        || artifact.draftRevision !== expectedDraftRevision) throw conflict('The requirement draft changed or is no longer open.', current.version, 'REQUIREMENT_DRAFT_STALE');
      const requirement = artifact.requirements?.find((entry) => entry.id === requirementId && entry.processTrace && entry.criterionContract);
      if (!requirement) throw conflict('A current typed process requirement is required for acceptance.', current.version, 'PROCESS_REQUIREMENT_NOT_FOUND');
      const requirementCore = Object.fromEntries(Object.entries(requirement)
        .filter(([key]) => !['processRunEvidenceLinks', 'processRunEvidenceReviews', 'processIntentEvaluationAcceptances'].includes(key)));
      const requirementHash = contentHash(requirementCore);
      if ((current.artifacts?.processIntentEvaluationAcceptances ?? []).some((entry) => entry.requirementId === requirementId
        && entry.draftRevision === expectedDraftRevision && entry.requirementHash === requirementHash)) {
        throw conflict('This exact requirement revision already has an accepted intent evaluation.', current.version, 'INTENT_EVALUATION_ALREADY_ACCEPTED');
      }
      const link = requirement.processRunEvidenceLinks?.find((entry) => entry.id === linkId);
      const review = requirement.processRunEvidenceReviews?.find((entry) => entry.id === reviewId);
      const currentPlanId = link?.behaviorEvaluation?.planId;
      const currentPlanHash = link?.behaviorEvaluation?.planHash;
      const latestIndependentReview = requirement.processRunEvidenceReviews
        ?.filter((entry) => [3, 4].includes(entry.schemaVersion) && entry.linkId === link?.id
          && entry.behaviorPlanId === currentPlanId && entry.behaviorPlanHash === currentPlanHash
          && entry.integrityStatus === 'VALID' && entry.reviewerPrincipal !== principal
          && processEvidenceReviewState(current, requirement, entry))
        .sort((left, right) => Number(left.recordedVersion ?? 0) - Number(right.recordedVersion ?? 0)
          || String(left.reviewedAt ?? '').localeCompare(String(right.reviewedAt ?? ''))
          || String(left.id).localeCompare(String(right.id))).at(-1);
      if (!link || link.draftRevision !== expectedDraftRevision || link.requirementHash !== requirementHash
        || link.traceHash !== requirement.processTrace.traceHash || !link.behaviorEvaluation) throw conflict('Current checked behavior evidence is required.', current.version, 'INTENT_EVALUATION_EVIDENCE_INCOMPLETE');
      if (!review || review.id !== latestIndependentReview?.id || review.linkId !== link.id || review.requirementHash !== requirementHash
        || review.draftRevision !== expectedDraftRevision || review.traceHash !== requirement.processTrace.traceHash
        || review.integrityStatus !== 'VALID'
        || review.acceptanceStatus !== 'REVIEW_ONLY_NOT_ACCEPTED' || review.conflictResolution
        || review.criteria.some((entry) => entry.disposition !== 'SUPPORTED')
        || review.reviewerPrincipal === principal) throw conflict('A current independent review supporting every criterion is required.', current.version, 'INTENT_EVALUATION_REVIEW_INCOMPLETE');
      const evaluation = link.behaviorEvaluation;
      const declarations = requirement.criterionContract.criteria;
      const behaviorPlan = (current.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === evaluation.planId);
      if (evaluation.status !== 'CHECKED_BEHAVIOR' || evaluation.result !== 'TEST_PASS'
        || evaluation.businessTruthStatus !== 'UNVERIFIED' || evaluation.assertions.length !== declarations.length
        || !verifyProcessBehaviorTestPlan(behaviorPlan) || behaviorPlan.planHash !== evaluation.planHash
        || evaluation.assertions.some((assertion) => assertion.status !== 'TEST_PASS'
          || !behaviorPlan.assertions.some((planned) => planned.id === assertion.id
            && declarations.some((entry) => entry.id === planned.criterionId && digest(entry) === planned.criterionHash)))
        || review.criteria.length !== declarations.length
        || declarations.some((entry) => !review.criteria.some((reviewed) => reviewed.criterionId === entry.id
          && reviewed.criterionHash === digest(entry) && reviewed.disposition === 'SUPPORTED'))) {
        throw conflict('Every exact declared criterion needs a passing preauthorized behavior result and independent supporting review.', current.version, 'INTENT_EVALUATION_CRITERIA_INCOMPLETE');
      }
      const sourceIntegrity = verifySourceBinding(current.sourceBinding);
      if (sourceIntegrity.valid !== true) throw persistenceIntegrity('The saved source binding is invalid.');
      const trace = requirement.processTrace;
      const blueprintRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, current.projectId]);
      if (!blueprintRow.rowCount) throw projectAccessDenied();
      const project = verifyAggregateRow(blueprintRow.rows[0]);
      const blueprint = latestBlueprint(project);
      if (!blueprint || blueprint.id !== trace.source.blueprintId || blueprint.version !== trace.source.blueprintVersion
        || contentHash(blueprint) !== trace.source.blueprintSnapshotHash
        || trace.source.bindingHash !== current.sourceBinding.bindingHash) throw conflict('The exact saved project source is stale.', current.version, 'PROCESS_SOURCE_STALE');
      const acceptor = principal;
      const acceptedAt = new Date().toISOString();
      const artifactRecord = { schemaVersion: 1, id: `intent-evaluation-acceptance-${randomUUID()}`,
        tenantId, projectId: current.projectId, caseId: current.id, requirementId,
        draftRevision: expectedDraftRevision, requirementHash, traceHash: trace.traceHash,
        criterionContractVersion: requirement.criterionContract.version,
        criterionContractHash: requirement.criterionContract.contentHash,
        source: structuredClone(link.source), linkId: link.id, linkHash: link.linkHash,
        reviewId: review.id, reviewHash: review.reviewHash, evaluationHash: contentHash(evaluation),
        acceptedBy: acceptor, acceptedAt, reason: reason.trim(), requestHash,
        recordedVersion: current.version + 1, status: 'ACCEPTED',
        verificationStatus: 'NOT_EXECUTED', truthStatus: 'UNVERIFIED',
        statement: 'This accepts the current scoped intent evaluation record only. It does not establish external business truth or runtime verification.' };
      const acceptance = { ...artifactRecord, acceptanceHash: contentHash(artifactRecord) };
      current.artifacts.processIntentEvaluationAcceptances ??= [];
      current.artifacts.processIntentEvaluationAcceptances.push(acceptance);
      current.version += 1; current.updatedAt = acceptedAt;
      current.idempotency ??= {};
      current.idempotency[commandId] = { action: 'accept-intent-evaluation', requestHash,
        acceptanceId: acceptance.id, version: current.version, at: acceptedAt };
      const eventData = { acceptanceId: acceptance.id, acceptanceHash: acceptance.acceptanceHash,
        requirementId, requirementHash, draftRevision: expectedDraftRevision, traceHash: trace.traceHash,
        criterionContractVersion: acceptance.criterionContractVersion, criterionContractHash: acceptance.criterionContractHash,
        linkId: link.id, linkHash: link.linkHash, reviewId: review.id, reviewHash: review.reviewHash,
        evaluationHash: acceptance.evaluationHash, acceptedBy: principal, requestHash,
        recordedVersion: acceptance.recordedVersion, status: 'ACCEPTED',
        verificationStatus: 'NOT_EXECUTED', truthStatus: 'UNVERIFIED' };
      current.events.push({ id: `event-${randomUUID()}`, type: 'IntentEvaluationAccepted', schemaVersion: 1,
        tenantId, actor: principal, correlationId: current.correlationId, causationId: commandId,
        timestamp: acceptedAt, data: eventData,
        contentHash: contentHash({ type: 'IntentEvaluationAccepted', tenantId, data: eventData }) });
      await this.saveInTransaction(client, current, { expectedVersion, principal,
        requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      acceptance.integrityStatus = 'VALID';
      return { changeCase: current, acceptance, replayed: false };
    });
  }
  async verifyRepositoryCheckObservations(current, client = null) {
    const observations = current.artifacts?.repositoryCheckObservations ?? [];
    if (!observations.length) return current;
    const query = client ? client.query.bind(client) : this.persistence.query.bind(this.persistence);
    const observationIds = new Set();
    const proposals = current.artifacts?.repositoryCheckProposals ?? [];
    for (const observation of observations) {
      if (!observation || observationIds.has(observation.id)) throw persistenceIntegrity('A repository-check observation has a duplicate or missing identity.');
      observationIds.add(observation.id);
      const { contentHash: recordHash, ...recordCore } = observation;
      if (!/^[a-f0-9]{64}$/.test(recordHash ?? '') || contentHash(recordCore) !== recordHash
        || observation.tenantId !== current.tenantId || observation.projectId !== current.projectId
        || observation.caseId !== current.id || observation.category !== 'REPOSITORY_CHECK'
        || observation.businessTruthStatus !== 'UNVERIFIED' || observation.verificationStatus !== 'NOT_EXECUTED'
        || observation.causality !== 'HYPOTHESIS') throw persistenceIntegrity('A persisted repository-check observation failed its content or scope verification.');
      const retainedLink = (current.artifacts?.requirements?.requirements ?? []).flatMap((requirement) => requirement.processRunEvidenceLinks ?? [])
        .find((link) => link.id === observation.linkId && link.linkHash === observation.linkHash);
      if (!retainedLink || retainedLink.tenantId !== current.tenantId || retainedLink.projectId !== current.projectId
        || retainedLink.run?.id !== observation.runId || retainedLink.repositoryCheckEvidenceStatus !== 'AVAILABLE'
        || contentHash(retainedLink.repositoryCheckEvidence) !== contentHash(observation.checks)) {
        throw persistenceIntegrity('A repository-check observation no longer matches its retained evidence link.');
      }
      const events = (current.events ?? []).filter((event) => event.type === 'RepositoryCheckObserved' && event.data?.observationId === observation.id);
      if (events.length !== 1) throw persistenceIntegrity('A repository-check observation has no unique append-only event.');
      const event = events[0];
      const proposal = proposals.find((entry) => entry.id === event.data?.proposalId);
      if (event.data.observationHash !== recordHash || event.data.linkId !== observation.linkId
        || event.data.linkHash !== observation.linkHash || event.data.runId !== observation.runId
        || event.data.runAggregateHash !== observation.runAggregateHash
        || event.data.verificationStatus !== 'NOT_EXECUTED' || event.data.businessTruthStatus !== 'UNVERIFIED'
        || event.contentHash !== contentHash({ type: 'RepositoryCheckObserved', tenantId: current.tenantId, data: event.data })) {
        throw persistenceIntegrity('The repository-check observation event does not match its evidence pins.');
      }
      if (!proposal || proposal.type !== 'DESIGN_CORRECTION_CLAIM' || proposal.status !== 'PROPOSED_NOT_APPLIED'
        || proposal.authorityRequired !== true || proposal.businessTruthStatus !== 'UNVERIFIED'
        || proposal.verificationStatus !== 'NOT_EXECUTED' || proposal.causality !== 'HYPOTHESIS'
        || proposal.evidence?.observationId !== observation.id || proposal.evidence?.observationHash !== recordHash
        || proposal.evidence?.runId !== observation.runId || proposal.evidence?.runAggregateHash !== observation.runAggregateHash
        || proposal.evidence?.terminalEventHash !== observation.terminalEventHash
        || contentHash(proposal.evidence?.checks) !== contentHash(observation.checks)) {
        throw persistenceIntegrity('The repository-check proposal does not match its non-authorizing observation.');
      }
      const { contentHash: proposalHash, ...proposalCore } = proposal;
      if (!/^[a-f0-9]{64}$/.test(proposalHash ?? '') || contentHash(proposalCore) !== proposalHash
        || event.data.proposalHash !== proposalHash) throw persistenceIntegrity('The repository-check proposal failed its content or event binding verification.');
      const idempotency = current.idempotency?.[event.causationId];
      if (!idempotency || idempotency.action !== 'observe-repository-check' || idempotency.observationId !== observation.id) {
        throw persistenceIntegrity('The repository-check observation has no matching idempotency record.');
      }
      const audit = await query(`select event_hash,command_id,actor,aggregate_version,event from orgward.audit_log
        where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
      [current.tenantId, current.id, contentHash(event)]);
      const auditRow = audit.rows[0];
      if (audit.rowCount !== 1 || auditRow.event_hash !== contentHash(event)
        || contentHash(auditRow.event) !== contentHash(event) || auditRow.command_id !== event.causationId
        || auditRow.actor !== event.actor || Number(auditRow.aggregate_version) !== Number(idempotency.version)) {
        throw persistenceIntegrity('The repository-check observation event has no matching durable audit command.');
      }
    }
    return current;
  }
  async get(id, tenantId = null) {
    const current = await super.get(id, tenantId);
    if (!current) return null;
    await this.verifyProcessEvidenceReviews(current);
    await this.verifyProcessBehaviorTestPlans(current);
    await this.verifyProcessBehaviorEvaluations(current);
    await this.verifyProcessIntentEvaluationAcceptances(current);
    await this.verifyRepositoryCheckObservations(current);
    await this.verifyProcessBehaviorScenarioExecutions(current);
    await this.verifyProcessBehaviorProductHarnessMappings(current);
    const verifiedProductHarnessExecutions = await this.verifyT91N2AuthorizationExecutions(current);
    current.artifacts ??= {};
    current.artifacts.processBehaviorProductHarnessExecutionIntegrity = verifiedProductHarnessExecutions.receipts;
    return current;
  }
  async verifyProcessBehaviorProductHarnessMappings(current, client = null) {
    const query = client ? client.query.bind(client) : this.persistence.query.bind(this.persistence);
    const mappings = current.artifacts?.processBehaviorProductHarnessMappings ?? [];
    const reviews = current.artifacts?.processBehaviorProductHarnessMappingReviews ?? [];
    if (!Array.isArray(mappings) || !Array.isArray(reviews)) throw persistenceIntegrity('Product-harness mapping records are malformed.');
    const requirements = current.artifacts?.requirements?.requirements ?? [];
    const eventFor = (type, id) => {
      const found = current.events.filter((event) => event.type === type && event.data?.recordId === id);
      return found.length === 1 ? found[0] : null;
    };
    const auditEvent = async (event, actor, commandId, version) => {
      if (!event || event.actor !== actor || event.causationId !== commandId
        || event.contentHash !== contentHash({ type: event.type, tenantId: current.tenantId, data: event.data })) return false;
      const result = await query(`select event_hash,command_id,actor,aggregate_version,event from orgward.audit_log
        where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
      [current.tenantId, current.id, contentHash(event)]);
      const row = result.rows[0];
      return result.rowCount === 1 && row.event_hash === contentHash(event) && contentHash(row.event) === contentHash(event)
        && row.command_id === commandId && row.actor === actor && Number(row.aggregate_version) === Number(version);
    };
    const seen = new Set();
    for (const mapping of mappings) {
      const plan = (current.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === mapping.planId);
      const requirement = requirements.find((entry) => entry.id === mapping.requirementId);
      const expected = mapping?.subcaseId === 'N1'
        ? buildT91N1OrphanPathMapping({ changeCase: current, requirement, plan })
        : mapping?.subcaseId === 'R1'
        ? buildT91R1RecoveryMapping({ changeCase: current, requirement, plan })
        : mapping?.subcaseId === 'R2'
        ? buildT91R2RecoveryMapping({ changeCase: current, requirement, plan,
          selectedRequirementSnapshot: mapping.selectedRequirementSnapshot,
          otherRequirementSnapshot: mapping.otherRequirementSnapshot })
        : mapping?.subcaseId === 'N3'
        ? buildT91N3DeletedFailingTestMapping({ changeCase: current, requirement, plan })
        : mapping?.subcaseId === 'N2.MISSING_ASSERTION'
        ? buildT91N2MissingAssertionMapping({ changeCase: current, requirement, plan })
        : buildT91N2AuthorizationMapping({ changeCase: current, requirement, plan });
      const { mappingHash, integrityStatus: _integrityStatus, ...core } = mapping ?? {};
      const command = current.idempotency?.[mapping?.commandId];
      const event = eventFor('ProcessBehaviorProductHarnessMappingRequested', mapping?.id);
      if (!expected || seen.has(mapping.id) || !/^product-behavior-harness-mapping-[0-9a-f-]{36}$/i.test(mapping.id ?? '')
        || !verifyT91N2AuthorizationMapping({ ...core, mappingHash }, expected)
        || mapping.mappingHash !== event?.data?.mappingHash || event?.data?.requestedBy !== mapping.requestedBy
        || event?.data?.requestedAt !== mapping.requestedAt || event?.timestamp !== mapping.requestedAt
        || event?.data?.commandId !== mapping.commandId || event?.data?.requestHash !== mapping.requestHash
        || (mapping.subcaseId === 'R2' && (event?.data?.draftRevision !== mapping.draftRevision
          || event?.data?.selectedRequirementSnapshotHash !== mapping.selectedRequirementHash
          || event?.data?.otherRequirementSnapshotHash !== mapping.otherRequirementSnapshotHash
          || mapping.selectedRequirementSnapshotHash !== mapping.selectedRequirementHash))
        || !command || command.action !== 'request-product-behavior-harness-mapping'
        || command.requestHash !== mapping.requestHash || command.mappingId !== mapping.id
        || !await auditEvent(event, mapping.requestedBy, mapping.commandId, command.version)) {
        throw persistenceIntegrity('A product-harness mapping failed its exact parent pins, event, command, or audit verification.');
      }
      mapping.integrityStatus = 'VALID';
      const matchingReviews = reviews.filter((entry) => entry.mappingId === mapping.id);
      if (matchingReviews.length > 1) throw persistenceIntegrity('A product-harness mapping has multiple review decisions.');
      const mappingDefinition = plan?.caseDefinitions?.cases?.find((entry) => entry.type
        === (['R1', 'R2'].includes(mapping.subcaseId) ? 'RECOVERY' : 'NEGATIVE'));
      for (const review of matchingReviews) {
        const { reviewHash, integrityStatus: _reviewIntegrity, ...reviewCore } = review;
        const reviewCommand = current.idempotency?.[review.commandId];
        const reviewEvent = eventFor('ProcessBehaviorProductHarnessMappingReviewed', review.id);
        if (review.schemaVersion !== 1 || contentHash(reviewCore) !== reviewHash
          || review.mappingHash !== mapping.mappingHash || review.mappingId !== mapping.id
          || !isIndependentT91N2MappingReviewer({ reviewerPrincipal: review.reviewerPrincipal,
            mappingRequester: mapping.requestedBy, planAuthor: plan?.createdBy, definitionAuthor: mappingDefinition?.authoredBy })
          || !['APPROVE_FOR_TEST_EXECUTION', 'REQUEST_CHANGES'].includes(review.decision)
          || reviewEvent?.data?.reviewerPrincipal !== review.reviewerPrincipal || reviewEvent?.data?.reviewedAt !== review.reviewedAt
          || reviewEvent?.timestamp !== review.reviewedAt || reviewEvent?.data?.commandId !== review.commandId
          || reviewEvent?.data?.requestHash !== review.requestHash || reviewEvent?.data?.status !== review.status
          || reviewCommand?.action !== 'review-product-behavior-harness-mapping'
          || reviewCommand.requestHash !== review.requestHash || reviewCommand.reviewId !== review.id
          || reviewEvent?.data?.reviewHash !== reviewHash
          || !await auditEvent(reviewEvent, review.reviewerPrincipal, review.commandId, reviewCommand.version)) {
          throw persistenceIntegrity('A product-harness mapping review failed its immutable pins or independent audit verification.');
        }
        review.integrityStatus = 'VALID';
      }
      seen.add(mapping.id);
    }
    for (const event of current.events.filter((entry) => ['ProcessBehaviorProductHarnessMappingRequested', 'ProcessBehaviorProductHarnessMappingReviewed'].includes(entry.type))) {
      const records = event.type === 'ProcessBehaviorProductHarnessMappingRequested' ? mappings : reviews;
      if (records.filter((entry) => entry.id === event.data?.recordId).length !== 1) throw persistenceIntegrity('A product-harness mapping event has no unique persisted record.');
    }
    return current;
  }
  async verifyT91N2AuthorizationExecutions(current, client = null) {
    const query = client ? client.query.bind(client) : this.persistence.query.bind(this.persistence);
    const reservations = current.artifacts?.processBehaviorProductHarnessExecutionReservations ?? [];
    const receipts = current.artifacts?.processBehaviorProductHarnessExecutions ?? [];
    if (!Array.isArray(reservations) || !Array.isArray(receipts)) throw persistenceIntegrity('Product-harness execution records are malformed.');
    const eventFor = (type, id) => {
      const found = current.events.filter((event) => event.type === type && event.data?.recordId === id);
      return found.length === 1 ? found[0] : null;
    };
    const audited = async (event, actor, commandId, version) => {
      if (!event || event.actor !== actor || event.causationId !== commandId
        || event.contentHash !== contentHash({ type: event.type, tenantId: current.tenantId, data: event.data })) return false;
      const rows = await query(`select event_hash,command_id,actor,aggregate_version,event from orgward.audit_log
        where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
      [current.tenantId, current.id, contentHash(event)]);
      const row = rows.rows[0];
      return rows.rowCount === 1 && row.event_hash === contentHash(event) && contentHash(row.event) === contentHash(event)
        && row.command_id === commandId && row.actor === actor && Number(row.aggregate_version) === Number(version);
    };
    const reservationIds = new Set();
    for (const reservation of reservations) {
      const { reservationHash, integrityStatus: _integrityStatus, ...core } = reservation ?? {};
      const mapping = (current.artifacts?.processBehaviorProductHarnessMappings ?? []).find((entry) => entry.id === reservation?.mappingId);
      const review = (current.artifacts?.processBehaviorProductHarnessMappingReviews ?? []).find((entry) => entry.mappingId === reservation?.mappingId);
      const command = current.idempotency?.[reservation?.commandId];
      const event = eventFor('ProcessBehaviorProductHarnessExecutionReserved', reservation?.id);
      if (reservationIds.has(reservation?.id) || contentHash(core) !== reservationHash
        || reservation.schemaVersion !== 1 || !['N1', 'N2.AUTHORIZATION', 'N2.MISSING_ASSERTION', 'N3', 'R1', 'R2'].includes(reservation.subcaseId)
        || reservation.subcaseId !== mapping?.subcaseId
        || (reservation.subcaseId === 'N1' && (reservation.candidatePath !== mapping.candidatePath
          || event?.data?.candidatePath !== mapping.candidatePath))
        || (reservation.subcaseId === 'N3' && (reservation.candidatePath !== mapping.candidatePath
          || reservation.sourceTestBytesHash !== mapping.sourceTestBytesHash
          || reservation.sourceExpectedExitCode !== mapping.sourceExpectedExitCode
          || reservation.fixtureTemplateHash !== mapping.fixtureTemplateHash
          || event?.data?.candidatePath !== mapping.candidatePath
          || event?.data?.sourceTestBytesHash !== mapping.sourceTestBytesHash
          || event?.data?.fixtureTemplateHash !== mapping.fixtureTemplateHash))
        || (reservation.subcaseId === 'R1' && (reservation.oldPlanId !== mapping.oldPlanId
          || reservation.oldPlanHash !== mapping.oldPlanHash || reservation.oldLinkId !== mapping.oldLinkId
          || reservation.oldLinkHash !== mapping.oldLinkHash || reservation.oldRunId !== mapping.oldRunId
          || reservation.fixtureTemplateHash !== mapping.fixtureTemplateHash
          || event?.data?.oldPlanHash !== mapping.oldPlanHash || event?.data?.oldLinkHash !== mapping.oldLinkHash
          || event?.data?.fixtureTemplateHash !== mapping.fixtureTemplateHash))
        || (reservation.subcaseId === 'R2' && (reservation.oldPlanId !== mapping.oldPlanId
          || reservation.oldPlanHash !== mapping.oldPlanHash || reservation.oldLinkId !== mapping.oldLinkId
          || reservation.oldLinkHash !== mapping.oldLinkHash || reservation.oldRunId !== mapping.oldRunId
          || reservation.selectedRequirementHash !== mapping.selectedRequirementHash
          || reservation.otherRequirementId !== mapping.otherRequirementId
          || reservation.otherRequirementHash !== mapping.otherRequirementHash
          || reservation.fixtureTemplateHash !== mapping.fixtureTemplateHash
          || event?.data?.oldPlanHash !== mapping.oldPlanHash || event?.data?.oldLinkHash !== mapping.oldLinkHash
          || event?.data?.selectedRequirementHash !== mapping.selectedRequirementHash
          || event?.data?.otherRequirementId !== mapping.otherRequirementId
          || event?.data?.otherRequirementHash !== mapping.otherRequirementHash
          || event?.data?.fixtureTemplateHash !== mapping.fixtureTemplateHash))
        || !verifyT91N2AuthorizationReservationPins({ reservation, event, mapping, review, current })
        || reservation.mappingHash !== event?.data?.mappingHash || reservation.requestHash !== event?.data?.requestHash
        || (reservation.subcaseId === 'N2.MISSING_ASSERTION' && (reservation.requiredPlanAssertionId !== event?.data?.requiredPlanAssertionId
          || reservation.requiredPlanAssertionName !== event?.data?.requiredPlanAssertionName
          || reservation.requiredPlanAssertionHash !== event?.data?.requiredPlanAssertionHash))
        || reservation.fixtureRequestHash !== event?.data?.fixtureRequestHash
        || !/^[a-f0-9]{64}$/.test(reservation.fixtureRequestHash ?? '')
        || event?.timestamp !== reservation.reservedAt || event?.data?.reservedAt !== reservation.reservedAt
        || event?.data?.commandId !== reservation.commandId || event?.data?.aggregateVersion !== reservation.reservationVersion
        || command?.action !== 'execute-product-behavior-harness-subcase'
        || command.requestHash !== reservation.requestHash || command.reservationId !== reservation.id
        || !await audited(event, reservation.requestedBy, reservation.commandId, reservation.reservationVersion)) {
        throw persistenceIntegrity('A product-harness execution reservation failed immutable event, command, or audit verification.');
      }
      reservationIds.add(reservation.id);
    }
    const receiptIds = new Set();
    for (const receipt of receipts) {
      const { receiptHash, integrityStatus: _integrityStatus, ...core } = receipt ?? {};
      const reservation = reservations.find((entry) => entry.id === receipt?.reservationId);
      const mapping = (current.artifacts?.processBehaviorProductHarnessMappings ?? []).find((entry) => entry.id === receipt?.mappingId);
      const review = (current.artifacts?.processBehaviorProductHarnessMappingReviews ?? []).find((entry) => entry.mappingId === receipt?.mappingId);
      const command = current.idempotency?.[receipt?.commandId];
      const event = eventFor('ProcessBehaviorProductHarnessSubcaseExecuted', receipt?.id);
      const legacyReceipt = [1, 2].includes(receipt?.schemaVersion);
      const invocationReceipt = receipt?.schemaVersion === 4;
      const supportedReceiptSubcase = receipt?.schemaVersion === 4
        ? ['N1', 'N2.AUTHORIZATION', 'N2.MISSING_ASSERTION', 'N3', 'R1', 'R2'].includes(receipt?.subcaseId)
        : receipt?.subcaseId === 'N2.AUTHORIZATION';
      const classification = legacyReceipt || !mapping || !reservation ? null
        : receipt?.subcaseId === 'R1' ? classifyT91R1RecoveryObservation({
          observation: { terminal: receipt?.terminal === true, fixtureHash: receipt?.fixtureHash,
            fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId,
            reservationHash: receipt?.reservationHash, fixtureCaseId: receipt?.fixtureCaseId,
            old: receipt?.recovery?.old,
            staleAttempt: receipt?.recovery?.staleAttempt, fresh: receipt?.recovery?.fresh }, mapping,
          requestHash: reservation?.fixtureRequestHash, fixtureTemplateHash: mapping?.fixtureTemplateHash,
          invocationId: receipt?.fixtureInvocationId, reservationHash: receipt?.reservationHash ?? 'missing',
        }) : receipt?.subcaseId === 'R2' ? classifyT91R2RecoveryObservation({
          observation: { terminal: receipt?.terminal === true, fixtureHash: receipt?.fixtureHash,
            fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId,
            reservationHash: receipt?.reservationHash, fixtureCaseId: receipt?.fixtureCaseId,
            old: receipt?.recovery?.old, staleAttempt: receipt?.recovery?.staleAttempt,
            fresh: receipt?.recovery?.fresh }, mapping,
          requestHash: reservation?.fixtureRequestHash, fixtureTemplateHash: mapping?.fixtureTemplateHash,
          invocationId: receipt?.fixtureInvocationId, reservationHash: receipt?.reservationHash ?? 'missing',
        }) : receipt?.subcaseId === 'N1' ? classifyT91N1OrphanPathObservation({
          observation: { terminal: receipt?.terminal === true, fixtureHash: receipt?.fixtureHash,
            fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId,
            reservationHash: receipt?.reservationHash, source: receipt?.source, candidate: receipt?.candidate,
            run: receipt?.run, verifierDispatchCount: receipt?.verifierDispatchCount }, mapping,
          requestHash: reservation?.fixtureRequestHash, fixtureTemplateHash: receipt?.fixtureTemplateHash,
          invocationId: receipt?.fixtureInvocationId, reservationHash: receipt?.reservationHash ?? 'missing',
        }) : receipt?.subcaseId === 'N3' ? classifyT91N3DeletedFailingTestObservation({
          observation: { terminal: receipt?.terminal === true, fixtureHash: receipt?.fixtureHash,
            fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId,
            reservationHash: receipt?.reservationHash, sourceStage: receipt?.sourceStage,
            candidate: receipt?.candidate, run: receipt?.run, verifierDispatchCount: receipt?.verifierDispatchCount }, mapping,
          requestHash: reservation?.fixtureRequestHash, fixtureTemplateHash: receipt?.fixtureTemplateHash,
          invocationId: receipt?.fixtureInvocationId, reservationHash: receipt?.reservationHash ?? 'missing',
        }) : receipt?.subcaseId === 'N2.MISSING_ASSERTION' ? classifyT91N2MissingAssertionObservation({
          observation: { terminal: receipt?.terminal === true, fixtureHash: receipt?.fixtureHash,
            fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId,
            reservationHash: receipt?.reservationHash, fixturePlan: receipt?.fixturePlan,
            run: receipt?.run, attempt: receipt?.attempt }, mapping,
          requestHash: reservation?.fixtureRequestHash, fixtureTemplateHash: receipt?.fixtureTemplateHash,
          invocationId: receipt?.fixtureInvocationId, reservationHash: receipt?.reservationHash ?? 'missing',
        }) : classifyT91N2AuthorizationObservation({
        observation: { terminal: receipt?.terminal === true, fixtureHash: receipt?.fixtureHash,
          fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId,
          reservationHash: receipt?.reservationHash,
          control: receipt?.control, attempt: receipt?.attempt }, mapping,
        requestHash: reservation?.fixtureRequestHash,
        ...(invocationReceipt ? { fixtureTemplateHash: receipt?.fixtureTemplateHash,
          invocationId: receipt?.fixtureInvocationId, reservationHash: receipt?.reservationHash ?? 'missing' } : {}),
      });
      const expectedFixtureHash = receipt?.subcaseId === 'R1'
        ? t91R1RecoveryFixtureHash({ mapping, requestHash: reservation?.fixtureRequestHash,
          fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId })
        : receipt?.subcaseId === 'R2'
        ? t91R2RecoveryFixtureHash({ mapping, requestHash: reservation?.fixtureRequestHash,
          fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId })
        : receipt?.subcaseId === 'N1'
        ? t91N1OrphanPathFixtureHash({ mapping, requestHash: reservation?.fixtureRequestHash,
          fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId })
        : receipt?.subcaseId === 'N3'
        ? t91N3DeletedFailingTestFixtureHash({ mapping, requestHash: reservation?.fixtureRequestHash,
          fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId })
        : receipt?.subcaseId === 'N2.MISSING_ASSERTION'
        ? t91N2MissingAssertionFixtureHash({ mapping, requestHash: reservation?.fixtureRequestHash,
          fixtureTemplateHash: receipt?.fixtureTemplateHash, invocationId: receipt?.fixtureInvocationId })
        : invocationReceipt && typeof receipt?.fixtureInvocationId === 'string'
        && receipt.fixtureTemplateHash === T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH
        ? t91N2AuthorizationInvocationFixtureHash({ mapping, requestHash: reservation?.fixtureRequestHash,
          fixtureTemplateHash: T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH, invocationId: receipt.fixtureInvocationId })
        : t91N2AuthorizationFixtureHash({ mapping, requestHash: reservation?.fixtureRequestHash });
      const pinnedTemplateHash = receipt?.subcaseId === 'R1' ? mapping?.fixtureTemplateHash
        : receipt?.subcaseId === 'R2' ? mapping?.fixtureTemplateHash
        : receipt?.subcaseId === 'N3'
        ? mapping?.fixtureTemplateHash : T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH;
      if (!reservation || !mapping || !review || review.integrityStatus !== 'VALID'
        || receiptIds.has(receipt?.id) || ![1, 2, 3, 4].includes(receipt.schemaVersion) || !supportedReceiptSubcase
        || contentHash(core) !== receiptHash || receipt.mappingHash !== mapping.mappingHash
        || reservation.tenantId !== current.tenantId || reservation.projectId !== current.projectId
        || reservation.caseId !== current.id || reservation.mappingId !== mapping.id
        || reservation.subcaseId !== receipt.subcaseId || receipt.subcaseId !== mapping.subcaseId
        || reservation.mappingHash !== mapping.mappingHash || reservation.reviewId !== review.id
        || reservation.reviewHash !== review.reviewHash || reservation.planId !== mapping.planId
        || reservation.planHash !== mapping.planHash || contentHash(reservation.sourceRef) !== contentHash(mapping.sourceRef)
        || reservation.repositorySnapshotId !== mapping.repositorySnapshotId
        || reservation.repositoryTreeDigest !== mapping.repositoryTreeDigest
        || reservation.criterionId !== mapping.criterionId || reservation.criterionHash !== mapping.criterionHash
        || reservation.criterionContractVersion !== mapping.criterionContractVersion
        || reservation.criterionContractHash !== mapping.criterionContractHash
        || reservation.parentDefinitionHash !== mapping.parentDefinitionHash
        || reservation.datasetHash !== mapping.datasetHash || reservation.oracleHash !== mapping.oracleHash
        || reservation.harnessId !== mapping.harnessId || reservation.harnessVersion !== mapping.harnessVersion
        || reservation.harnessHash !== mapping.harnessHash || reservation.assertionId !== mapping.assertionId
        || reservation.assertionHash !== mapping.assertionHash
        || (reservation.subcaseId === 'N1' && (reservation.candidatePath !== mapping.candidatePath
          || receipt.candidatePath !== mapping.candidatePath || event?.data?.candidatePath !== mapping.candidatePath))
        || (reservation.subcaseId === 'N3' && (reservation.candidatePath !== mapping.candidatePath
          || receipt.candidatePath !== mapping.candidatePath || event?.data?.candidatePath !== mapping.candidatePath
          || reservation.sourceTestBytesHash !== mapping.sourceTestBytesHash
          || receipt.sourceTestBytesHash !== mapping.sourceTestBytesHash
          || receipt.sourceExpectedExitCode !== mapping.sourceExpectedExitCode
          || reservation.fixtureTemplateHash !== mapping.fixtureTemplateHash
          || !isValidT91N3ReceiptObservedPins(receipt, mapping)
          || event?.data?.sourceTestBytesHash !== mapping.sourceTestBytesHash
          || event?.data?.fixtureTemplateHash !== receipt.fixtureTemplateHash
          || contentHash(event?.data?.sourceStage ?? null) !== contentHash(receipt.sourceStage ?? null)
          || contentHash(event?.data?.candidate ?? null) !== contentHash(receipt.candidate ?? null)))
        || (reservation.subcaseId === 'R1' && (reservation.oldPlanId !== mapping.oldPlanId
          || reservation.oldPlanHash !== mapping.oldPlanHash || reservation.oldLinkId !== mapping.oldLinkId
          || reservation.oldLinkHash !== mapping.oldLinkHash || reservation.oldRunId !== mapping.oldRunId
          || reservation.fixtureTemplateHash !== mapping.fixtureTemplateHash
          || receipt.oldPlanId !== mapping.oldPlanId || receipt.oldPlanHash !== mapping.oldPlanHash
          || receipt.oldLinkId !== mapping.oldLinkId || receipt.oldLinkHash !== mapping.oldLinkHash
          || receipt.oldRunId !== mapping.oldRunId
          || (receipt.fixtureInvocationId !== null && receipt.fixtureTemplateHash !== mapping.fixtureTemplateHash)
          || contentHash(event?.data?.recovery ?? null) !== contentHash(receipt.recovery ?? null)
          || event?.data?.oldPlanHash !== mapping.oldPlanHash || event?.data?.oldLinkHash !== mapping.oldLinkHash
          || (receipt.fixtureInvocationId !== null && event?.data?.fixtureTemplateHash !== mapping.fixtureTemplateHash)))
        || (reservation.subcaseId === 'R2' && (reservation.oldPlanId !== mapping.oldPlanId
          || reservation.oldPlanHash !== mapping.oldPlanHash || reservation.oldLinkId !== mapping.oldLinkId
          || reservation.oldLinkHash !== mapping.oldLinkHash || reservation.oldRunId !== mapping.oldRunId
          || reservation.selectedRequirementHash !== mapping.selectedRequirementHash
          || reservation.otherRequirementId !== mapping.otherRequirementId
          || reservation.otherRequirementHash !== mapping.otherRequirementHash
          || reservation.fixtureTemplateHash !== mapping.fixtureTemplateHash
          || receipt.oldPlanId !== mapping.oldPlanId || receipt.oldPlanHash !== mapping.oldPlanHash
          || receipt.oldLinkId !== mapping.oldLinkId || receipt.oldLinkHash !== mapping.oldLinkHash
          || receipt.oldRunId !== mapping.oldRunId
          || receipt.selectedRequirementHash !== mapping.selectedRequirementHash
          || receipt.otherRequirementId !== mapping.otherRequirementId
          || receipt.otherRequirementHash !== mapping.otherRequirementHash
          || (receipt.fixtureInvocationId !== null && receipt.fixtureTemplateHash !== mapping.fixtureTemplateHash)
          || contentHash(event?.data?.recovery ?? null) !== contentHash(receipt.recovery ?? null)
          || event?.data?.oldPlanHash !== mapping.oldPlanHash || event?.data?.oldLinkHash !== mapping.oldLinkHash
          || event?.data?.selectedRequirementHash !== mapping.selectedRequirementHash
          || event?.data?.otherRequirementId !== mapping.otherRequirementId
          || event?.data?.otherRequirementHash !== mapping.otherRequirementHash
          || (receipt.fixtureInvocationId !== null && event?.data?.fixtureTemplateHash !== mapping.fixtureTemplateHash)))
        || (reservation.subcaseId === 'N2.MISSING_ASSERTION' && (reservation.requiredPlanAssertionId !== mapping.requiredPlanAssertionId
          || reservation.requiredPlanAssertionName !== mapping.requiredPlanAssertionName
          || reservation.requiredPlanAssertionHash !== mapping.requiredPlanAssertionHash))
        || receipt.reviewHash !== review.reviewHash || receipt.planHash !== mapping.planHash
        || receipt.parentDefinitionHash !== mapping.parentDefinitionHash || receipt.datasetHash !== mapping.datasetHash
        || receipt.oracleHash !== mapping.oracleHash || receipt.harnessHash !== mapping.harnessHash
        || receipt.assertionHash !== mapping.assertionHash || receipt.status !== receipt.outcome
        || receipt.expectedFixtureHash !== expectedFixtureHash
        || (invocationReceipt && ((receipt.reservationHash ?? null) !== reservation.reservationHash
          || (receipt.reservationHash ?? null) !== event?.data?.reservationHash
          || event?.data?.fixtureInvocationId !== receipt.fixtureInvocationId
          || event?.data?.fixtureTemplateHash !== receipt.fixtureTemplateHash
          || (receipt.fixtureTemplateHash !== null && receipt.fixtureTemplateHash !== pinnedTemplateHash)
          || (receipt.fixtureInvocationId !== null && typeof receipt.fixtureInvocationId !== 'string')
          || !isValidT91ProductHarnessInvocationPair(receipt.fixtureInvocationId, receipt.fixtureTemplateHash)))
        || (invocationReceipt && receipt.status === 'PASS'
          && (receipt.reservationHash !== reservation.reservationHash
            || typeof receipt.fixtureInvocationId !== 'string'
            || receipt.fixtureTemplateHash !== pinnedTemplateHash))
        || (receipt.status === 'PASS' && receipt.fixtureHash !== receipt.expectedFixtureHash)
        || (receipt.subcaseId === 'N2.MISSING_ASSERTION' && (receipt.requiredPlanAssertionId !== mapping.requiredPlanAssertionId
          || receipt.requiredPlanAssertionName !== mapping.requiredPlanAssertionName
          || receipt.requiredPlanAssertionHash !== mapping.requiredPlanAssertionHash
          || (receipt.run?.assertion && (receipt.run.assertion.id !== mapping.requiredPlanAssertionId
            || receipt.run.assertion.name !== mapping.requiredPlanAssertionName))
          || (receipt.status === 'PASS' && (!receipt.run?.assertion
            || receipt.run.assertion.id !== mapping.requiredPlanAssertionId
            || receipt.run.assertion.name !== mapping.requiredPlanAssertionName))))
        || (!legacyReceipt && (!classification || classification.status !== receipt.status
          || classification.noMutationVerified !== receipt.noMutationVerified
          || receipt.fixtureCaseId !== (receipt.subcaseId === 'N1' || receipt.subcaseId === 'N3' || receipt.subcaseId === 'R1' || receipt.subcaseId === 'R2' ? (receipt.fixtureCaseId ?? null)
            : receipt.subcaseId === 'N2.MISSING_ASSERTION'
              ? (receipt.attempt?.fixtureCaseId ?? null) : (receipt.control?.fixtureCaseId ?? null))
          || (receipt.subcaseId === 'N3' && !isValidT91N3ReceiptObservedPins(receipt, mapping))
          || event?.data?.fixtureCaseId !== receipt.fixtureCaseId))
        || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(receipt.status)
        || receipt.businessTruthStatus !== 'UNVERIFIED' || receipt.runtimeVerificationStatus !== 'NOT_EXECUTED'
        || receipt.negativeSuiteStatus !== 'INCOMPLETE' || receipt.scenarioExecutionStatus !== 'NOT_EXECUTED'
        || command?.action !== 'execute-product-behavior-harness-subcase' || command.receiptId !== receipt.id
        || event?.data?.receiptHash !== receiptHash || event?.data?.mappingHash !== mapping.mappingHash
        || event?.data?.reviewHash !== review.reviewHash || event?.timestamp !== receipt.recordedAt
        || event?.data?.recordedAt !== receipt.recordedAt || event?.data?.commandId !== receipt.commandId
        || !await audited(event, receipt.recordedBy, receipt.commandId, command.version)) {
        throw persistenceIntegrity('A product-harness subcase receipt failed its fixed pins, status, event, command, or audit verification.');
      }
      receiptIds.add(receipt.id);
    }
    for (const event of current.events.filter((entry) => ['ProcessBehaviorProductHarnessExecutionReserved', 'ProcessBehaviorProductHarnessSubcaseExecuted'].includes(entry.type))) {
      const records = event.type === 'ProcessBehaviorProductHarnessExecutionReserved' ? reservations : receipts;
      if (records.filter((entry) => entry.id === event.data?.recordId).length !== 1) throw persistenceIntegrity('A product-harness execution event has no unique record.');
    }
    return {
      reservations: reservations.map(({ id, reservationHash }) => ({ id, reservationHash })),
      receipts: receipts.map(({ id, receiptHash, schemaVersion, status }) => ({ id, receiptHash,
        status: schemaVersion < 3 ? 'INCONCLUSIVE' : status,
        ...(schemaVersion < 3 ? { historicalOutcome: status } : {}) })),
    };
  }
  async prepareT91N2AuthorizationExecution({ id: caseId, tenantId, principal, authzGeneration, mappingId, mappingHash,
    subcaseId, expectedVersion, commandId }) {
    if (!principal || !/^product-behavior-harness-mapping-[0-9a-f-]{36}$/i.test(mappingId ?? '')
        || !/^[a-f0-9]{64}$/.test(mappingHash ?? '') || !['N1', 'N2.AUTHORIZATION', 'N2.MISSING_ASSERTION', 'N3', 'R1', 'R2'].includes(subcaseId)
      || !Number.isSafeInteger(expectedVersion) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(commandId ?? '')) throw projectAccessDenied();
    const requestHash = contentHash({ caseId, mappingId, mappingHash, subcaseId, principal });
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:sdlc.product-harness-execute:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintResult = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintResult.rowCount) return null;
      const hint = verifyAggregateRow(hintResult.rows[0]);
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'owner' });
      const row = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!row.rowCount) return null;
      const current = verifyAggregateRow(row.rows[0]);
      if (current.projectId !== hint.projectId || current.accountableOwner !== principal) throw projectAccessDenied();
      await this.verifyProcessBehaviorTestPlans(current, client);
      await this.verifyProcessBehaviorProductHarnessMappings(current, client);
      await this.verifyT91N2AuthorizationExecutions(current, client);
      const prior = current.idempotency?.[commandId];
      if (prior) {
        if (prior.action !== 'execute-product-behavior-harness-subcase' || prior.requestHash !== requestHash
          || prior.mappingHash !== mappingHash || prior.subcaseId !== subcaseId || prior.expectedCaseVersion !== expectedVersion) {
          throw conflict('The execution command ID is already bound to different pins.', current.version, 'IDEMPOTENCY_CONFLICT');
        }
        if (prior.receiptId) {
          const receipt = (current.artifacts?.processBehaviorProductHarnessExecutions ?? []).find((entry) => entry.id === prior.receiptId);
          if (!receipt) throw persistenceIntegrity('A product-harness execution replay has no receipt.');
          return { replayed: true, receipt, changeCase: current };
        }
        const reservation = (current.artifacts?.processBehaviorProductHarnessExecutionReservations ?? []).find((entry) => entry.id === prior.reservationId);
        if (!reservation) throw persistenceIntegrity('A product-harness execution reservation has no saved record.');
        return { reserved: true, reservationId: reservation.id, changeCase: current };
      }
      if (current.version !== expectedVersion || current.artifacts?.requirements?.draftRevision == null) throw conflict('The current owner case changed before fixed harness execution.', current.version, 'PRODUCT_HARNESS_EXECUTION_STALE');
      const mapping = (current.artifacts?.processBehaviorProductHarnessMappings ?? []).find((entry) => entry.id === mappingId);
      const review = (current.artifacts?.processBehaviorProductHarnessMappingReviews ?? []).find((entry) => entry.mappingId === mappingId);
      const plan = (current.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === mapping?.planId);
      const requirement = (current.artifacts?.requirements?.requirements ?? []).find((entry) => entry.id === mapping?.requirementId);
      if (!mapping || mapping.subcaseId !== subcaseId || mapping.mappingHash !== mappingHash
        || mapping.integrityStatus !== 'VALID' || !review
        || review.integrityStatus !== 'VALID' || review.decision !== 'APPROVE_FOR_TEST_EXECUTION'
        || !await this.isCurrentProductHarnessPlan(current, plan, requirement, client)
        || !this.isCurrentT91R2RecoveryMapping(current, mapping, requirement)) {
        throw conflict('Execution requires the exact current mapping and an integrity-valid independent approval.', current.version, 'PRODUCT_HARNESS_EXECUTION_NOT_APPROVED');
      }
      const supportedDefinition = subcaseId === 'N1'
        ? isSupportedT91N1OrphanPathDefinition({ mapping, plan })
        : subcaseId === 'R1'
        ? isSupportedT91R1RecoveryDefinition({ mapping, plan })
        : subcaseId === 'R2'
        ? isSupportedT91R2RecoveryDefinition({ mapping, plan })
        : subcaseId === 'N3'
        ? isSupportedT91N3DeletedFailingTestDefinition({ mapping, plan })
        : subcaseId === 'N2.MISSING_ASSERTION'
        ? isSupportedT91N2MissingAssertionDefinition({ mapping, plan })
        : isSupportedT91N2AuthorizationDefinition({ mapping, plan });
      if (!supportedDefinition) {
        throw conflict(`The saved ${subcaseId} dataset, oracle, or assertion does not match the fixed product-harness contract.`, current.version,
          'PRODUCT_HARNESS_ORACLE_UNSUPPORTED');
      }
      if ((current.artifacts?.processBehaviorProductHarnessExecutions ?? []).some((entry) => entry.mappingId === mappingId)
        || (current.artifacts?.processBehaviorProductHarnessExecutionReservations ?? []).some((entry) => entry.mappingId === mappingId)) {
        throw conflict('This fixed mapping already has an execution reservation; use its original command key to replay.', current.version, 'PRODUCT_HARNESS_EXECUTION_ALREADY_RESERVED');
      }
      const harness = subcaseId === 'N1' ? T91_N1_ORPHAN_PATH_HARNESS
        : subcaseId === 'R1' ? T91_R1_CRITERION_RECOVERY_HARNESS
        : subcaseId === 'R2' ? T91_R2_SHARED_DRAFT_RECOVERY_HARNESS
        : subcaseId === 'N3' ? T91_N3_DELETED_FAILING_TEST_HARNESS
        : subcaseId === 'N2.MISSING_ASSERTION' ? T91_N2_MISSING_ASSERTION_HARNESS : T91_N2_AUTHORIZATION_HARNESS;
      const fixtureRequest = { schemaVersion: 1, fixtureProfileId: `t91-${subcaseId.toLowerCase().replaceAll('.', '-')}-local-product-path-v1`,
        subcaseId,
        mappingId: mapping.id, mappingHash: mapping.mappingHash, planId: mapping.planId, planHash: mapping.planHash,
        sourceTreeDigest: mapping.repositoryTreeDigest, criterionId: mapping.criterionId, criterionHash: mapping.criterionHash,
        parentDefinitionHash: mapping.parentDefinitionHash, datasetHash: mapping.datasetHash, oracleHash: mapping.oracleHash,
        subcaseId, harnessId: mapping.harnessId, harnessVersion: mapping.harnessVersion, harnessHash: mapping.harnessHash,
        assertionId: mapping.assertionId, assertionHash: mapping.assertionHash,
        route: harness.contract.route, method: harness.contract.method,
        assertions: subcaseId === 'N2.AUTHORIZATION' ? [] : ['N1', 'N3', 'R1', 'R2'].includes(subcaseId)
          ? [mapping.assertionId] : [mapping.requiredPlanAssertionId],
        ...(['N1', 'N3'].includes(subcaseId) ? { candidatePath: mapping.candidatePath } : {}), expectedStatus: harness.contract.expectedStatus };
      if (subcaseId === 'R1') Object.assign(fixtureRequest, { oldPlanId: mapping.oldPlanId, oldPlanHash: mapping.oldPlanHash,
        oldLinkId: mapping.oldLinkId, oldLinkHash: mapping.oldLinkHash, oldRunId: mapping.oldRunId,
        fixtureTemplateHash: mapping.fixtureTemplateHash });
      if (subcaseId === 'R2') Object.assign(fixtureRequest, { oldPlanId: mapping.oldPlanId, oldPlanHash: mapping.oldPlanHash,
        oldLinkId: mapping.oldLinkId, oldLinkHash: mapping.oldLinkHash, oldRunId: mapping.oldRunId,
        selectedRequirementHash: mapping.selectedRequirementHash, otherRequirementId: mapping.otherRequirementId,
        otherRequirementHash: mapping.otherRequirementHash, fixtureTemplateHash: mapping.fixtureTemplateHash });
      if (subcaseId === 'N3') Object.assign(fixtureRequest, { sourceTestBytesHash: mapping.sourceTestBytesHash,
        sourceExpectedExitCode: mapping.sourceExpectedExitCode, fixtureTemplateHash: mapping.fixtureTemplateHash });
      const reservedAt = new Date().toISOString();
      const id = `product-behavior-harness-reservation-${randomUUID()}`;
      const reservationCore = { schemaVersion: 1, id, tenantId, projectId: current.projectId, caseId: current.id,
        mappingId, mappingHash, reviewId: review.id, reviewHash: review.reviewHash, planId: plan.id, planHash: plan.planHash,
        subcaseId, harnessId: mapping.harnessId, harnessVersion: mapping.harnessVersion, harnessHash: mapping.harnessHash,
        assertionId: mapping.assertionId, assertionHash: mapping.assertionHash, sourceRef: structuredClone(mapping.sourceRef),
        repositorySnapshotId: mapping.repositorySnapshotId, repositoryTreeDigest: mapping.repositoryTreeDigest,
        criterionId: mapping.criterionId, criterionHash: mapping.criterionHash, criterionContractVersion: mapping.criterionContractVersion,
        criterionContractHash: mapping.criterionContractHash, parentDefinitionHash: mapping.parentDefinitionHash,
        datasetHash: mapping.datasetHash, oracleHash: mapping.oracleHash, fixtureRequestHash: contentHash(fixtureRequest),
        ...(['N1', 'N3'].includes(subcaseId) ? { candidatePath: mapping.candidatePath } : {}),
        ...(subcaseId === 'N3' ? { sourceTestBytesHash: mapping.sourceTestBytesHash,
          sourceExpectedExitCode: mapping.sourceExpectedExitCode, fixtureTemplateHash: mapping.fixtureTemplateHash } : {}),
        ...(subcaseId === 'N2.MISSING_ASSERTION' ? { requiredPlanAssertionId: mapping.requiredPlanAssertionId,
          requiredPlanAssertionName: mapping.requiredPlanAssertionName, requiredPlanAssertionHash: mapping.requiredPlanAssertionHash } : {}),
        ...(subcaseId === 'R1' ? { oldPlanId: mapping.oldPlanId, oldPlanHash: mapping.oldPlanHash,
          oldLinkId: mapping.oldLinkId, oldLinkHash: mapping.oldLinkHash, oldRunId: mapping.oldRunId,
          fixtureTemplateHash: mapping.fixtureTemplateHash } : {}),
        ...(subcaseId === 'R2' ? { oldPlanId: mapping.oldPlanId, oldPlanHash: mapping.oldPlanHash,
          oldLinkId: mapping.oldLinkId, oldLinkHash: mapping.oldLinkHash, oldRunId: mapping.oldRunId,
          selectedRequirementHash: mapping.selectedRequirementHash, otherRequirementId: mapping.otherRequirementId,
          otherRequirementHash: mapping.otherRequirementHash, fixtureTemplateHash: mapping.fixtureTemplateHash } : {}),
        requestedBy: principal, commandId, requestHash, reservationVersion: current.version + 1,
        reservedAt, expectedCaseVersion: current.version, status: 'RUNNING' };
      const reservation = { ...reservationCore, reservationHash: contentHash(reservationCore) };
      current.artifacts.processBehaviorProductHarnessExecutionReservations ??= [];
      current.artifacts.processBehaviorProductHarnessExecutionReservations.push(reservation);
      current.version += 1; current.updatedAt = reservedAt; current.idempotency ??= {};
      current.idempotency[commandId] = { action: 'execute-product-behavior-harness-subcase', requestHash, mappingHash, subcaseId,
        expectedCaseVersion: expectedVersion, reservationId: id, reservationStatus: 'RUNNING', version: current.version, at: reservedAt };
      const eventData = { recordId: id, mappingId, mappingHash, reviewId: review.id, reviewHash: review.reviewHash,
        planHash: plan.planHash, subcaseId, requestHash, fixtureRequestHash: reservation.fixtureRequestHash, commandId,
        reservationHash: reservation.reservationHash, tenantId, projectId: current.projectId, caseId: current.id,
        planId: plan.id, sourceRef: reservation.sourceRef, repositorySnapshotId: reservation.repositorySnapshotId,
        repositoryTreeDigest: reservation.repositoryTreeDigest, criterionId: reservation.criterionId,
        criterionHash: reservation.criterionHash, criterionContractVersion: reservation.criterionContractVersion,
        criterionContractHash: reservation.criterionContractHash, parentDefinitionHash: reservation.parentDefinitionHash,
        datasetHash: reservation.datasetHash, oracleHash: reservation.oracleHash, harnessId: reservation.harnessId,
        harnessVersion: reservation.harnessVersion, harnessHash: reservation.harnessHash,
        ...(['N1', 'N3'].includes(subcaseId) ? { candidatePath: reservation.candidatePath } : {}),
        ...(subcaseId === 'N3' ? { sourceTestBytesHash: reservation.sourceTestBytesHash,
          fixtureTemplateHash: reservation.fixtureTemplateHash } : {}),
        assertionId: reservation.assertionId, assertionHash: reservation.assertionHash,
        ...(subcaseId === 'N2.MISSING_ASSERTION' ? { requiredPlanAssertionId: reservation.requiredPlanAssertionId,
          requiredPlanAssertionName: reservation.requiredPlanAssertionName, requiredPlanAssertionHash: reservation.requiredPlanAssertionHash } : {}),
        ...(subcaseId === 'R1' ? { oldPlanHash: reservation.oldPlanHash, oldLinkHash: reservation.oldLinkHash,
          fixtureTemplateHash: reservation.fixtureTemplateHash } : {}),
        ...(subcaseId === 'R2' ? { oldPlanHash: reservation.oldPlanHash, oldLinkHash: reservation.oldLinkHash,
          selectedRequirementHash: reservation.selectedRequirementHash, otherRequirementId: reservation.otherRequirementId,
          otherRequirementHash: reservation.otherRequirementHash, fixtureTemplateHash: reservation.fixtureTemplateHash } : {}),
        reservedAt, aggregateVersion: reservation.reservationVersion };
      current.events.push({ id: `event-${randomUUID()}`, type: 'ProcessBehaviorProductHarnessExecutionReserved', schemaVersion: 1,
        tenantId, actor: principal, correlationId: current.correlationId, causationId: commandId, timestamp: reservedAt,
        aggregateVersion: current.version, data: eventData,
        contentHash: contentHash({ type: 'ProcessBehaviorProductHarnessExecutionReserved', tenantId, data: eventData }) });
      await this.saveInTransaction(client, current, { expectedVersion, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      return { replayed: false, reservationId: id, reservationToken: id, requestHash, expectedVersion: current.version,
        changeCase: current, fixtureRequest, harness, fixturePins: { planHash: plan.planHash, mappingHash, reviewHash: review.reviewHash,
          datasetHash: mapping.datasetHash, oracleHash: mapping.oracleHash, harnessHash: mapping.harnessHash,
          harnessId: mapping.harnessId, harnessVersion: mapping.harnessVersion, assertionId: mapping.assertionId,
          assertionHash: mapping.assertionHash, sourceTreeDigest: mapping.repositoryTreeDigest,
          fixtureRequestHash: reservation.fixtureRequestHash, reservationHash: reservation.reservationHash,
          ...(subcaseId === 'N2.MISSING_ASSERTION' ? { requiredPlanAssertionId: mapping.requiredPlanAssertionId,
            requiredPlanAssertionName: mapping.requiredPlanAssertionName, requiredPlanAssertionHash: mapping.requiredPlanAssertionHash } : {}),
          ...(subcaseId === 'R1' ? { oldPlanId: mapping.oldPlanId, oldPlanHash: mapping.oldPlanHash,
            oldLinkId: mapping.oldLinkId, oldLinkHash: mapping.oldLinkHash, oldRunId: mapping.oldRunId,
            fixtureTemplateHash: mapping.fixtureTemplateHash } : {}),
          ...(subcaseId === 'R2' ? { oldPlanId: mapping.oldPlanId, oldPlanHash: mapping.oldPlanHash,
            oldLinkId: mapping.oldLinkId, oldLinkHash: mapping.oldLinkHash, oldRunId: mapping.oldRunId,
            selectedRequirementHash: mapping.selectedRequirementHash, otherRequirementId: mapping.otherRequirementId,
            otherRequirementHash: mapping.otherRequirementHash, fixtureTemplateHash: mapping.fixtureTemplateHash } : {}),
          ...(subcaseId === 'N3' ? { sourceTestBytesHash: mapping.sourceTestBytesHash,
            sourceExpectedExitCode: mapping.sourceExpectedExitCode, fixtureTemplateHash: mapping.fixtureTemplateHash } : {}),
          subcaseId } };
    });
  }
  async recordT91N2AuthorizationExecution({ id: caseId, tenantId, principal, authzGeneration, mappingId, mappingHash,
    subcaseId, expectedVersion, commandId, reservationToken, reservationId, observation }) {
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:sdlc.product-harness-execute:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintResult = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintResult.rowCount) return null;
      const hint = verifyAggregateRow(hintResult.rows[0]);
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'owner' });
      const row = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!row.rowCount) return null;
      const current = verifyAggregateRow(row.rows[0]);
      await this.verifyProcessBehaviorProductHarnessMappings(current, client);
      await this.verifyT91N2AuthorizationExecutions(current, client);
      const prior = current.idempotency?.[commandId];
      if (!prior || prior.action !== 'execute-product-behavior-harness-subcase' || prior.requestHash !== contentHash({ caseId, mappingId, mappingHash, subcaseId, principal })
        || prior.reservationId !== reservationId || prior.reservationStatus !== 'RUNNING' || reservationToken !== reservationId) throw conflict('The fixed subcase reservation is stale or does not match its command.', current.version, 'PRODUCT_HARNESS_RESERVATION_STALE');
      if (prior.receiptId) {
        const receipt = (current.artifacts?.processBehaviorProductHarnessExecutions ?? []).find((entry) => entry.id === prior.receiptId);
        if (!receipt) throw persistenceIntegrity('A completed fixed subcase command has no receipt.');
        return { changeCase: current, receipt, replayed: true };
      }
      const reservation = (current.artifacts?.processBehaviorProductHarnessExecutionReservations ?? []).find((entry) => entry.id === reservationId);
      const mapping = (current.artifacts?.processBehaviorProductHarnessMappings ?? []).find((entry) => entry.id === mappingId);
      const review = (current.artifacts?.processBehaviorProductHarnessMappingReviews ?? []).find((entry) => entry.mappingId === mappingId);
      if (!reservation || !mapping || mapping.mappingHash !== mappingHash || !review || review.integrityStatus !== 'VALID'
        || review.decision !== 'APPROVE_FOR_TEST_EXECUTION') throw conflict('The mapping or its approval changed during fixed harness dispatch.', current.version, 'PRODUCT_HARNESS_EXECUTION_STALE');
      const fixtureInvocationId = typeof observation?.invocationId === 'string' ? observation.invocationId : null;
      const deletedFailingTestSubcase = subcaseId === 'N3';
      const recoverySubcase = subcaseId === 'R1';
      const sharedDraftRecoverySubcase = subcaseId === 'R2';
      const fixtureTemplateHash = deletedFailingTestSubcase || recoverySubcase || sharedDraftRecoverySubcase
        ? observation?.fixtureTemplateHash === mapping.fixtureTemplateHash ? mapping.fixtureTemplateHash : null
        : observation?.fixtureTemplateHash === T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH ? T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH : null;
      const orphanPathSubcase = subcaseId === 'N1';
      const missingAssertionSubcase = subcaseId === 'N2.MISSING_ASSERTION';
      const expectedFixtureHash = sharedDraftRecoverySubcase
        ? t91R2RecoveryFixtureHash({ mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId })
        : recoverySubcase
        ? t91R1RecoveryFixtureHash({ mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId })
        : deletedFailingTestSubcase
        ? t91N3DeletedFailingTestFixtureHash({ mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId })
        : orphanPathSubcase
        ? t91N1OrphanPathFixtureHash({ mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId })
        : missingAssertionSubcase
        ? t91N2MissingAssertionFixtureHash({ mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId })
        : fixtureInvocationId && fixtureTemplateHash === T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH
        ? t91N2AuthorizationInvocationFixtureHash({ mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId })
        : t91N2AuthorizationFixtureHash({ mapping, requestHash: reservation.fixtureRequestHash });
      const classification = sharedDraftRecoverySubcase
        ? classifyT91R2RecoveryObservation({ observation, mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId, reservationHash: reservation.reservationHash })
        : recoverySubcase
        ? classifyT91R1RecoveryObservation({ observation, mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId, reservationHash: reservation.reservationHash })
        : deletedFailingTestSubcase
        ? classifyT91N3DeletedFailingTestObservation({ observation, mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId, reservationHash: reservation.reservationHash })
        : orphanPathSubcase
        ? classifyT91N1OrphanPathObservation({ observation, mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId, reservationHash: reservation.reservationHash })
        : missingAssertionSubcase
        ? classifyT91N2MissingAssertionObservation({ observation, mapping, requestHash: reservation.fixtureRequestHash,
          fixtureTemplateHash, invocationId: fixtureInvocationId, reservationHash: reservation.reservationHash })
        : classifyT91N2AuthorizationObservation({ observation, mapping,
          requestHash: reservation.fixtureRequestHash, fixtureTemplateHash, invocationId: fixtureInvocationId,
          reservationHash: reservation.reservationHash });
      const noMutation = classification.noMutationVerified;
      const invocationPinsComplete = typeof fixtureInvocationId === 'string'
        && fixtureTemplateHash === (deletedFailingTestSubcase || recoverySubcase || sharedDraftRecoverySubcase ? mapping.fixtureTemplateHash : T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH)
        && observation?.reservationHash === reservation.reservationHash;
      const status = classification.status === 'PASS' && !invocationPinsComplete ? 'INCONCLUSIVE' : classification.status;
      const recordedAt = new Date().toISOString();
      const core = { schemaVersion: 4, id: `product-behavior-harness-execution-${randomUUID()}`, tenantId, projectId: current.projectId,
        caseId, mappingId, mappingHash, reviewId: review.id, reviewHash: review.reviewHash, reservationId, commandId,
        subcaseId, planId: reservation.planId, planHash: reservation.planHash, sourceRef: structuredClone(reservation.sourceRef),
        repositorySnapshotId: reservation.repositorySnapshotId, repositoryTreeDigest: reservation.repositoryTreeDigest,
        criterionId: reservation.criterionId, criterionHash: reservation.criterionHash,
        criterionContractVersion: reservation.criterionContractVersion, criterionContractHash: reservation.criterionContractHash,
        parentDefinitionHash: reservation.parentDefinitionHash, datasetHash: reservation.datasetHash, oracleHash: reservation.oracleHash,
        harnessId: reservation.harnessId, harnessVersion: reservation.harnessVersion, harnessHash: reservation.harnessHash,
        assertionId: reservation.assertionId, assertionHash: reservation.assertionHash,
        ...(orphanPathSubcase ? { candidatePath: reservation.candidatePath } : {}),
        ...(deletedFailingTestSubcase ? { candidatePath: reservation.candidatePath,
          sourceTestBytesHash: reservation.sourceTestBytesHash, sourceExpectedExitCode: reservation.sourceExpectedExitCode } : {}),
        ...(missingAssertionSubcase ? { requiredPlanAssertionId: reservation.requiredPlanAssertionId,
          requiredPlanAssertionName: reservation.requiredPlanAssertionName, requiredPlanAssertionHash: reservation.requiredPlanAssertionHash } : {}),
        ...(recoverySubcase ? { oldPlanId: reservation.oldPlanId, oldPlanHash: reservation.oldPlanHash,
          oldLinkId: reservation.oldLinkId, oldLinkHash: reservation.oldLinkHash, oldRunId: reservation.oldRunId,
          recovery: { old: observation?.old ?? null, staleAttempt: observation?.staleAttempt ?? null,
            fresh: observation?.fresh ?? null } } : {}),
        ...(sharedDraftRecoverySubcase ? { oldPlanId: reservation.oldPlanId, oldPlanHash: reservation.oldPlanHash,
          oldLinkId: reservation.oldLinkId, oldLinkHash: reservation.oldLinkHash, oldRunId: reservation.oldRunId,
          selectedRequirementHash: reservation.selectedRequirementHash, otherRequirementId: reservation.otherRequirementId,
          otherRequirementHash: reservation.otherRequirementHash,
          recovery: { old: observation?.old ?? null, staleAttempt: observation?.staleAttempt ?? null,
            fresh: observation?.fresh ?? null } } : {}),
        fixtureRequestHash: reservation.fixtureRequestHash, reservationHash: reservation.reservationHash,
        fixtureInvocationId, fixtureTemplateHash, expectedFixtureHash,
        fixtureHash: observation?.fixtureHash ?? null,
        terminal: observation?.terminal === true,
        fixtureCaseId: observation?.fixtureCaseId ?? observation?.attempt?.fixtureCaseId ?? observation?.control?.fixtureCaseId ?? null,
        ...(orphanPathSubcase ? { source: observation?.source ?? null, candidate: observation?.candidate ?? null,
          verifierDispatchCount: observation?.verifierDispatchCount ?? null } : {}),
        ...(deletedFailingTestSubcase ? { sourceStage: observation?.sourceStage ?? null,
          candidate: observation?.candidate ?? null, verifierDispatchCount: observation?.verifierDispatchCount ?? null } : {}),
        fixturePlan: observation?.fixturePlan ?? null,
        run: observation?.run ?? null,
        acceptedControlPlanHash: observation?.control?.acceptedPlanHash ?? null,
        control: observation?.control ?? null, attempt: observation?.attempt ?? null,
        before: observation?.attempt?.before ?? null, after: observation?.attempt?.after ?? null,
        httpStatus: observation?.attempt?.httpStatus ?? null, errorCode: observation?.attempt?.errorCode ?? null,
        noMutationVerified: noMutation === true,
        outcome: status, status, recordedBy: principal, recordedAt, requestHash: prior.requestHash,
        scenarioExecutionStatus: 'NOT_EXECUTED', negativeSuiteStatus: 'INCOMPLETE', businessTruthStatus: 'UNVERIFIED',
        runtimeVerificationStatus: 'NOT_EXECUTED', statement: sharedDraftRecoverySubcase
          ? t91R2RecoveryReceiptStatement({ status }) : recoverySubcase
          ? t91R1RecoveryReceiptStatement({ status })
          : deletedFailingTestSubcase
          ? t91N3DeletedFailingTestReceiptStatement({ status })
          : orphanPathSubcase
          ? t91N1OrphanPathReceiptStatement({ status, candidatePath: reservation.candidatePath })
          : missingAssertionSubcase
          ? 'This fixed local product-path check covers N2.MISSING_ASSERTION only; other N2 cases, recovery cases, and business truth remain unverified.'
          : 'This fixed local product-path denial result covers N2.AUTHORIZATION only; customer scenario execution, the remaining N2 cases, and business truth remain unverified.' };
      const receipt = { ...core, receiptHash: contentHash(core) };
      current.artifacts.processBehaviorProductHarnessExecutions ??= [];
      current.artifacts.processBehaviorProductHarnessExecutions.push(receipt);
      current.version += 1; current.updatedAt = recordedAt;
      current.idempotency[commandId] = { ...prior, reservationStatus: 'COMPLETED', receiptId: receipt.id, version: current.version, at: recordedAt };
      const eventData = { recordId: receipt.id, receiptHash: receipt.receiptHash, mappingId, mappingHash,
        reviewId: review.id, reviewHash: review.reviewHash, reservationId, reservationHash: receipt.reservationHash,
        fixtureInvocationId: receipt.fixtureInvocationId, fixtureTemplateHash: receipt.fixtureTemplateHash,
        ...(orphanPathSubcase ? { candidatePath: receipt.candidatePath, source: receipt.source, candidate: receipt.candidate,
          verifierDispatchCount: receipt.verifierDispatchCount } : {}),
        ...(deletedFailingTestSubcase ? { candidatePath: receipt.candidatePath, sourceStage: receipt.sourceStage,
          candidate: receipt.candidate, sourceTestBytesHash: receipt.sourceTestBytesHash,
          sourceExpectedExitCode: receipt.sourceExpectedExitCode, verifierDispatchCount: receipt.verifierDispatchCount } : {}),
        ...(recoverySubcase ? { oldPlanId: receipt.oldPlanId, oldPlanHash: receipt.oldPlanHash,
          oldLinkId: receipt.oldLinkId, oldLinkHash: receipt.oldLinkHash, oldRunId: receipt.oldRunId,
          recovery: receipt.recovery } : {}),
        ...(sharedDraftRecoverySubcase ? { oldPlanId: receipt.oldPlanId, oldPlanHash: receipt.oldPlanHash,
          oldLinkId: receipt.oldLinkId, oldLinkHash: receipt.oldLinkHash, oldRunId: receipt.oldRunId,
          selectedRequirementHash: receipt.selectedRequirementHash, otherRequirementId: receipt.otherRequirementId,
          otherRequirementHash: receipt.otherRequirementHash, recovery: receipt.recovery } : {}),
        planHash: receipt.planHash, subcaseId,
        fixtureCaseId: receipt.fixtureCaseId,
        outcome: status, noMutationVerified: noMutation === true, commandId, requestHash: prior.requestHash, recordedAt,
        scenarioExecutionStatus: 'NOT_EXECUTED', negativeSuiteStatus: 'INCOMPLETE', businessTruthStatus: 'UNVERIFIED',
        runtimeVerificationStatus: 'NOT_EXECUTED' };
      current.events.push({ id: `event-${randomUUID()}`, type: 'ProcessBehaviorProductHarnessSubcaseExecuted', schemaVersion: 1,
        tenantId, actor: principal, correlationId: current.correlationId, causationId: commandId, timestamp: recordedAt,
        aggregateVersion: current.version, data: eventData,
        contentHash: contentHash({ type: 'ProcessBehaviorProductHarnessSubcaseExecuted', tenantId, data: eventData }) });
      await this.saveInTransaction(client, current, { expectedVersion: current.version - 1, principal,
        requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      receipt.integrityStatus = 'VALID';
      return { changeCase: current, receipt, replayed: false };
    });
  }
  async isCurrentProductHarnessPlan(current, plan, requirement, client) {
    const requirementDraft = current.artifacts?.requirements;
    if (!plan || !requirement || !requirementDraft || plan.regenerationStatus === 'REGENERATION_REQUIRED'
      || plan.draftRevision !== requirementDraft.draftRevision
      || plan.criterionContractVersion !== requirement.criterionContract?.version
      || plan.criterionContractHash !== requirement.criterionContract?.contentHash
      || plan.traceHash !== requirement.processTrace?.traceHash
      || plan.source?.bindingHash !== current.sourceBinding?.bindingHash) return false;
    const requirementHash = contentHash(Object.fromEntries(Object.entries(requirement).filter(([key]) =>
      !['processRunEvidenceLinks', 'processRunEvidenceReviews', 'behaviorTestPlans'].includes(key))));
    if (requirementHash !== plan.requirementHash) return false;
    const query = client.query.bind(client);
    const projectRow = await query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`,
      [current.tenantId, current.projectId]);
    if (!projectRow.rowCount) return false;
    const project = verifyAggregateRow(projectRow.rows[0]);
    const blueprint = latestBlueprint(project);
    const source = requirement.processTrace.source;
    return Boolean(blueprint && source?.projectId === current.projectId && source.blueprintId === blueprint.id
      && source.blueprintVersion === blueprint.version && source.blueprintSnapshotHash === contentHash(blueprint));
  }
  isCurrentT91R2RecoveryMapping(current, mapping, requirement) {
    if (mapping?.subcaseId !== 'R2') return true;
    const requirements = current.artifacts?.requirements?.requirements ?? [];
    const otherRequirement = requirements.find((entry) => entry.id === mapping.otherRequirementId);
    return Number.isSafeInteger(mapping.draftRevision)
      && mapping.draftRevision === current.artifacts?.requirements?.draftRevision
      && requirement?.id === mapping.requirementId
      && digest(requirement) === mapping.selectedRequirementHash
      && digest(mapping.selectedRequirementSnapshot) === mapping.selectedRequirementHash
      && otherRequirement?.id === mapping.otherRequirementId
      && digest(otherRequirement) === mapping.otherRequirementHash
      && digest(mapping.otherRequirementSnapshot) === mapping.otherRequirementHash;
  }
  async addRequirementFromSavedProcessCommand({ id: caseId, tenantId, principal, authzGeneration, expectedVersion,
    expectedDraftRevision, statement, rationale, acceptanceCriteria, traceRefIds, commandId }) {
    if (!principal || !Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(expectedDraftRevision)
      || typeof statement !== 'string' || typeof rationale !== 'string' || !Array.isArray(acceptanceCriteria)
      || !Array.isArray(traceRefIds) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(commandId ?? '')) {
      throw projectAccessDenied();
    }
    const command = { version: expectedVersion, expectedDraftRevision, statement, rationale,
      acceptanceCriteria, traceRefIds, actor: principal, idempotencyKey: commandId };
    const requestHash = commandRequestHash(command);
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:sdlc.add-saved-process-requirement:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintResult = await client.query(`select * from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintResult.rowCount) return null;
      const hint = verifyAggregateRow(hintResult.rows[0]);
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'owner' });
      const projectResult = await client.query(`select * from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, hint.projectId]);
      if (!projectResult.rowCount) throw conflict('The saved project source is no longer available.', hint.version, 'PROCESS_SOURCE_STALE');
      const project = verifyAggregateRow(projectResult.rows[0]);
      const blueprint = latestBlueprint(project);
      const row = await client.query(`select * from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!row.rowCount) return null;
      const current = verifyAggregateRow(row.rows[0]);
      const prior = current.idempotency?.[commandId];
      if (prior) {
        if (prior.action !== 'add-requirement-from-saved-process' || prior.requestHash !== requestHash) {
          throw conflict('This idempotency key is already bound to a different requirement command.', current.version, 'IDEMPOTENCY_CONFLICT');
        }
        const event = current.events.find((entry) => entry.causationId === commandId && entry.type === 'RequirementAddedFromSavedProcess');
        if (!event?.data?.requirementId) throw persistenceIntegrity('A saved-process requirement replay has no immutable creation event.');
        return { changeCase: current, requirementId: event.data.requirementId, replayed: true };
      }
      if (current.version !== expectedVersion || current.accountableOwner !== principal
        || current.artifacts?.requirements?.draftRevision !== expectedDraftRevision) {
        throw conflict('The owner case or shared requirements draft changed. Reload the case and review the current draft before adding this requirement.',
          current.version, 'REQUIREMENT_DRAFT_STALE');
      }
      const binding = current.sourceBinding;
      const trace = current.processRequirementTrace;
      if (!binding || !trace || blueprint?.id !== binding.blueprintId || blueprint.version !== binding.blueprintVersion
        || contentHash(blueprint) !== (trace.source?.blueprintSnapshotHash ?? null)
        || trace.source?.projectId !== current.projectId || trace.source?.processId !== binding.objectId
        || trace.source?.bindingHash !== binding.bindingHash) {
        throw conflict('The pinned saved process changed. Select the current saved process before adding a requirement.', current.version, 'PROCESS_SOURCE_STALE');
      }
      const result = addSavedProcessRequirement(current, command);
      const requirementId = current.events.at(-1)?.data?.requirementId ?? null;
      await this.saveInTransaction(client, result.changeCase, { expectedVersion, principal,
        requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      return { changeCase: result.changeCase, requirementId, replayed: false };
    });
  }
  async requestProcessBehaviorProductHarnessMapping({ id: caseId, tenantId, principal, authzGeneration, planId,
    subcaseId, expectedVersion, commandId }) {
    if (!principal || !['N1', 'N2.AUTHORIZATION', 'N2.MISSING_ASSERTION', 'N3', 'R1', 'R2'].includes(subcaseId)
      || !/^behavior-test-plan-[0-9a-f-]{36}$/i.test(planId ?? '')
      || !Number.isSafeInteger(expectedVersion) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(commandId ?? '')) throw projectAccessDenied();
    const requestHash = contentHash({ caseId, planId, subcaseId, principal });
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:sdlc.product-harness-map:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintRow.rowCount) return null;
      const hint = verifyAggregateRow(hintRow.rows[0]);
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'owner' });
      const row = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!row.rowCount) return null;
      const current = verifyAggregateRow(row.rows[0]);
      await this.verifyProcessBehaviorTestPlans(current, client);
      await this.verifyProcessBehaviorProductHarnessMappings(current, client);
      const prior = current.idempotency?.[commandId];
      if (prior) {
        if (prior.action !== 'request-product-behavior-harness-mapping' || prior.requestHash !== requestHash) throw conflict('The mapping command ID is already bound to different pins.', current.version, 'IDEMPOTENCY_CONFLICT');
        const mapping = (current.artifacts?.processBehaviorProductHarnessMappings ?? []).find((entry) => entry.id === prior.mappingId);
        if (!mapping) throw persistenceIntegrity('A mapping replay has no saved record.');
        return { changeCase: current, mapping, replayed: true };
      }
      if (current.version !== expectedVersion || current.accountableOwner !== principal) throw conflict('Only the current accountable owner may request a fixed product-harness mapping at the current case version.', current.version, 'OWNER_AUTHORITY_REQUIRED');
      const plan = (current.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === planId);
      const requirement = current.artifacts?.requirements?.requirements?.find((entry) => entry.id === plan?.requirementId);
      if (!await this.isCurrentProductHarnessPlan(current, plan, requirement, client)) throw conflict('The saved plan is stale for the current requirement or source; regenerate it before requesting product-harness review.', current.version, 'PRODUCT_HARNESS_PLAN_STALE');
      const mappingCore = subcaseId === 'N1'
        ? buildT91N1OrphanPathMapping({ changeCase: current, requirement, plan })
        : subcaseId === 'R1'
        ? buildT91R1RecoveryMapping({ changeCase: current, requirement, plan })
        : subcaseId === 'R2'
        ? buildT91R2RecoveryMapping({ changeCase: current, requirement, plan })
        : subcaseId === 'N3'
        ? buildT91N3DeletedFailingTestMapping({ changeCase: current, requirement, plan })
        : subcaseId === 'N2.MISSING_ASSERTION'
        ? buildT91N2MissingAssertionMapping({ changeCase: current, requirement, plan })
        : buildT91N2AuthorizationMapping({ changeCase: current, requirement, plan });
      if (!mappingCore) throw conflict(`The saved ${subcaseId} definition or its exact historical pins are unavailable for the fixed harness.`, current.version, 'PRODUCT_HARNESS_MAPPING_UNAVAILABLE');
      const requestedAt = new Date().toISOString();
      const mapping = { ...mappingCore, id: `product-behavior-harness-mapping-${randomUUID()}`,
        requestedBy: principal, requestedAt, commandId, requestHash };
      current.artifacts ??= {};
      current.artifacts.processBehaviorProductHarnessMappings ??= [];
      current.artifacts.processBehaviorProductHarnessMappings.push(mapping);
      current.version += 1; current.updatedAt = requestedAt;
      current.idempotency ??= {};
      current.idempotency[commandId] = { action: 'request-product-behavior-harness-mapping', requestHash, mappingId: mapping.id, version: current.version, at: requestedAt };
      const eventData = { recordId: mapping.id, mappingHash: mapping.mappingHash, planId, planHash: mapping.planHash,
        subcaseId, requestedBy: principal, requestedAt, commandId, requestHash };
      if (subcaseId === 'R2') Object.assign(eventData, { draftRevision: mapping.draftRevision,
        selectedRequirementSnapshotHash: mapping.selectedRequirementHash,
        otherRequirementSnapshotHash: mapping.otherRequirementHash });
      current.events.push({ id: `event-${randomUUID()}`, type: 'ProcessBehaviorProductHarnessMappingRequested', schemaVersion: 1,
        tenantId, actor: principal, correlationId: current.correlationId, causationId: commandId, timestamp: requestedAt, data: eventData,
        contentHash: contentHash({ type: 'ProcessBehaviorProductHarnessMappingRequested', tenantId, data: eventData }) });
      await this.saveInTransaction(client, current, { expectedVersion, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      mapping.integrityStatus = 'VALID';
      return { changeCase: current, mapping, replayed: false };
    });
  }
  async reviewProcessBehaviorProductHarnessMapping({ id: caseId, tenantId, principal, authzGeneration, mappingId,
    mappingHash, decision, expectedVersion, commandId }) {
    if (!principal || !/^product-behavior-harness-mapping-[0-9a-f-]{36}$/i.test(mappingId ?? '')
      || !/^[a-f0-9]{64}$/.test(mappingHash ?? '') || !['APPROVE_FOR_TEST_EXECUTION', 'REQUEST_CHANGES'].includes(decision)
      || !Number.isSafeInteger(expectedVersion) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(commandId ?? '')) throw projectAccessDenied();
    const requestHash = contentHash({ caseId, mappingId, mappingHash, decision, principal });
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:sdlc.product-harness-review:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintRow.rowCount) return null;
      const hint = verifyAggregateRow(hintRow.rows[0]);
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'editor' });
      const row = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!row.rowCount) return null;
      const current = verifyAggregateRow(row.rows[0]);
      await this.verifyProcessBehaviorTestPlans(current, client);
      await this.verifyProcessBehaviorProductHarnessMappings(current, client);
      const prior = current.idempotency?.[commandId];
      if (prior) {
        if (prior.action !== 'review-product-behavior-harness-mapping' || prior.requestHash !== requestHash) throw conflict('The mapping-review command ID is already bound to different pins.', current.version, 'IDEMPOTENCY_CONFLICT');
        const review = (current.artifacts?.processBehaviorProductHarnessMappingReviews ?? []).find((entry) => entry.id === prior.reviewId);
        if (!review) throw persistenceIntegrity('A mapping-review replay has no saved record.');
        return { changeCase: current, review, replayed: true };
      }
      if (current.version !== expectedVersion) throw conflict('The case changed before the mapping review.', current.version);
      const mapping = (current.artifacts?.processBehaviorProductHarnessMappings ?? []).find((entry) => entry.id === mappingId);
      if (!mapping || mapping.mappingHash !== mappingHash || mapping.integrityStatus !== 'VALID'
        || mapping.requestedBy === principal) throw conflict('Review requires the exact valid mapping and a distinct authorized human.', current.version, 'PRODUCT_HARNESS_REVIEW_DENIED');
      const plan = (current.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === mapping.planId);
      const requirement = current.artifacts?.requirements?.requirements?.find((entry) => entry.id === mapping.requirementId);
      if (!await this.isCurrentProductHarnessPlan(current, plan, requirement, client)) throw conflict('The saved plan became stale before independent mapping review.', current.version, 'PRODUCT_HARNESS_PLAN_STALE');
      if (!this.isCurrentT91R2RecoveryMapping(current, mapping, requirement)) throw conflict('The selected or unrelated requirement changed before R2 mapping review.', current.version, 'PRODUCT_HARNESS_PLAN_STALE');
      const mappingDefinition = plan?.caseDefinitions?.cases?.find((entry) => entry.type
        === (['R1', 'R2'].includes(mapping.subcaseId) ? 'RECOVERY' : 'NEGATIVE'));
      if (!isIndependentT91N2MappingReviewer({ reviewerPrincipal: principal, mappingRequester: mapping.requestedBy,
        planAuthor: plan?.createdBy, definitionAuthor: mappingDefinition?.authoredBy })) {
        throw conflict('The fixed product-harness mapping reviewer must be distinct from the plan and case-definition author.', current.version, 'PRODUCT_HARNESS_AUTHOR_SELF_REVIEW');
      }
      if ((current.artifacts?.processBehaviorProductHarnessMappingReviews ?? []).some((entry) => entry.mappingId === mappingId)) throw conflict('This exact mapping already has a review decision.', current.version, 'PRODUCT_HARNESS_MAPPING_ALREADY_REVIEWED');
      const reviewedAt = new Date().toISOString();
      const reviewCore = { schemaVersion: 1, id: `product-behavior-harness-review-${randomUUID()}`, tenantId,
        projectId: current.projectId, caseId, mappingId, mappingHash, decision, reviewerPrincipal: principal,
        reviewedAt, commandId, requestHash, status: decision === 'APPROVE_FOR_TEST_EXECUTION' ? 'REVIEWED_FOR_TEST_EXECUTION' : 'CHANGES_REQUESTED',
        businessTruthStatus: 'UNVERIFIED', scenarioStatus: 'NOT_EXECUTED' };
      const review = { ...reviewCore, reviewHash: contentHash(reviewCore) };
      current.artifacts ??= {};
      current.artifacts.processBehaviorProductHarnessMappingReviews ??= [];
      current.artifacts.processBehaviorProductHarnessMappingReviews.push(review);
      current.version += 1; current.updatedAt = reviewedAt;
      current.idempotency ??= {};
      current.idempotency[commandId] = { action: 'review-product-behavior-harness-mapping', requestHash, reviewId: review.id, version: current.version, at: reviewedAt };
      const eventData = { recordId: review.id, mappingId, mappingHash, reviewHash: review.reviewHash, decision,
        status: review.status, reviewerPrincipal: principal, reviewedAt, commandId, requestHash };
      current.events.push({ id: `event-${randomUUID()}`, type: 'ProcessBehaviorProductHarnessMappingReviewed', schemaVersion: 1,
        tenantId, actor: principal, correlationId: current.correlationId, causationId: commandId, timestamp: reviewedAt, data: eventData,
        contentHash: contentHash({ type: 'ProcessBehaviorProductHarnessMappingReviewed', tenantId, data: eventData }) });
      await this.saveInTransaction(client, current, { expectedVersion, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      review.integrityStatus = 'VALID';
      return { changeCase: current, review, replayed: false };
    });
  }
  async prepareProcessBehaviorScenarioExecution({ id: caseId, tenantId, principal, authzGeneration, requirementId,
    linkId, planId, caseType = 'POSITIVE', expectedVersion, expectedDraftRevision, commandId, reservationToken = null }) {
    if (!principal || !/^REQ-PROC-[a-f0-9]{12}$/.test(requirementId ?? '')
      || !/^process-run-link-[0-9a-f-]{36}$/i.test(linkId ?? '')
      || !/^behavior-test-plan-[0-9a-f-]{36}$/i.test(planId ?? '') || !['POSITIVE', 'NEGATIVE', 'RECOVERY'].includes(caseType)
      || !Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(expectedDraftRevision)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(commandId ?? '')) throw projectAccessDenied();
    const requestHash = contentHash({ caseId, requirementId, linkId, planId, caseType, principal });
    return this.persistence.transaction(async (client) => {
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintRow.rowCount) return null;
      const hint = verifyAggregateRow(hintRow.rows[0]);
      if (!hint.projectId) throw projectAccessDenied();
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'owner' });
      const row = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!row.rowCount) return null;
      const current = verifyAggregateRow(row.rows[0]);
      if (current.projectId !== hint.projectId || current.accountableOwner !== principal) throw projectAccessDenied();
      await this.verifyProcessEvidenceReviews(current, client);
      await this.verifyProcessBehaviorTestPlans(current, client);
      await this.verifyProcessBehaviorEvaluations(current, client);
      await this.verifyProcessBehaviorScenarioExecutions(current, client);
      const prior = current.idempotency?.[commandId];
      let ownsReservation = false;
      let reservationId = prior?.reservationId ?? null;
      let activeReservationToken = reservationToken;
      if (prior) {
        if (prior.action !== 'execute-process-behavior-scenario' || prior.requestHash !== requestHash) {
          throw conflict('This command ID is already bound to different scenario pins.', current.version, 'IDEMPOTENCY_CONFLICT');
        }
        if (prior.receiptId) {
          const receipt = (current.artifacts?.processBehaviorScenarioExecutions ?? []).find((entry) => entry.id === prior.receiptId);
          if (!receipt) throw persistenceIntegrity('A scenario execution replay has no retained receipt.');
          return { replayed: true, receipt, changeCase: current };
        }
        if (prior.reservationStatus !== 'RUNNING' || !prior.reservationToken) throw persistenceIntegrity('A scenario execution reservation is malformed.');
        if (reservationToken !== prior.reservationToken) return { reserved: true, changeCase: current,
          reservationId: prior.reservationId, requestHash };
        ownsReservation = true;
      }
      if (!ownsReservation && current.version !== expectedVersion) throw conflict('The case changed before scenario execution.', current.version);
      const requirements = current.artifacts?.requirements;
      if (!requirements || requirements.acceptedBaseline || current.currentStage !== 'S4'
        || requirements.draftRevision !== expectedDraftRevision) throw conflict('The current requirement draft is unavailable for scenario execution.', current.version, 'REQUIREMENT_DRAFT_STALE');
      const selected = approvedProcessBehaviorScenario(current, { requirementId, linkId, planId, caseType });
      if (!selected || selected.review.reviewerPrincipal === principal) throw conflict('The exact scenario lacks a distinct current approval for test execution.', current.version, 'SCENARIO_NOT_REVIEWED_FOR_EXECUTION');
      const currentRequirementHash = contentHash(Object.fromEntries(Object.entries(selected.requirement)
        .filter(([key]) => !['processRunEvidenceLinks', 'processRunEvidenceReviews', 'processIntentEvaluationAcceptances', 'behaviorTestPlans'].includes(key))));
      if (selected.plan.draftRevision !== requirements.draftRevision || selected.plan.requirementHash !== currentRequirementHash
        || selected.link.draftRevision !== requirements.draftRevision || selected.link.requirementHash !== currentRequirementHash) {
        throw conflict('The scenario plan and link are stale for the current requirement draft.', current.version, 'SCENARIO_PLAN_STALE');
      }
      const runRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`,
        [tenantId, selected.link.run.id]);
      if (!runRow.rowCount) throw conflict('The reviewed scenario run is unavailable.', current.version, 'SCENARIO_RUN_NOT_FOUND');
      const run = verifyAggregateRow(runRow.rows[0]);
      if (run.projectId !== current.projectId || run.tenantId !== tenantId || run.status !== 'SUCCEEDED'
        || contentHash(run) !== selected.link.run.aggregateHash
        || run.processTaskRef?.behaviorTestPlan?.planId !== selected.plan.id
        || run.processTaskRef?.behaviorTestPlan?.planHash !== selected.plan.planHash
        || run.execution?.repositoryCandidate?.treeDigest == null) throw conflict('The runtime run no longer matches the approved plan and candidate.', current.version, 'SCENARIO_RUN_PIN_STALE');
      const runEvents = run.events ?? [];
      const audit = await client.query(`select count(*)::int as count from orgward.audit_log where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 and event_hash = any($3::text[])`,
        [tenantId, run.id, runEvents.map((event) => contentHash(event))]);
      if (Number(audit.rows[0]?.count) !== runEvents.length) throw persistenceIntegrity('The selected scenario run is missing durable event audit rows.');
      if (!ownsReservation) {
        activeReservationToken = randomUUID();
        reservationId = `process-behavior-scenario-reservation-${randomUUID()}`;
        const reservedAt = new Date().toISOString();
        current.version += 1; current.updatedAt = reservedAt;
        current.idempotency ??= {};
        current.idempotency[commandId] = { action: 'execute-process-behavior-scenario', requestHash,
          reservationId, reservationToken: activeReservationToken, reservationStatus: 'RUNNING', version: current.version, at: reservedAt };
        const eventData = { reservationId, requestHash, requirementId, linkId, planId, caseType,
          caseId: selected.definition.id, caseDefinitionHash: digest(selected.definition), mappingHash: digest(selected.mapping),
          criterionHash: selected.assertion.criterionHash, assertionHash: selected.mapping.assertionHash,
          testPath: selected.mapping.testPath, testFileHash: selected.mapping.testFileHash,
          datasetHash: digest(selected.definition.dataset), oracleHash: digest(selected.definition.expectedOutput),
          sourceSnapshotId: selected.plan.repository.snapshotId, sourceTreeDigest: selected.plan.repository.treeDigest,
          planHash: selected.plan.planHash, reviewId: selected.review.id, reviewHash: selected.review.reviewHash,
          actor: principal, reservedAt };
        const event = { id: `event-${randomUUID()}`, type: 'ProcessBehaviorScenarioExecutionReserved', schemaVersion: 1,
          tenantId, actor: principal, correlationId: current.correlationId, causationId: commandId,
          timestamp: reservedAt, aggregateVersion: current.version, data: eventData,
          contentHash: contentHash({ type: 'ProcessBehaviorScenarioExecutionReserved', tenantId, data: eventData }) };
        current.events.push(event);
        await this.saveInTransaction(client, current, { expectedVersion, principal,
          requiredPrincipalRoles: ['workspace-write'], authzGeneration });
        ownsReservation = true;
      }
      return { replayed: false, claimed: !prior, claimOwned: true, reservationToken: activeReservationToken, reservationId,
        changeCase: current, caseId, requirementId, linkId, planId, caseType, expectedVersion: current.version,
        runId: run.id, runAggregateHash: contentHash(run), candidateTreeDigest: run.execution.repositoryCandidate.treeDigest,
        testFileHash: selected.mapping.testFileHash, criterionHash: selected.assertion.criterionHash,
        assertionHash: selected.mapping.assertionHash, sourceSnapshotId: selected.plan.repository.snapshotId,
        sourceTreeDigest: selected.plan.repository.treeDigest, datasetHash: digest(selected.definition.dataset),
        oracleHash: digest(selected.definition.expectedOutput), caseDefinitionHash: digest(selected.definition),
        mappingHash: digest(selected.mapping), plan: structuredClone(selected.plan),
        definition: structuredClone(selected.definition), assertion: structuredClone(selected.assertion),
        reviewId: selected.review.id, reviewHash: selected.review.reviewHash, linkHash: selected.link.linkHash,
        expectedDraftRevision, requestHash };
    });
  }
  async recordProcessBehaviorScenarioExecution({ id: caseId, tenantId, principal, authzGeneration, requirementId,
    linkId, planId, caseType = 'POSITIVE', expectedVersion, expectedDraftRevision, commandId, expectedPinsHash, execution, reservationToken }) {
    const prepared = await this.prepareProcessBehaviorScenarioExecution({ id: caseId, tenantId, principal, authzGeneration,
      requirementId, linkId, planId, caseType, expectedVersion, expectedDraftRevision, commandId, reservationToken });
    if (!prepared) return null;
    if (prepared.replayed) return prepared;
    if (!prepared.claimOwned) throw conflict('This scenario execution command already has an active worker reservation.', expectedVersion, 'SCENARIO_EXECUTION_IN_PROGRESS');
    if (!execution || ![1, 2].includes(execution.schemaVersion) || execution.result !== execution.tap?.status
      || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(execution.result)
      || execution.businessTruthStatus !== 'UNVERIFIED' || execution.runtimeVerificationStatus !== 'NOT_EXECUTED'
      || execution.planHash !== prepared.plan.planHash || execution.runId !== prepared.runId
      || execution.runAggregateHash !== prepared.runAggregateHash || execution.candidateTreeDigest !== prepared.candidateTreeDigest
      || execution.caseType !== prepared.definition.type
      || (execution.schemaVersion >= 2 && execution.criterionHash !== prepared.criterionHash)
      || (execution.criterionHash !== undefined && execution.criterionHash !== prepared.criterionHash)
      || execution.testFileHash !== prepared.testFileHash || execution.caseId !== prepared.definition.id
      || execution.caseDefinitionHash !== digest(prepared.definition) || execution.mappingHash !== digest(prepared.definition.executionMapping)
      || execution.datasetHash !== digest(prepared.definition.dataset) || execution.oracleHash !== digest(prepared.definition.expectedOutput)
      || !/^[a-f0-9]{64}$/.test(execution.runnerHash ?? '')
      || execution.assertionId !== prepared.assertion.id || execution.assertionHash !== prepared.definition.executionMapping.assertionHash
      || execution.testPath !== prepared.definition.executionMapping.testPath
      || execution.sourceSnapshotId !== prepared.plan.repository.snapshotId
      || execution.sourceTreeDigest !== prepared.plan.repository.treeDigest
      || expectedPinsHash !== contentHash({ planHash: prepared.plan.planHash, criterionHash: prepared.criterionHash,
        assertionHash: prepared.assertionHash, testFileHash: prepared.testFileHash,
        sourceSnapshotId: prepared.sourceSnapshotId, sourceTreeDigest: prepared.sourceTreeDigest,
        candidateTreeDigest: prepared.candidateTreeDigest, caseId: prepared.definition.id, caseType: prepared.definition.type,
        caseDefinitionHash: prepared.caseDefinitionHash, mappingHash: prepared.mappingHash,
        datasetHash: prepared.datasetHash, oracleHash: prepared.oracleHash,
        runAggregateHash: prepared.runAggregateHash, reviewId: prepared.reviewId,
        reviewHash: prepared.reviewHash, linkHash: prepared.linkHash })) {
      throw conflict('The scenario result does not match the exact approved execution pins.', expectedVersion, 'SCENARIO_EXECUTION_PIN_MISMATCH');
    }
    const requestHash = prepared.requestHash;
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:sdlc.process-behavior-scenario:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintRow.rowCount) return null;
      const hint = verifyAggregateRow(hintRow.rows[0]);
      if (!hint.projectId) throw projectAccessDenied();
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'owner' });
      const row = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!row.rowCount) return null;
      const current = verifyAggregateRow(row.rows[0]);
      if (current.projectId !== hint.projectId || current.accountableOwner !== principal) throw projectAccessDenied();
      await this.verifyProcessEvidenceReviews(current, client);
      await this.verifyProcessBehaviorTestPlans(current, client);
      await this.verifyProcessBehaviorEvaluations(current, client);
      await this.verifyProcessBehaviorScenarioExecutions(current, client);
      const prior = current.idempotency?.[commandId];
      if (prior) {
        if (prior.action !== 'execute-process-behavior-scenario' || prior.requestHash !== requestHash) throw conflict('This command ID was already used with different scenario pins.', current.version, 'IDEMPOTENCY_CONFLICT');
        if (prior.receiptId) {
          const receipt = (current.artifacts?.processBehaviorScenarioExecutions ?? []).find((entry) => entry.id === prior.receiptId);
          if (!receipt) throw persistenceIntegrity('A scenario execution replay has no retained receipt.');
          return { changeCase: current, receipt, replayed: true };
        }
        if (prior.reservationToken !== reservationToken || prior.reservationStatus !== 'RUNNING') throw conflict('The scenario execution reservation is stale or owned by another request.', current.version, 'SCENARIO_EXECUTION_IN_PROGRESS');
      }
      if (current.version !== expectedVersion) throw conflict('The case changed while the isolated scenario was running.', current.version);
      const selected = approvedProcessBehaviorScenario(current, { requirementId, linkId, planId, caseType });
      if (!selected || selected.review.id !== prepared.reviewId || selected.review.reviewHash !== prepared.reviewHash
        || selected.link.linkHash !== prepared.linkHash || selected.plan.planHash !== prepared.plan.planHash
        || current.artifacts.requirements.draftRevision !== expectedDraftRevision) throw conflict('The approved scenario changed while it was running; no receipt was written.', current.version, 'SCENARIO_EXECUTION_STALE');
      const recordedAt = new Date().toISOString();
      const receiptCore = { ...structuredClone(execution), id: `process-behavior-scenario-execution-${randomUUID()}`,
        schemaVersion: execution.schemaVersion, tenantId, projectId: current.projectId, caseId: current.id, requirementId, linkId,
        linkHash: selected.link.linkHash, reviewId: selected.review.id, reviewHash: selected.review.reviewHash,
        planId: selected.plan.id, planHash: selected.plan.planHash, recordedBy: principal, recordedAt,
        expectedVersion, requestHash, status: execution.result,
        statement: `The saved ${caseType.toLowerCase()} assertion ${execution.result === 'PASS' ? 'passed' : execution.result === 'FAIL' ? 'failed' : 'was inconclusive'} against the pinned dataset and oracle; this single case does not establish suite completion, business truth or runtime verification.` };
      const receipt = { ...receiptCore, receiptHash: contentHash(receiptCore) };
      current.artifacts.processBehaviorScenarioExecutions ??= [];
      current.artifacts.processBehaviorScenarioExecutions.push(receipt);
      current.version += 1; current.updatedAt = recordedAt;
      current.idempotency ??= {};
      current.idempotency[commandId] = { ...current.idempotency[commandId], action: 'execute-process-behavior-scenario', requestHash,
        reservationStatus: 'COMPLETED', receiptId: receipt.id, version: current.version, at: recordedAt };
      const eventData = { receiptId: receipt.id, receiptHash: receipt.receiptHash, requirementId, linkId,
        linkHash: receipt.linkHash, reviewId: receipt.reviewId, reviewHash: receipt.reviewHash,
        planId, planHash: receipt.planHash, caseId: receipt.caseId, caseType, runId: receipt.runId,
        runAggregateHash: receipt.runAggregateHash, candidateTreeDigest: receipt.candidateTreeDigest,
        result: receipt.result, status: receipt.status, businessTruthStatus: 'UNVERIFIED',
        runtimeVerificationStatus: 'NOT_EXECUTED', actor: principal, recordedAt, requestHash };
      const event = { id: `event-${randomUUID()}`, type: 'ProcessBehaviorScenarioExecuted', schemaVersion: 1,
        tenantId, actor: principal, correlationId: current.correlationId, causationId: commandId,
        timestamp: recordedAt, data: eventData,
        contentHash: contentHash({ type: 'ProcessBehaviorScenarioExecuted', tenantId, data: eventData }) };
      current.events.push(event);
      await this.saveInTransaction(client, current, { expectedVersion, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      receipt.integrityStatus = 'VALID';
      return { changeCase: current, receipt, replayed: false };
    });
  }
  async verifyProcessBehaviorScenarioExecutions(current, client = null) {
    const query = client ? client.query.bind(client) : this.persistence.query.bind(this.persistence);
    const receipts = current.artifacts?.processBehaviorScenarioExecutions ?? [];
    if (!Array.isArray(receipts)) throw persistenceIntegrity('Scenario execution receipts are malformed.');
    const seen = new Set();
    for (const receipt of receipts) {
      const { receiptHash, integrityStatus: _integrityStatus, ...core } = receipt ?? {};
      const selected = approvedProcessBehaviorScenario(current, { requirementId: receipt?.requirementId,
        linkId: receipt?.linkId, planId: receipt?.planId, caseType: receipt?.caseType ?? 'POSITIVE', reviewId: receipt?.reviewId });
      const events = (current.events ?? []).filter((event) => event.type === 'ProcessBehaviorScenarioExecuted'
        && event.data?.receiptId === receipt?.id);
      if (!selected || seen.has(receipt?.id) || ![1, 2].includes(receipt.schemaVersion)
        || !/^process-behavior-scenario-execution-[0-9a-f-]{36}$/i.test(receipt.id ?? '')
        || !/^[a-f0-9]{64}$/.test(receiptHash ?? '') || contentHash(core) !== receiptHash
        || receipt.tenantId !== current.tenantId || receipt.projectId !== current.projectId || receipt.caseId !== current.id
        || receipt.planHash !== selected.plan.planHash || receipt.caseType !== selected.definition.type
        || receipt.caseDefinitionHash !== digest(selected.definition)
        || (receipt.schemaVersion >= 2 && receipt.criterionHash !== selected.assertion.criterionHash)
        || (receipt.criterionHash !== undefined && receipt.criterionHash !== selected.assertion.criterionHash)
        || receipt.mappingHash !== digest(selected.mapping) || receipt.datasetHash !== digest(selected.definition.dataset)
        || receipt.oracleHash !== digest(selected.definition.expectedOutput) || receipt.testFileHash !== selected.mapping.testFileHash
        || !/^[a-f0-9]{64}$/.test(receipt.runnerHash ?? '')
        || receipt.assertionId !== selected.assertion.id || receipt.assertionHash !== selected.mapping.assertionHash
        || receipt.testPath !== selected.mapping.testPath || receipt.sourceSnapshotId !== selected.plan.repository.snapshotId
        || receipt.sourceTreeDigest !== selected.plan.repository.treeDigest || receipt.result !== receipt.status
        || receipt.result !== receipt.tap?.status || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(receipt.result)
        || receipt.businessTruthStatus !== 'UNVERIFIED' || receipt.runtimeVerificationStatus !== 'NOT_EXECUTED'
        || receipt.workspaceReadOnlyVerified !== true
        || events.length !== 1) throw persistenceIntegrity('A scenario execution receipt failed its immutable plan, mapping, result, or event verification.');
      const event = events[0];
      const expectedEvent = { receiptId: receipt.id, receiptHash, requirementId: receipt.requirementId,
        linkId: receipt.linkId, linkHash: receipt.linkHash, reviewId: receipt.reviewId, reviewHash: receipt.reviewHash,
        planId: receipt.planId, planHash: receipt.planHash, caseId: receipt.caseId, caseType: receipt.caseType,
        runId: receipt.runId, runAggregateHash: receipt.runAggregateHash, candidateTreeDigest: receipt.candidateTreeDigest,
        result: receipt.result, status: receipt.status, businessTruthStatus: 'UNVERIFIED',
        runtimeVerificationStatus: 'NOT_EXECUTED', actor: receipt.recordedBy, recordedAt: receipt.recordedAt,
        requestHash: receipt.requestHash };
      const idempotency = current.idempotency?.[event.causationId];
      if (event.schemaVersion !== 1 || contentHash(event.data) !== contentHash(expectedEvent)
        || event.actor !== receipt.recordedBy || event.timestamp !== receipt.recordedAt || event.tenantId !== current.tenantId
        || event.contentHash !== contentHash({ type: event.type, tenantId: current.tenantId, data: expectedEvent })
        || !idempotency || idempotency.action !== 'execute-process-behavior-scenario'
        || idempotency.receiptId !== receipt.id || idempotency.requestHash !== receipt.requestHash
        || idempotency.at !== receipt.recordedAt || Number(idempotency.version) !== Number(event.aggregateVersion ?? idempotency.version)) {
        throw persistenceIntegrity('A scenario receipt has no unique matching event or idempotent command.');
      }
      const runRow = await query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`,
        [current.tenantId, receipt.runId]);
      if (!runRow.rowCount) throw persistenceIntegrity('A scenario receipt has no retained run.');
      const run = verifyAggregateRow(runRow.rows[0]);
      if (contentHash(run) !== receipt.runAggregateHash || receipt.runId !== selected.link.run.id
        || receipt.runAggregateHash !== selected.link.run.aggregateHash
        || run.execution?.repositoryCandidate?.treeDigest !== receipt.candidateTreeDigest) throw persistenceIntegrity('A scenario receipt no longer matches the retained run and candidate tree.');
      const audit = await query(`select event_hash,command_id,actor,aggregate_version,event from orgward.audit_log
        where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
      [current.tenantId, current.id, contentHash(event)]);
      const row = audit.rows[0];
      if (audit.rowCount !== 1 || row.event_hash !== contentHash(event) || contentHash(row.event) !== contentHash(event)
        || row.command_id !== event.causationId || row.actor !== event.actor
        || Number(row.aggregate_version) !== Number(idempotency.version)) throw persistenceIntegrity('A scenario execution event has no matching durable audit command.');
      receipt.integrityStatus = 'VALID'; seen.add(receipt.id);
    }
    for (const event of (current.events ?? []).filter((entry) => entry.type === 'ProcessBehaviorScenarioExecuted')) {
      if (!seen.has(event.data?.receiptId)) throw persistenceIntegrity('A scenario execution event has no retained receipt.');
    }
    for (const event of (current.events ?? []).filter((entry) => entry.type === 'ProcessBehaviorScenarioExecutionReserved')) {
      const claim = current.idempotency?.[event.causationId];
      const data = event.data ?? {};
      if (event.schemaVersion !== 1 || claim?.action !== 'execute-process-behavior-scenario'
        || claim.reservationId !== data.reservationId || claim.requestHash !== data.requestHash
        || !['RUNNING', 'COMPLETED'].includes(claim.reservationStatus)
        || event.actor !== data.actor || event.timestamp !== data.reservedAt
        || event.contentHash !== contentHash({ type: event.type, tenantId: current.tenantId, data })
        || !/^[a-f0-9]{64}$/.test(data.requestHash ?? '')) throw persistenceIntegrity('A scenario execution reservation failed immutable command verification.');
      const audit = await query(`select event_hash,command_id,actor,aggregate_version,event from orgward.audit_log
        where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
      [current.tenantId, current.id, contentHash(event)]);
      const row = audit.rows[0];
      if (audit.rowCount !== 1 || row.event_hash !== contentHash(event) || contentHash(row.event) !== contentHash(event)
        || row.command_id !== event.causationId || row.actor !== event.actor
        || Number(row.aggregate_version) !== Number(event.aggregateVersion)) throw persistenceIntegrity('A scenario execution reservation has no matching durable audit command.');
    }
    return current;
  }
  async authorizeProcessBehaviorTestPlan({ id: caseId, tenantId, principal, authzGeneration,
    requirementId, planId, revision, taskId, assertions, fileMappings, evaluationContext, caseDefinitions,
    checkPlan, repositoryRef, expectedVersion, expectedDraftRevision, commandId }) {
    if (!principal || !/^REQ-PROC-[a-f0-9]{12}$/.test(requirementId ?? '')
      || !/^process-plan-[0-9a-f-]{36}$/i.test(planId ?? '') || !Number.isSafeInteger(revision) || revision < 1
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,119}$/.test(taskId ?? '')
      || !Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(expectedDraftRevision)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(commandId ?? '')) throw projectAccessDenied();
    const operation = 'sdlc.process-behavior-test-plan';
    const requestHash = contentHash({ caseId, requirementId, planId, revision, taskId, assertions, fileMappings,
      evaluationContext, caseDefinitions,
      checkPlanHash: checkPlan?.planHash ?? null, repositoryHash: repositoryRef ? contentHash(repositoryRef) : null,
      expectedVersion, expectedDraftRevision, principal });
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const row = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!row.rowCount) return null;
      const current = verifyAggregateRow(row.rows[0]);
      if (!current.projectId || current.tenantId !== tenantId) throw projectAccessDenied();
      await lockProjectAccess(client, { tenantId, projectId: current.projectId, principal, minimum: 'owner' });
      if (current.accountableOwner !== principal) throw projectAccessDenied();
      await this.verifyProcessBehaviorTestPlans(current, client);
      const previous = current.idempotency?.[commandId];
      if (previous) {
        if (previous.action !== 'authorize-process-behavior-test-plan' || previous.requestHash !== requestHash) throw conflict('This command ID was reused with different behavior plan input.', current.version, 'IDEMPOTENCY_CONFLICT');
        const saved = current.artifacts?.processBehaviorTestPlans?.find((entry) => entry.id === previous.planId);
        if (!saved) throw persistenceIntegrity('The behavior plan replay has no retained plan.');
        return { changeCase: current, plan: saved, replayed: true };
      }
      if (current.version !== expectedVersion) throw conflict('The change case changed before authorizing the behavior test plan.', current.version);
      const reqs = current.artifacts?.requirements;
      if (!reqs || reqs.acceptedBaseline || current.currentStage !== 'S4' || reqs.draftRevision !== expectedDraftRevision) throw conflict('The requirement draft changed or is no longer editable.', current.version, 'REQUIREMENT_DRAFT_STALE');
      if (!current.sourceBinding || verifySourceBinding(current.sourceBinding).valid !== true || verifyContextManifest(current).valid !== true) throw persistenceIntegrity('The pinned requirement source or context manifest is invalid.');
      const requirement = reqs.requirements?.find((entry) => entry.id === requirementId && entry.processTrace && entry.verificationContract);
      if (!requirement) throw conflict('The selected process requirement is unavailable.', current.version, 'PROCESS_REQUIREMENT_NOT_FOUND');
      if (!verifyRequirementCriterionContract(requirement)) throw conflict('Legacy string criteria remain unclassified; the accountable owner must authorize a versioned obligation baseline before planning checks.', current.version, 'REQUIREMENT_CRITERIA_UNCLASSIFIED');
      const projectRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, current.projectId]);
      if (!projectRow.rowCount) throw projectAccessDenied();
      const project = verifyAggregateRow(projectRow.rows[0]);
      const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId: project.id, project, planId, revision });
      if (!plan) throw conflict('Choose an exact saved process plan revision.', current.version, 'PROCESS_PLAN_REVISION_NOT_FOUND');
      const task = plan.tasks.find((entry) => entry.id === taskId);
      if (!task || task.sourceProcessId !== requirement.processTrace.process.id
        || plan.source?.blueprintId !== requirement.processTrace.source.blueprintId
        || Number(plan.source?.blueprintVersion) !== Number(requirement.processTrace.source.blueprintVersion)) throw conflict('The task plan does not match the exact traced process source.', current.version, 'PROCESS_PLAN_SOURCE_MISMATCH');
      if (!checkPlan || !Array.isArray(checkPlan.requiredChecks) || !checkPlan.requiredChecks.length || !/^[a-f0-9]{64}$/.test(checkPlan.planHash ?? '')) throw conflict('This bounded behavior evaluation requires a configured repository assertion check.', current.version, 'BEHAVIOR_CHECK_PLAN_UNAVAILABLE');
      if (!repositoryRef || repositoryRef.kind !== 'github-app' || repositoryRef.checkPlan?.planHash !== checkPlan.planHash
        || !/^[a-f0-9]{64}$/.test(repositoryRef.treeDigest ?? '') || !Array.isArray(repositoryRef.selectedFiles)
        || !repositoryRef.selectedFiles.length) throw conflict('Pin one exact saved repository snapshot and selected files before authorizing assertions.', current.version, 'BEHAVIOR_CHECK_SOURCE_UNAVAILABLE');
      const requirementHash = contentHash(Object.fromEntries(Object.entries(requirement)
        .filter(([key]) => !['processRunEvidenceLinks', 'processRunEvidenceReviews', 'processIntentEvaluationAcceptances', 'behaviorTestPlans'].includes(key))));
      let behaviorPlan;
      try { behaviorPlan = buildProcessBehaviorTestPlan({ request: { assertions, fileMappings, evaluationContext, caseDefinitions }, changeCase: current, requirement, project, plan, task, checkPlan, repository: repositoryRef, principal }); }
      catch (error) { throw Object.assign(new Error(error.message), { statusCode: 400, code: 'INVALID_PROCESS_BEHAVIOR_TEST_PLAN', retryable: false }); }
      if (behaviorPlan.requirementHash !== requirementHash) throw persistenceIntegrity('The behavior plan requirement hash changed during authorization.');
      behaviorPlan.requestHash = requestHash;
      behaviorPlan.planHash = contentHash(Object.fromEntries(Object.entries(behaviorPlan).filter(([key]) => key !== 'planHash')));
      current.artifacts.processBehaviorTestPlans ??= [];
      current.artifacts.processBehaviorTestPlans.push(behaviorPlan);
      current.version += 1;
      current.updatedAt = behaviorPlan.createdAt;
      current.idempotency ??= {};
      current.idempotency[commandId] = { action: 'authorize-process-behavior-test-plan', requestHash, planId: behaviorPlan.id, version: current.version, at: behaviorPlan.createdAt };
      const eventData = { planId: behaviorPlan.id, planHash: behaviorPlan.planHash, requirementId,
        requirementHash: behaviorPlan.requirementHash, draftRevision: expectedDraftRevision, traceHash: behaviorPlan.traceHash,
        criterionContractVersion: behaviorPlan.criterionContractVersion, criterionContractHash: behaviorPlan.criterionContractHash,
        processPlanId: planId, processPlanRevision: revision, taskId, repositoryHash: behaviorPlan.repositoryHash,
        repositorySnapshotId: behaviorPlan.repository.source?.snapshotId, repositoryTreeDigest: behaviorPlan.repository.treeDigest,
        checkPlanHash: behaviorPlan.checkPlan.hash, fileMappingsHash: contentHash(behaviorPlan.fileMappings) };
      eventData.evaluationContextHash = contentHash(behaviorPlan.evaluationContext);
      eventData.caseDefinitionsHash = contentHash(behaviorPlan.caseDefinitions);
      const event = { id: `event-${randomUUID()}`, type: 'ProcessBehaviorTestPlanAuthorized', schemaVersion: 1, tenantId,
        actor: principal, correlationId: current.correlationId, causationId: commandId, timestamp: behaviorPlan.createdAt,
        data: eventData, contentHash: contentHash({ type: 'ProcessBehaviorTestPlanAuthorized', tenantId, data: eventData }) };
      current.events.push(event);
      await this.saveInTransaction(client, current, { expectedVersion, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      return { changeCase: current, plan: behaviorPlan, replayed: false };
    });
  }
  async linkPersistedProcessRun({ id: caseId, tenantId, principal, authzGeneration, runId, planInstanceId, taskId, requirementId, expectedVersion, expectedDraftRevision, commandId }) {
    const humanSelector = !runId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planInstanceId ?? '')
      && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,119}$/.test(taskId ?? '');
    const runSelector = /^execution-run-[0-9a-f-]{36}$/i.test(runId ?? '') && !planInstanceId && !taskId;
    if (!principal || !(humanSelector || runSelector)
      || !Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(expectedDraftRevision)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(commandId ?? '')) throw projectAccessDenied();
    const operation = 'sdlc.process-run-evidence-link';
    const requestHash = contentHash({ caseId, ...(runSelector ? { runId } : { planInstanceId, taskId }), requirementId, expectedVersion, expectedDraftRevision, principal });
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintRow.rowCount) return null;
      const hint = verifyAggregateRow(hintRow.rows[0]);
      if (!hint.projectId) throw projectAccessDenied();
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'editor' });
      const caseRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!caseRow.rowCount) return null;
      const current = verifyAggregateRow(caseRow.rows[0]);
      if (current.projectId !== hint.projectId) throw conflict('The case project scope changed during the command.', current.version, 'PROJECT_SCOPE_CONFLICT');
      await this.verifyProcessBehaviorTestPlans(current, client);
      await this.verifyProcessBehaviorEvaluations(current, client);
      const prior = current.idempotency?.[commandId];
      if (prior) {
        if (prior.action !== 'link-process-run-evidence' || prior.requestHash !== requestHash) throw conflict('This command ID was already used with different input.', current.version, 'IDEMPOTENCY_CONFLICT');
        const link = current.artifacts?.requirements?.processRunEvidenceLinks?.find((entry) => entry.id === prior.linkId);
        if (!link) throw persistenceIntegrity('A process-run evidence replay has no retained link.');
        return { changeCase: current, link, replayed: true };
      }
      if (current.version !== expectedVersion) throw conflict('The case changed before the process run could be linked.', current.version);
      if (!current.sourceBinding || current.tenantId !== tenantId || !current.projectId) throw projectAccessDenied();
      const sourceBindingIntegrity = verifySourceBinding(current.sourceBinding);
      if (sourceBindingIntegrity.valid !== true) throw persistenceIntegrity('The saved source binding is invalid; process-run provenance cannot be attached.');
      const requirements = current.artifacts?.requirements;
      if (!requirements || requirements.acceptedBaseline || current.currentStage !== 'S4'
        || requirements.draftRevision !== expectedDraftRevision) throw conflict('The requirement draft changed or is no longer open.', current.version, 'REQUIREMENT_DRAFT_STALE');
      const contextIntegrity = verifyContextManifest(current);
      if (!current.artifacts?.context || contextIntegrity.valid !== true) throw persistenceIntegrity('The saved context manifest is missing or invalid; process-run provenance cannot be attached.');
      const requirement = requirements.requirements.find((entry) => entry.id === requirementId && entry.processTrace && entry.verificationContract);
      if (!requirement || current.processRequirementTrace?.traceHash !== requirement.processTrace.traceHash) throw persistenceIntegrity('The process requirement trace is not the retained case source.');
      const trace = requirement.processTrace;
      const { traceHash, ...traceCore } = trace;
      const { contractHash, ...contractCore } = requirement.verificationContract;
      if (digest(traceCore) !== traceHash || digest(contractCore) !== contractHash
        || current.sourceBinding.bindingHash !== trace.source.bindingHash
        || current.sourceBinding.projectId !== current.projectId || current.sourceBinding.objectId !== trace.process.id
        || current.sourceBinding.sourceHash !== trace.source.sourceHash) throw persistenceIntegrity('The requirement trace, contract, or saved source binding failed integrity verification.');
      const projectRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, current.projectId]);
      if (!projectRow.rowCount) throw projectAccessDenied();
      const project = verifyAggregateRow(projectRow.rows[0]);
      const blueprint = (project.blueprintVersions ?? []).find((entry) => entry.id === trace.source.blueprintId && entry.version === trace.source.blueprintVersion);
      if (!blueprint || contentHash(blueprint) !== trace.source.blueprintSnapshotHash) throw conflict('The pinned source blueprint is unavailable or changed.', current.version, 'PROCESS_SOURCE_STALE');
      const sourceProcess = Object.values(blueprint.areas ?? {}).flatMap((area) => area.items ?? []).find((entry) => entry.id === trace.process.id && entry.type === 'process');
      if (!sourceProcess || contentHash(sourceProcess) !== trace.source.processSnapshotHash) throw conflict('The selected process snapshot does not match the requirement trace.', current.version, 'PROCESS_SOURCE_STALE');
      let run = null;
      let ref;
      let humanRuntime = null;
      let runEvents = [];
      if (runSelector) {
        const runRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for share`, [tenantId, runId]);
        if (!runRow.rowCount) throw conflict('The selected persisted process run is unavailable in this project.', current.version, 'PROCESS_RUN_NOT_FOUND');
        run = verifyAggregateRow(runRow.rows[0]);
        ref = run.processTaskRef;
        if (run.projectId !== current.projectId || ref?.blueprintId !== trace.source.blueprintId
          || Number(ref?.blueprintVersion) !== trace.source.blueprintVersion
          || !ref?.processId || !ref?.processPlanId || !ref?.planInstanceId || !ref?.taskId) throw conflict('The run does not match the exact selected project and blueprint.', current.version, 'PROCESS_RUN_SOURCE_MISMATCH');
        runEvents = run.events ?? [];
        const validRunEvents = runEvents.every((event) => {
          const { contentHash: hash, ...core } = event ?? {};
          return /^[a-f0-9]{64}$/.test(hash ?? '') && contentHash(core) === hash;
        });
        const requestedEvents = runEvents.filter((event) => event.type === 'ExecutionRequested');
        const requestedRef = requestedEvents[0]?.data?.processTaskRef;
        const expectedRequestedRef = { processPlanId: ref.processPlanId, revision: ref.revision, planInstanceId: ref.planInstanceId,
          taskId: ref.taskId, blueprintId: ref.blueprintId, blueprintVersion: ref.blueprintVersion,
          ...(ref.flowBinding ? { flowBinding: ref.flowBinding } : {}), ...(ref.delegation ? { delegation: ref.delegation } : {}),
          ...(ref.behaviorTestPlan ? { behaviorTestPlan: ref.behaviorTestPlan } : {}),
          ...(ref.repository ? { repository: ref.repository } : {}) };
        if (!validRunEvents || requestedEvents.length !== 1 || contentHash(requestedRef ?? null) !== contentHash(expectedRequestedRef)) {
          throw persistenceIntegrity('The persisted run request event does not authenticate its process-task reference.');
        }
        const runEventAudit = await client.query(`select count(*)::int as count from orgward.audit_log
          where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 and event_hash = any($3::text[])`,
        [tenantId, run.id, runEvents.map((event) => contentHash(event))]);
        if (Number(runEventAudit.rows[0]?.count) !== runEvents.length) throw persistenceIntegrity('A persisted run event is missing its durable audit record.');
      } else {
        const selected = await client.query(`select * from orgward.process_task_instances
          where tenant_id=$1 and project_id=$2 and plan_instance_id=$3 and task_id=$4 for share`,
        [tenantId, current.projectId, planInstanceId, taskId]);
        if (!selected.rowCount) throw conflict('The selected human task completion is unavailable in this project.', current.version, 'PROCESS_TASK_NOT_FOUND');
        humanRuntime = selected.rows[0];
        if (humanRuntime.actor_type !== 'human' || humanRuntime.execution_run_id
          || humanRuntime.status !== 'SUCCEEDED'
          || humanRuntime.blueprint_id !== trace.source.blueprintId
          || Number(humanRuntime.blueprint_version) !== trace.source.blueprintVersion) {
          throw conflict('The selected human task does not match the exact completed process source.', current.version, 'PROCESS_TASK_SOURCE_MISMATCH');
        }
        ref = { processPlanId: humanRuntime.process_plan_id, revision: Number(humanRuntime.plan_revision),
          planInstanceId: humanRuntime.plan_instance_id, taskId: humanRuntime.task_id, processId: humanRuntime.process_id,
          blueprintId: humanRuntime.blueprint_id, blueprintVersion: Number(humanRuntime.blueprint_version) };
      }
      const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId: current.projectId, project, planId: ref.processPlanId, revision: Number(ref.revision) });
      if (!plan || plan.source?.blueprintId !== trace.source.blueprintId || Number(plan.source?.blueprintVersion) !== trace.source.blueprintVersion
        || plan.source?.processId !== ref.processId || (humanRuntime && humanRuntime.process_id !== plan.source.processId)) {
        throw persistenceIntegrity('The persisted task runtime does not resolve to its plan’s pinned root process.');
      }
      const planHash = plan.snapshotHash ?? contentHash(plan);
      if (!/^[a-f0-9]{64}$/.test(planHash)) throw persistenceIntegrity('The persisted run plan has no stable content hash.');
      const task = plan.tasks?.find((entry) => entry.id === ref.taskId);
      if (!task || task.sourceProcessId !== trace.process.id || !Array.isArray(task.outputs)
        || contentHash(task.outputs.map((entry) => ({ id: entry.objectId ?? entry.id, type: entry.type })).sort((a,b) => a.id.localeCompare(b.id)))
          !== contentHash(trace.outcome.outputRefs.map(({ id, type }) => ({ id, type })).sort((a,b) => a.id.localeCompare(b.id)))) {
        throw conflict('The run task does not declare the exact outputs in this requirement trace.', current.version, 'PROCESS_RUN_OUTPUT_MISMATCH');
      }
      const runtimeResult = humanRuntime ? { rowCount: 1, rows: [humanRuntime] }
        : await client.query(`select * from orgward.process_task_instances where tenant_id=$1 and project_id=$2 and plan_instance_id=$3 and task_id=$4 for share`, [tenantId, current.projectId, ref.planInstanceId, ref.taskId]);
      if (!runtimeResult.rowCount) throw persistenceIntegrity('The linked run has no canonical persisted process-task instance.');
      const runtime = runtimeResult.rows[0];
      if (run) assertLinkedWorkloadRuntime(runtime, run);
      else if (runtime.actor_type !== 'human' || runtime.execution_run_id || runtime.status !== 'SUCCEEDED') {
        throw conflict('Only a completed human task without a workload run can use this selector.', current.version, 'PROCESS_TASK_SOURCE_MISMATCH');
      }
      if (runtime.process_id !== ref.processId) throw persistenceIntegrity('The canonical task instance does not match its pinned process source.');
      const runtimeEvents = runtime.events ?? [];
      if (!runtimeEvents.length || !runtimeEvents.every((event) => {
        const { contentHash: hash, ...core } = event ?? {};
        return /^[a-f0-9]{64}$/.test(hash ?? '') && contentHash(core) === hash;
      })) throw persistenceIntegrity('The canonical process-task instance event history failed integrity verification.');
      const runtimeEventAudit = await client.query(`select count(*)::int as count from orgward.audit_log
        where tenant_id=$1 and aggregate_kind='process_task_instance' and aggregate_id=$2 and event_hash = any($3::text[])`,
      [tenantId, `${runtime.plan_instance_id}:${runtime.task_id}`, runtimeEvents.map((event) => contentHash(event))]);
      if (Number(runtimeEventAudit.rows[0]?.count) !== runtimeEvents.length) throw persistenceIntegrity('A process-task instance event is missing its durable audit record.');
      let outputEvidence;
      let repositoryCheckEvidence = [];
      let repositoryCheckEvidenceStatus = 'NOT_APPLICABLE';
      let behaviorEvaluation = null;
      if (run) {
        outputEvidence = trace.outcome.outputRefs.map(({ id, type, snapshotHash }) => ({ id, type, snapshotHash, status: 'UNAVAILABLE' }));
        const candidate = run.execution?.repositoryCandidate;
        const configuredChecks = Boolean(run.githubPatchSelection?.checkPlan);
        const activeRun = ['AWAITING_APPROVAL', 'APPROVED', 'RUNNING', 'PAUSED'].includes(run.status);
        const hasRepositoryChecks = Boolean(candidate?.checkPlan || candidate?.checkReceipts
          || (configuredChecks && candidate && ['SUCCEEDED', 'FAILED'].includes(run.status)));
        repositoryCheckEvidence = verifiedRepositoryCheckEvidence(run, ref, trace) ?? [];
        if (hasRepositoryChecks && !repositoryCheckEvidence.length) {
          throw persistenceIntegrity('The persisted repository-check evidence does not match its exact run, task, plan, or candidate pins.');
        }
        repositoryCheckEvidenceStatus = repositoryCheckEvidence.length ? 'AVAILABLE'
          : configuredChecks && activeRun ? 'PENDING'
            : configuredChecks ? 'NOT_PRODUCED' : 'NOT_CONFIGURED';
        if (ref.behaviorTestPlan) {
          if (ref.behaviorTestPlan.caseId !== current.id) throw conflict('The authorized behavior plan belongs to another case.', current.version, 'BEHAVIOR_TEST_PLAN_SCOPE_MISMATCH');
          const behaviorPlan = (current.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === ref.behaviorTestPlan.planId);
          const currentRequirementHash = contentHash(Object.fromEntries(Object.entries(requirement)
            .filter(([key]) => !['processRunEvidenceLinks', 'processRunEvidenceReviews', 'processIntentEvaluationAcceptances', 'behaviorTestPlans'].includes(key))));
          if (!behaviorPlan || !verifyProcessBehaviorTestPlan(behaviorPlan)
            || behaviorPlan.planHash !== ref.behaviorTestPlan.planHash || behaviorPlan.requirementId !== requirement.id
            || behaviorPlan.requirementHash !== currentRequirementHash || behaviorPlan.traceHash !== trace.traceHash
            || behaviorPlan.draftRevision !== requirements.draftRevision
            || behaviorPlan.processPlan?.id !== plan.id || Number(behaviorPlan.processPlan?.revision) !== Number(plan.revision)
            || behaviorPlan.processPlan?.taskId !== task.id || behaviorPlan.source?.processSnapshotHash !== trace.source.processSnapshotHash) {
            throw conflict('The authorized assertion plan is stale or does not match this exact requirement and task.', current.version, 'BEHAVIOR_TEST_PLAN_STALE');
          }
          behaviorEvaluation = evaluateAuthorizedBehaviorPlan(run, behaviorPlan, trace);
          if (!behaviorEvaluation) throw persistenceIntegrity('The linked run does not contain valid preauthorized per-assertion evidence.');
          const disposition = processBehaviorCandidateDisposition({ evaluationStatus: behaviorEvaluation.status,
            riskCoverage: behaviorEvaluation.riskCoverage, assertions: behaviorEvaluation.assertions });
          if (disposition !== 'PENDING_INDEPENDENT_REVIEW') {
            if (disposition === 'REJECTED') {
              const failedAssertions = (behaviorEvaluation.assertions ?? []).filter((entry) => entry?.status !== 'TEST_PASS')
                .slice(0, 20).map((entry) => ({
                  id: typeof entry.id === 'string' ? entry.id.slice(0, 120) : 'unknown-assertion',
                  name: typeof entry.testName === 'string' ? entry.testName.slice(0, 180) : 'Unnamed assertion',
                  status: ['TEST_FAIL', 'UNKNOWN'].includes(entry.status) ? entry.status : 'UNKNOWN',
                  ...(typeof entry.reason === 'string' ? { reason: entry.reason.slice(0, 120) } : {}),
                }));
              const summary = failedAssertions.map((entry) => `${entry.name} (${entry.status}${entry.reason ? `: ${entry.reason}` : ''})`).join('; ');
              const error = conflict(`No evidence link was saved. The candidate was rejected because ${summary || 'a declared assertion did not pass'}.`,
                current.version, 'BEHAVIOR_CANDIDATE_REJECTED');
              error.details = { failedAssertions };
              throw error;
            }
            throw conflict('Independent assurance cannot admit this candidate until exact linked-risk and executed assertion evidence are available.',
              current.version, 'BEHAVIOR_CANDIDATE_INCOMPLETE');
          }
        }
      } else {
        verifyPersistedOutputRecords(runtime);
        const completedEvents = runtimeEvents.filter((event) => event.type === 'HumanTaskCompleted'
          && event.data?.planInstanceId === ref.planInstanceId && event.data?.taskId === ref.taskId);
        if (completedEvents.length !== 1 || completedEvents[0].data.result !== 'succeeded') {
          throw persistenceIntegrity('The human task completion event is missing or does not match the successful runtime outcome.');
        }
        const completionEvent = completedEvents[0];
        const completionAudit = await client.query(`select command_id,event,event_hash,actor,aggregate_version from orgward.audit_log
          where tenant_id=$1 and aggregate_kind='process_task_instance' and aggregate_id=$2
            and event_type='HumanTaskCompleted' and event_hash=$3`,
        [tenantId, `${runtime.plan_instance_id}:${runtime.task_id}`, contentHash(completionEvent)]);
        if (completionAudit.rowCount !== 1 || contentHash(completionAudit.rows[0].event) !== contentHash(completionEvent)
          || completionAudit.rows[0].actor !== completionEvent.actor || Number(completionAudit.rows[0].aggregate_version) !== Number(runtime.version)
          || !completionAudit.rows[0].command_id) throw persistenceIntegrity('The human completion has no matching durable audit command.');
        const completionCommand = await client.query(`select * from orgward.command_results
          where tenant_id=$1 and operation='execution.process-task.human-complete' and command_id=$2
            and aggregate_kind='process_task_instance' and aggregate_id=$3`,
        [tenantId, completionAudit.rows[0].command_id, `${runtime.plan_instance_id}:${runtime.task_id}`]);
        if (completionCommand.rowCount !== 1 || !/^[a-f0-9]{64}$/.test(completionCommand.rows[0].payload_hash ?? '')) {
          throw persistenceIntegrity('The human completion has no matching durable command result.');
        }
        const completionResult = verifyCommandRow(completionCommand.rows[0]);
        if (completionResult.projectId !== current.projectId || completionResult.planId !== plan.id
          || Number(completionResult.revision) !== Number(plan.revision) || completionResult.planInstanceId !== ref.planInstanceId
          || completionResult.taskId !== task.id || completionResult.status !== runtime.status
          || Number(completionResult.version) !== Number(runtime.version)) {
          throw persistenceIntegrity('The human completion command result does not match the canonical runtime row.');
        }
        const assignee = effectiveHumanAssignee(runtime);
        const humanOutputRecords = runtime.outcome.outputRecords ?? [];
        const outputIds = humanOutputRecords.map((record) => record.outputId);
        if (humanOutputRecords.length !== trace.outcome.outputRefs.length || new Set(outputIds).size !== outputIds.length
          || trace.outcome.outputRefs.some(({ id }) => !outputIds.includes(id))) {
          throw persistenceIntegrity('The persisted human output set does not exactly match the traced output declarations.');
        }
        if (completionEvent.actor !== runtime.outcome.outputRecords?.[0]?.reporterPrincipal
          && runtime.outcome.outputRecords?.some((record) => record.status === 'HUMAN_REPORTED')) {
          throw persistenceIntegrity('The human output reporter does not match the completion event actor.');
        }
        outputEvidence = trace.outcome.outputRefs.map(({ id, type, snapshotHash }) => {
          const record = runtime.outcome.outputRecords?.find((entry) => entry.outputId === id);
          const definition = Object.values(blueprint.areas ?? {}).flatMap((area) => area.items ?? []).find((entry) => entry.id === id);
          if (!record || !definition || definition.type !== type || digest(definition) !== snapshotHash
            || record.outputType !== type || record.referenceHash !== contentHash({ id, type, definition })) {
            throw persistenceIntegrity('A persisted human output does not match the exact declared blueprint reference.');
          }
          if (record.blueprintId !== blueprint.id || Number(record.blueprintVersion) !== Number(blueprint.version)
            || record.blueprintHash !== contentHash(blueprint) || record.sourceProcessId !== trace.process.id
            || record.planHash !== contentHash(plan) || record.taskHash !== contentHash(task)
            || record.reporterPrincipal !== completionEvent.actor || record.assignedPrincipal !== assignee.principal) {
            throw persistenceIntegrity('A persisted human output does not match its exact task, source, or reporter provenance.');
          }
          return { id, type, snapshotHash, status: record.status, recordHash: record.recordHash,
            referenceHash: record.referenceHash, reporterPrincipal: record.reporterPrincipal,
            assignedPrincipal: record.assignedPrincipal, completionEventId: completionEvent.id,
            completionEventHash: contentHash(completionEvent), completionCommandId: completionAudit.rows[0].command_id,
            sourceRuntimeVersion: record.sourceRuntimeVersion,
            ...(record.status === 'HUMAN_REPORTED' ? { value: structuredClone(record.value) } : {}) };
        });
      }
      const linkCore = { schemaVersion: 1, id: `process-run-link-${randomUUID()}`, status: 'UNVERIFIED', verificationStatus: 'NOT_EXECUTED',
        reason: run ? 'The persisted run and task are pinned; no authorized typed human output record is attached to this workload run.'
          : 'The exact human-reported output records are pinned to the completion, but human reports are not truth-verified and no behavior verification was executed.',
        tenantId, projectId: current.projectId, caseId, requirementId: requirement.id, draftRevision: requirements.draftRevision,
        requirementHash: contentHash(Object.fromEntries(Object.entries(requirement)
          .filter(([key]) => !['processRunEvidenceLinks', 'processRunEvidenceReviews'].includes(key)))),
        traceHash: trace.traceHash, contractHash: requirement.verificationContract.contractHash,
        source: { projectId: project.id, projectVersion: trace.source.projectVersion, blueprintId: trace.source.blueprintId,
          blueprintVersion: trace.source.blueprintVersion, blueprintSnapshotHash: trace.source.blueprintSnapshotHash,
          processId: trace.process.id, processSnapshotHash: trace.source.processSnapshotHash, bindingHash: trace.source.bindingHash },
        plan: { id: plan.id, revision: Number(plan.revision), snapshotHash: planHash, rootProcessId: plan.source.processId,
          taskId: task.id, taskHash: contentHash(task), selectedProcessId: task.sourceProcessId },
        outputs: trace.outcome.outputRefs.map(({ id, type, snapshotHash }) => ({ id, type, snapshotHash })),
        outputEvidence,
        repositoryCheckEvidence,
        repositoryCheckEvidenceStatus,
        ...(behaviorEvaluation ? { behaviorEvaluation } : {}),
        instance: { id: ref.planInstanceId, taskId: ref.taskId, version: Number(runtime.version), status: runtime.status,
          runtimeHash: contentHash({ ...runtime, started_at: runtime.started_at?.toISOString?.() ?? runtime.started_at,
            completed_at: runtime.completed_at?.toISOString?.() ?? runtime.completed_at, created_at: runtime.created_at?.toISOString?.() ?? runtime.created_at,
            updated_at: runtime.updated_at?.toISOString?.() ?? runtime.updated_at }), eventHashes: runtimeEvents.map((event) => contentHash(event)) },
        ...(run ? { run: { id: run.id, version: run.version, status: run.status, requestedBy: run.requestedBy,
          aggregateHash: contentHash(run), eventHashes: runEvents.map((event) => contentHash(event)) } }
          : { runtimeSource: { kind: 'human-task-completion', planInstanceId: ref.planInstanceId, taskId: ref.taskId,
            completionEventId: outputEvidence[0]?.completionEventId ?? runtimeEvents.find((event) => event.type === 'HumanTaskCompleted')?.id,
            completionEventHash: outputEvidence[0]?.completionEventHash ?? contentHash(runtimeEvents.find((event) => event.type === 'HumanTaskCompleted')) } }),
        actor: principal, linkedAt: new Date().toISOString() };
      const link = { ...linkCore, linkHash: contentHash(linkCore) };
      requirement.processRunEvidenceLinks ??= [];
      requirement.processRunEvidenceLinks.push(link);
      requirements.processRunEvidenceLinks ??= [];
      requirements.processRunEvidenceLinks.push(link);
      current.version += 1; current.updatedAt = link.linkedAt;
      current.idempotency ??= {};
      current.idempotency[commandId] = { action: 'link-process-run-evidence', requestHash, linkId: link.id, version: current.version, at: link.linkedAt };
      const event = { id: `event-${randomUUID()}`, type: 'ProcessRunEvidenceLinked', schemaVersion: 1, tenantId,
        actor: principal, correlationId: current.correlationId, causationId: commandId, timestamp: link.linkedAt,
        data: { linkId: link.id, linkHash: link.linkHash, requirementId: requirement.id, runId: run?.id ?? null,
          ...(run ? {} : { planInstanceId: ref.planInstanceId, taskId: ref.taskId }), verificationStatus: 'NOT_EXECUTED' },
        contentHash: contentHash({ type: 'ProcessRunEvidenceLinked', tenantId, data: { linkId: link.id, linkHash: link.linkHash, requirementId: requirement.id,
          runId: run?.id ?? null, ...(run ? {} : { planInstanceId: ref.planInstanceId, taskId: ref.taskId }), verificationStatus: 'NOT_EXECUTED' } }) };
      current.events.push(event);
      await this.saveInTransaction(client, current, { expectedVersion, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      return { changeCase: current, link, replayed: false };
    });
  }
  async observePersistedRepositoryCheck({ id: caseId, tenantId, principal, authzGeneration, requirementId, linkId, expectedVersion, expectedDraftRevision, commandId }) {
    if (!principal || !/^REQ-PROC-[a-f0-9]{12}$/.test(requirementId ?? '')
      || !/^process-run-link-[0-9a-f-]{36}$/i.test(linkId ?? '')
      || !Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(expectedDraftRevision)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(commandId ?? '')) throw projectAccessDenied();
    const operation = 'sdlc.repository-check-observation';
    const requestHash = contentHash({ caseId, requirementId, linkId, expectedVersion, expectedDraftRevision, principal });
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintRow.rowCount) return null;
      const hint = verifyAggregateRow(hintRow.rows[0]);
      if (!hint.projectId) throw projectAccessDenied();
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'editor' });
      const caseRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!caseRow.rowCount) return null;
      const current = verifyAggregateRow(caseRow.rows[0]);
      if (current.projectId !== hint.projectId || current.tenantId !== tenantId) throw conflict('The case project scope changed during the observation.', current.version, 'PROJECT_SCOPE_CONFLICT');
      const prior = current.idempotency?.[commandId];
      if (prior) {
        if (prior.action !== 'observe-repository-check' || prior.requestHash !== requestHash) throw conflict('This command ID was already used with different observation input.', current.version, 'IDEMPOTENCY_CONFLICT');
        await this.verifyRepositoryCheckObservations(current, client);
        const observations = current.artifacts?.repositoryCheckObservations ?? [];
        const result = observations.find((entry) => entry.id === prior.observationId);
        if (!result || result.contentHash !== contentHash(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'contentHash')))) throw persistenceIntegrity('A repository-check observation replay has no valid retained record.');
        const events = (current.events ?? []).filter((event) => event.type === 'RepositoryCheckObserved' && event.data?.observationId === result.id);
        const replayAudit = events.length === 1 ? await client.query(`select event_hash,command_id,actor,aggregate_version,event
          from orgward.audit_log where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
        [tenantId, current.id, contentHash(events[0])]) : { rowCount: 0, rows: [] };
        const replayEvent = events[0]; const replayAuditRow = replayAudit.rows[0];
        if (events.length !== 1 || replayEvent.data.observationHash !== result.contentHash
          || replayEvent.causationId !== commandId || !replayAuditRow || replayAudit.rowCount !== 1
          || contentHash(replayAuditRow.event) !== contentHash(replayEvent) || replayAuditRow.actor !== principal
          || replayAuditRow.command_id !== commandId || Number(replayAuditRow.aggregate_version) !== Number(prior.version)) {
          throw persistenceIntegrity('A repository-check observation replay has no matching append-only event and audit.');
        }
        let replayProposal = null;
        if (replayEvent.data.proposalId) {
          replayProposal = (current.artifacts.repositoryCheckProposals ?? []).find((entry) => entry.id === replayEvent.data.proposalId);
          const retainedProposal = replayProposal;
          if (!retainedProposal || retainedProposal.contentHash !== contentHash(Object.fromEntries(Object.entries(retainedProposal).filter(([key]) => key !== 'contentHash')))) {
            throw persistenceIntegrity('A repository-check correction proposal failed replay integrity verification.');
          }
        }
        return { changeCase: current, observation: result, proposal: replayProposal, replayed: true };
      }
      if (current.version !== expectedVersion) throw conflict('The change case changed before repository-check evidence could be observed.', current.version);
      const reqs = current.artifacts?.requirements;
      if (!reqs || reqs.acceptedBaseline || current.currentStage !== 'S4' || reqs.draftRevision !== expectedDraftRevision) throw conflict('The requirement draft changed; relink current evidence.', current.version, 'REQUIREMENT_DRAFT_STALE');
      if (!current.sourceBinding || verifySourceBinding(current.sourceBinding).valid !== true || verifyContextManifest(current).valid !== true) throw persistenceIntegrity('The case source binding or context manifest is invalid.');
      const requirement = reqs.requirements?.find((entry) => entry.id === requirementId && entry.processTrace);
      const link = requirement?.processRunEvidenceLinks?.find((entry) => entry.id === linkId);
      if (!requirement || !link || link.repositoryCheckEvidenceStatus !== 'AVAILABLE' || !link.repositoryCheckEvidence?.length) throw conflict('The selected link has no available repository-check receipts.', current.version, 'REPOSITORY_CHECK_NOT_AVAILABLE');
      const requirementCore = Object.fromEntries(Object.entries(requirement).filter(([key]) => !['processRunEvidenceLinks', 'processRunEvidenceReviews'].includes(key)));
      const requirementHash = contentHash(requirementCore);
      const trace = requirement.processTrace;
      const { traceHash, ...traceCore } = trace;
      const { contractHash, ...contractCore } = requirement.verificationContract ?? {};
      const { linkHash, ...linkCore } = link;
      const expectedSource = { projectId: trace.source.projectId, projectVersion: trace.source.projectVersion,
        blueprintId: trace.source.blueprintId, blueprintVersion: trace.source.blueprintVersion,
        blueprintSnapshotHash: trace.source.blueprintSnapshotHash, processId: trace.process.id,
        processSnapshotHash: trace.source.processSnapshotHash, bindingHash: trace.source.bindingHash };
      if (contentHash(linkCore) !== linkHash || link.status !== 'UNVERIFIED' || link.verificationStatus !== 'NOT_EXECUTED'
        || link.tenantId !== tenantId || link.projectId !== current.projectId || link.caseId !== caseId
        || link.requirementId !== requirementId || link.draftRevision !== expectedDraftRevision || link.requirementHash !== requirementHash
        || link.traceHash !== traceHash || traceHash !== current.processRequirementTrace?.traceHash || contentHash(traceCore) !== traceHash
        || !contractHash || digest(contractCore) !== contractHash || link.contractHash !== contractHash
        || contentHash(link.source) !== contentHash(expectedSource)
        || contentHash(link.outputs) !== contentHash(trace.outcome.outputRefs.map(({ id, type, snapshotHash }) => ({ id, type, snapshotHash })))
        || link.plan?.taskId !== link.instance?.taskId || !link.run?.id) throw persistenceIntegrity('The repository-check link does not match its exact requirement and source pins.');
      if ((current.artifacts.repositoryCheckObservations ?? []).some((entry) => entry.linkId === link.id && entry.linkHash === link.linkHash)) {
        throw conflict('This immutable repository-check link already has an observation. Replay the original command to retrieve it.', current.version, 'REPOSITORY_CHECK_ALREADY_OBSERVED');
      }
      const linkEvent = (current.events ?? []).filter((event) => event.type === 'ProcessRunEvidenceLinked' && event.data?.linkId === link.id);
      if (linkEvent.length !== 1 || linkEvent[0].data.linkHash !== link.linkHash || linkEvent[0].data.runId !== link.run.id) throw persistenceIntegrity('The repository-check link has no unique matching run event.');
      const linkAudit = await client.query(`select count(*)::int as count from orgward.audit_log where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`, [tenantId, caseId, contentHash(linkEvent[0])]);
      if (Number(linkAudit.rows[0]?.count) !== 1) throw persistenceIntegrity('The repository-check link has no durable audit record.');
      const projectRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, current.projectId]);
      if (!projectRow.rowCount) throw projectAccessDenied();
      const project = verifyAggregateRow(projectRow.rows[0]);
      const blueprint = (project.blueprintVersions ?? []).find((entry) => entry.id === link.source.blueprintId && entry.version === link.source.blueprintVersion);
      if (!blueprint || contentHash(blueprint) !== link.source.blueprintSnapshotHash) throw conflict('The selected design source is stale.', current.version, 'PROCESS_SOURCE_STALE');
      const latest = latestBlueprint(project);
      if (!latest || latest.id !== blueprint.id || latest.version !== blueprint.version || contentHash(latest) !== contentHash(blueprint)) throw conflict('The selected design source is no longer current.', current.version, 'PROCESS_SOURCE_STALE');
      const runRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for share`, [tenantId, link.run.id]);
      if (!runRow.rowCount) throw conflict('The linked execution run is unavailable.', current.version, 'PROCESS_RUN_NOT_FOUND');
      const run = verifyAggregateRow(runRow.rows[0]);
      const ref = run.processTaskRef;
      if (run.projectId !== current.projectId || !ref || ref.planInstanceId !== link.instance.id || ref.taskId !== link.plan.taskId
        || ref.processPlanId !== link.plan.id || Number(ref.revision) !== Number(link.plan.revision)
        || ref.blueprintId !== link.source.blueprintId || Number(ref.blueprintVersion) !== Number(link.source.blueprintVersion)) throw persistenceIntegrity('The stored run does not match the linked process identity.');
      if (link.run.aggregateHash !== contentHash(run) || Number(link.run.version) !== Number(run.version)
        || link.run.status !== run.status || contentHash(link.run.eventHashes) !== contentHash((run.events ?? []).map((event) => contentHash(event)))) {
        throw persistenceIntegrity('The run aggregate no longer matches the linked run pins.');
      }
      const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId: current.projectId, project, planId: ref.processPlanId, revision: Number(ref.revision) });
      const task = plan?.tasks?.find((entry) => entry.id === ref.taskId);
      if (!plan || (plan.snapshotHash ?? contentHash(plan)) !== link.plan.snapshotHash || !task
        || contentHash(task) !== link.plan.taskHash || task.sourceProcessId !== trace.process.id
        || plan.source?.processId !== ref.processId || plan.source?.blueprintId !== blueprint.id
        || Number(plan.source?.blueprintVersion) !== Number(blueprint.version)) throw persistenceIntegrity('The linked plan/task no longer resolves to its exact pinned source.');
      const runtimeResult = await client.query(`select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and plan_instance_id=$3 and task_id=$4 for share`,
      [tenantId, current.projectId, ref.planInstanceId, ref.taskId]);
      if (!runtimeResult.rowCount) throw persistenceIntegrity('The linked run has no canonical process-task runtime row.');
      const runtime = runtimeResult.rows[0];
      assertLinkedWorkloadRuntime(runtime, run);
      const runtimeHash = contentHash({ ...runtime, started_at: runtime.started_at?.toISOString?.() ?? runtime.started_at,
        completed_at: runtime.completed_at?.toISOString?.() ?? runtime.completed_at, created_at: runtime.created_at?.toISOString?.() ?? runtime.created_at,
        updated_at: runtime.updated_at?.toISOString?.() ?? runtime.updated_at });
      if (runtimeHash !== link.instance.runtimeHash || Number(runtime.version) !== Number(link.instance.version)
        || contentHash((runtime.events ?? []).map((event) => contentHash(event))) !== contentHash(link.instance.eventHashes)) throw persistenceIntegrity('The canonical runtime row no longer matches the linked instance pins.');
      const runtimeEvents = runtime.events ?? [];
      if (!runtimeEvents.length || !runtimeEvents.every((event) => { const { contentHash: hash, ...core } = event ?? {}; return /^[a-f0-9]{64}$/.test(hash ?? '') && contentHash(core) === hash; })) {
        throw persistenceIntegrity('The canonical process-task event history is invalid.');
      }
      const runtimeAudit = await client.query(`select count(*)::int as count from orgward.audit_log
        where tenant_id=$1 and aggregate_kind='process_task_instance' and aggregate_id=$2 and event_hash = any($3::text[])`,
      [tenantId, `${runtime.plan_instance_id}:${runtime.task_id}`, runtimeEvents.map((event) => contentHash(event))]);
      if (Number(runtimeAudit.rows[0]?.count) !== runtimeEvents.length) throw persistenceIntegrity('The canonical process-task events lack durable audit records.');
      const receipts = verifiedRepositoryCheckEvidence(run, ref, { source: { projectId: current.projectId } });
      if (!receipts?.length || contentHash(receipts) !== contentHash(link.repositoryCheckEvidence)) throw persistenceIntegrity('The stored repository-check receipts no longer match the linked evidence.');
      const runEvents = run.events ?? [];
      const terminal = runEvents.filter((event) => ['ExecutionSucceeded', 'ExecutionFailed'].includes(event.type));
      if (terminal.length !== 1 || terminal[0].data?.candidateEvidenceHash !== run.execution?.evidenceHash
        || !runEvents.every((event) => { const { contentHash: hash, ...core } = event ?? {}; return /^[a-f0-9]{64}$/.test(hash ?? '') && contentHash(core) === hash; })) throw persistenceIntegrity('The execution run terminal evidence is invalid.');
      const audit = await client.query(`select count(*)::int as count from orgward.audit_log where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 and event_hash = any($3::text[])`, [tenantId, run.id, runEvents.map((event) => contentHash(event))]);
      if (Number(audit.rows[0]?.count) !== runEvents.length) throw persistenceIntegrity('The execution run is missing durable event audit records.');
      const observationCore = { id: `repository-check-observation-${randomUUID()}`, schemaVersion: 1, category: 'REPOSITORY_CHECK',
        tenantId, projectId: current.projectId, caseId, requirementId, requirementHash, draftRevision: expectedDraftRevision,
        linkId, linkHash, runId: run.id, runVersion: run.version, runAggregateHash: contentHash(run),
        projectVersion: project.version, blueprintId: blueprint.id, blueprintVersion: blueprint.version, blueprintHash: contentHash(blueprint),
        planId: link.plan.id, planRevision: link.plan.revision, planHash: link.plan.snapshotHash,
        instanceId: link.instance.id, taskId: link.plan.taskId, taskHash: link.plan.taskHash,
        candidateEvidenceHash: run.execution.evidenceHash, terminalEventHash: contentHash(terminal[0]),
        runOutcome: run.status,
        verifierResult: run.execution.repositoryCandidate.verification ? {
          id: run.execution.repositoryCandidate.verification.id, version: run.execution.repositoryCandidate.verification.version,
          profileHash: run.githubPatchSelection?.verifier?.profileHash ?? null,
          commandHash: run.execution.repositoryCandidate.verification.commandHash,
          treeDigest: run.execution.repositoryCandidate.verification.treeDigest,
          status: run.execution.repositoryCandidate.verification.status,
          exitCode: run.execution.repositoryCandidate.verification.exitCode,
          outputHash: run.execution.repositoryCandidate.verification.outputHash,
        } : null,
        checks: receipts, observedAt: new Date().toISOString(), observedBy: principal,
        businessTruthStatus: 'UNVERIFIED', verificationStatus: 'NOT_EXECUTED', causality: 'HYPOTHESIS',
        scope: 'Pinned repository candidate code and the configured check results only.' };
      const observation = { ...observationCore, contentHash: contentHash(observationCore) };
      const proposals = current.artifacts.repositoryCheckProposals ?? [];
      const failedChecks = receipts.filter((receipt) => receipt.status !== 'PASSED');
      const proposalCore = { id: `repository-check-proposal-${randomUUID()}`, type: 'DESIGN_CORRECTION_CLAIM',
          title: failedChecks.length ? 'Review code associated with a failed repository check' : 'Review design implications of repository checks',
          proposedClaim: failedChecks.length
            ? `Review the pinned candidate code and check configuration for ${failedChecks.map((entry) => entry.id).join(', ')}. This is a code-check hypothesis, not a business-behavior finding.`
            : `Review whether the passing checks for the pinned candidate code have any design implications. Passing checks do not establish business behavior.`,
          scope: observation.scope, derivedFrom: [observation.id, observation.contentHash, ...receipts.map((entry) => entry.candidateEvidenceHash)],
          evidence: { observationId: observation.id, observationHash: observation.contentHash, runId: run.id,
            runAggregateHash: contentHash(run), terminalEventHash: contentHash(terminal[0]), checks: receipts },
          status: 'PROPOSED_NOT_APPLIED', authorityRequired: true, businessTruthStatus: 'UNVERIFIED', verificationStatus: 'NOT_EXECUTED',
          causality: 'HYPOTHESIS', createdAt: observation.observedAt, createdBy: principal };
      const proposal = { ...proposalCore, contentHash: contentHash(proposalCore) };
      proposals.push(proposal);
      current.artifacts.repositoryCheckObservations ??= [];
      current.artifacts.repositoryCheckObservations.push(observation);
      current.artifacts.repositoryCheckProposals = proposals;
      current.version += 1; current.updatedAt = observation.observedAt;
      current.idempotency ??= {};
      current.idempotency[commandId] = { action: 'observe-repository-check', requestHash, observationId: observation.id, version: current.version, at: observation.observedAt };
      const eventData = { observationId: observation.id, observationHash: observation.contentHash, proposalId: proposal.id, proposalHash: proposal.contentHash,
        linkId, linkHash, runId: run.id, runAggregateHash: contentHash(run), verificationStatus: 'NOT_EXECUTED', businessTruthStatus: 'UNVERIFIED' };
      const event = { id: `event-${randomUUID()}`, type: 'RepositoryCheckObserved', schemaVersion: 1, tenantId,
        actor: principal, correlationId: current.correlationId, causationId: commandId, timestamp: observation.observedAt,
        data: eventData, contentHash: contentHash({ type: 'RepositoryCheckObserved', tenantId, data: eventData }) };
      current.events.push(event);
      await this.saveInTransaction(client, current, { expectedVersion, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      return { changeCase: current, observation, proposal, replayed: false };
    });
  }
  async reviewPersistedProcessRunEvidence({ id: caseId, tenantId, principal, authzGeneration, requirementId, linkId, criteria, scenarioCases = null, conflictResolution = null, expectedVersion, expectedDraftRevision, commandId }) {
    if (!principal || !/^REQ-PROC-[a-f0-9]{12}$/.test(requirementId ?? '')
      || !/^process-run-link-[0-9a-f-]{36}$/i.test(linkId ?? '')
      || !Array.isArray(criteria) || criteria.length < 1 || criteria.length > 32
      || !Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(expectedDraftRevision)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,119}$/.test(commandId ?? '')) throw projectAccessDenied();
    const operation = 'sdlc.process-run-evidence-review';
    const requestHash = contentHash({ caseId, requirementId, linkId, criteria, ...(scenarioCases ? { scenarioCases } : {}),
      ...(conflictResolution ? { conflictResolution } : {}), expectedVersion, expectedDraftRevision, principal });
    return this.persistence.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      await lockIdentityRows(client, tenantId, [principal]);
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const hintRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, caseId]);
      if (!hintRow.rowCount) return null;
      const hint = verifyAggregateRow(hintRow.rows[0]);
      if (!hint.projectId) throw projectAccessDenied();
      await lockProjectAccess(client, { tenantId, projectId: hint.projectId, principal, minimum: 'editor' });
      const caseRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!caseRow.rowCount) return null;
      const current = verifyAggregateRow(caseRow.rows[0]);
      if (current.projectId !== hint.projectId) throw conflict('The case project scope changed during the review.', current.version, 'PROJECT_SCOPE_CONFLICT');
      const prior = current.idempotency?.[commandId];
      if (prior) {
        if (prior.action !== 'review-process-run-evidence' || prior.requestHash !== requestHash) throw conflict('This command ID was already used with different review input.', current.version, 'IDEMPOTENCY_CONFLICT');
        const review = current.artifacts?.requirements?.requirements?.flatMap((entry) => entry.processRunEvidenceReviews ?? [])
          .find((entry) => entry.id === prior.reviewId);
        if (!review) throw persistenceIntegrity('A process evidence review replay has no retained review record.');
        const requirement = current.artifacts?.requirements?.requirements?.find((entry) => entry.id === review.requirementId);
        const verified = processEvidenceReviewState(current, requirement, review);
        const audit = verified ? await client.query(`select event_hash,command_id,actor,aggregate_version,event
          from orgward.audit_log where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
        [tenantId, current.id, contentHash(verified.event)]) : { rowCount: 0, rows: [] };
        const auditRow = audit.rows[0];
        if (!verified || audit.rowCount !== 1 || auditRow.event_hash !== contentHash(verified.event)
          || contentHash(auditRow.event) !== contentHash(verified.event) || auditRow.actor !== verified.event.actor
          || auditRow.command_id !== verified.event.causationId
          || Number(auditRow.aggregate_version) !== Number(verified.event.aggregateVersion ?? verified.idempotency.version)) {
          throw persistenceIntegrity('A process evidence review replay does not match its retained event, audit, or evidence pins.');
        }
        review.integrityStatus = 'VALID';
        return { changeCase: current, review, replayed: true };
      }
      if (current.version !== expectedVersion) throw conflict('The case changed before the evidence review could be recorded.', current.version);
      if (current.tenantId !== tenantId || !current.sourceBinding || !current.projectId) throw projectAccessDenied();
      if (verifySourceBinding(current.sourceBinding).valid !== true) throw persistenceIntegrity('The saved source binding is invalid; process evidence cannot be reviewed.');
      const contextIntegrity = verifyContextManifest(current);
      if (!current.artifacts?.context || contextIntegrity.valid !== true) throw persistenceIntegrity('The saved context manifest is invalid; process evidence cannot be reviewed.');
      const artifact = current.artifacts?.requirements;
      if (!artifact || artifact.acceptedBaseline || current.currentStage !== 'S4'
        || artifact.draftRevision !== expectedDraftRevision) throw conflict('The requirement draft changed or is no longer open.', current.version, 'REQUIREMENT_DRAFT_STALE');
      const requirement = artifact.requirements.find((entry) => entry.id === requirementId && entry.processTrace && entry.verificationContract);
      if (!requirement) throw conflict('The selected process requirement is unavailable.', current.version, 'PROCESS_REQUIREMENT_NOT_FOUND');
      const requirementCore = Object.fromEntries(Object.entries(requirement)
        .filter(([key]) => !['processRunEvidenceLinks', 'processRunEvidenceReviews'].includes(key)));
      const requirementHash = contentHash(requirementCore);
      const link = (requirement.processRunEvidenceLinks ?? []).find((entry) => entry.id === linkId);
      if (!link) throw conflict('The selected persisted runtime evidence link is unavailable.', current.version, 'PROCESS_EVIDENCE_LINK_NOT_FOUND');
      if (link.draftRevision !== expectedDraftRevision || link.requirementHash !== requirementHash) {
        throw conflict('The linked process evidence is stale for this requirement draft; link current evidence before reviewing.', current.version, 'PROCESS_EVIDENCE_LINK_STALE');
      }
      await this.verifyProcessBehaviorTestPlans(current, client);
      await this.verifyProcessBehaviorEvaluations(current, client);
      const behaviorPlan = link.behaviorEvaluation
        ? (current.artifacts?.processBehaviorTestPlans ?? []).find((entry) => entry.id === link.behaviorEvaluation.planId) : null;
      let reviewedScenarioCases = null;
      let scenarioExecutionDecisions = false;
      if (behaviorPlan) {
        const definitions = behaviorPlan.caseDefinitions?.cases ?? [];
        if (!verifyProcessBehaviorTestPlan(behaviorPlan) || behaviorPlan.planHash !== link.behaviorEvaluation.planHash
          || behaviorPlan.requirementId !== requirement.id || behaviorPlan.requirementHash !== requirementHash
          || behaviorPlan.draftRevision !== expectedDraftRevision || behaviorPlan.traceHash !== link.traceHash
          || behaviorPlan.criterionContractVersion !== requirement.criterionContract?.version
          || behaviorPlan.criterionContractHash !== requirement.criterionContract?.contentHash
          || definitions.length !== 3 || !Array.isArray(scenarioCases) || scenarioCases.length !== definitions.length) {
          throw conflict('Review requires the exact current behavior plan and all three captured scenario definitions.', current.version, 'BEHAVIOR_PLAN_REVIEW_STALE');
        }
        const decisionCount = scenarioCases.filter((entry) => Object.hasOwn(entry, 'executionDecision')).length;
        if (decisionCount !== 0 && decisionCount !== definitions.length) {
          throw conflict('Provide an execution-review decision for every scenario, or omit them all for a review-only record.', current.version, 'INVALID_SCENARIO_EXECUTION_DECISIONS');
        }
        scenarioExecutionDecisions = decisionCount === definitions.length;
        reviewedScenarioCases = definitions.map((definition) => {
          const supplied = scenarioCases.find((entry) => entry?.type === definition.type);
          const definitionHash = digest(definition);
          if (!supplied || contentHash(supplied.definition) !== contentHash(definition)) {
            throw conflict('Scenario review must submit the exact immutable case definition.', current.version, 'SCENARIO_DEFINITION_MISMATCH');
          }
          if (!['SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'].includes(supplied.disposition)
            || typeof supplied.note !== 'string' || !supplied.note.trim() || supplied.note.length > 1000) {
            throw conflict('Provide a bounded decision and note for each exact positive, negative, and recovery definition.', current.version, 'INVALID_SCENARIO_CASE_REVIEW');
          }
          if (scenarioExecutionDecisions && !['APPROVE_FOR_TEST_EXECUTION', 'REQUEST_CHANGES'].includes(supplied.executionDecision)) {
            throw conflict('Choose APPROVE_FOR_TEST_EXECUTION or REQUEST_CHANGES for each exact scenario.', current.version, 'INVALID_SCENARIO_EXECUTION_DECISION');
          }
          if (supplied.executionDecision === 'APPROVE_FOR_TEST_EXECUTION'
            && (definition.executionMapping?.status !== 'OWNER_PROPOSED_UNVERIFIED'
              || !definition.dataset || !definition.expectedOutput)) {
            throw conflict('A scenario with an incomplete dataset, oracle, assertion or test-file mapping cannot be approved for test execution.', current.version, 'SCENARIO_MAPPING_INCOMPLETE');
          }
          const executionReviewStatus = supplied.executionDecision === 'APPROVE_FOR_TEST_EXECUTION'
            ? 'REVIEWED_FOR_TEST_EXECUTION'
            : supplied.executionDecision === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : undefined;
          return { type: definition.type, definitionHash, definition: structuredClone(definition),
            disposition: supplied.disposition, note: supplied.note.trim(),
            ...(executionReviewStatus ? { executionDecision: supplied.executionDecision, executionReviewStatus } : {}) };
        });
      } else if (scenarioCases !== null) {
        throw conflict('Scenario review is only valid for a linked immutable behavior plan.', current.version, 'BEHAVIOR_PLAN_REVIEW_STALE');
      }
      const { linkHash, ...linkCore } = link;
      const trace = requirement.processTrace;
      const { traceHash, ...traceCore } = trace;
      const { contractHash, ...contractCore } = requirement.verificationContract;
      const expectedSource = { projectId: trace.source.projectId, projectVersion: trace.source.projectVersion,
        blueprintId: trace.source.blueprintId, blueprintVersion: trace.source.blueprintVersion,
        blueprintSnapshotHash: trace.source.blueprintSnapshotHash, processId: trace.process.id,
        processSnapshotHash: trace.source.processSnapshotHash, bindingHash: trace.source.bindingHash };
      if (contentHash(linkCore) !== linkHash || link.status !== 'UNVERIFIED' || link.verificationStatus !== 'NOT_EXECUTED'
        || link.tenantId !== tenantId || link.projectId !== current.projectId || link.caseId !== current.id
        || link.requirementId !== requirement.id || link.draftRevision !== expectedDraftRevision || link.requirementHash !== requirementHash
        || link.traceHash !== traceHash || traceHash !== current.processRequirementTrace?.traceHash
        || contentHash(traceCore) !== traceHash || !link.contractHash || link.contractHash !== contractHash
        || contentHash(contractCore) !== contractHash || contentHash(link.source) !== contentHash(expectedSource)
        || contentHash(link.outputs) !== contentHash(trace.outcome.outputRefs.map(({ id, type, snapshotHash }) => ({ id, type, snapshotHash })))) {
        throw persistenceIntegrity('The linked process evidence does not match the exact current requirement, trace, or source pins.');
      }
      const linkEvent = (current.events ?? []).filter((event) => event.type === 'ProcessRunEvidenceLinked' && event.data?.linkId === link.id);
      if (linkEvent.length !== 1 || linkEvent[0].data.linkHash !== link.linkHash) throw persistenceIntegrity('The process evidence link has no unique matching append-only event.');
      const linkAudit = await client.query(`select count(*)::int as count from orgward.audit_log
        where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 and event_hash=$3`,
      [tenantId, current.id, contentHash(linkEvent[0])]);
      if (Number(linkAudit.rows[0]?.count) !== 1) throw persistenceIntegrity('The process evidence link has no unique durable audit record.');
      const projectRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, current.projectId]);
      if (!projectRow.rowCount) throw projectAccessDenied();
      const project = verifyAggregateRow(projectRow.rows[0]);
      const blueprint = latestBlueprint(project);
      if (!blueprint || blueprint.id !== trace.source.blueprintId || blueprint.version !== trace.source.blueprintVersion
        || contentHash(blueprint) !== trace.source.blueprintSnapshotHash) throw conflict('The linked evidence source is stale; reload the current saved design.', current.version, 'PROCESS_SOURCE_STALE');
      const process = Object.values(blueprint.areas ?? {}).flatMap((area) => area.items ?? []).find((entry) => entry.id === trace.process.id && entry.type === 'process');
      if (!process || contentHash(process) !== trace.source.processSnapshotHash) throw conflict('The linked process no longer matches its exact saved source.', current.version, 'PROCESS_SOURCE_STALE');
      const principalActors = new Set([link.actor, current.createdBy,
        [...(current.events ?? [])].reverse().find((event) => ['GatePassed', 'GateBlocked'].includes(event.type) && event.data?.stage === 'S4'
          && Date.parse(event.timestamp ?? '') <= Date.parse(link.linkedAt ?? ''))?.actor,
        ...(link.outputEvidence ?? []).flatMap((entry) => [entry.reporterPrincipal, entry.assignedPrincipal]),
        ...(artifact.draftHistory ?? []).filter((entry) => entry.requirementId === requirement.id
          && entry.revision <= expectedDraftRevision).map((entry) => entry.actor)]
        .filter((value) => typeof value === 'string' && value.startsWith('oidc:')));
      if (behaviorPlan?.createdBy) principalActors.add(behaviorPlan.createdBy);
      if (link.run?.id) {
        const runRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for share`,
          [tenantId, link.run.id]);
        if (!runRow.rowCount) throw persistenceIntegrity('The linked workload requester record is unavailable.');
        const run = verifyAggregateRow(runRow.rows[0]);
        if (run.id !== link.run.id || run.projectId !== current.projectId || run.requestedBy !== link.run.requestedBy
          || run.version !== link.run.version) throw persistenceIntegrity('The linked workload requester does not match the canonical run.');
        principalActors.add(run.requestedBy);
        for (const event of run.events ?? []) if (typeof event.actor === 'string') principalActors.add(event.actor);
      }
      if (link.instance?.id) {
        const control = await client.query(`select project_id,process_plan_id,plan_revision,initiated_by,events from orgward.process_task_instance_controls
          where tenant_id=$1 and plan_instance_id=$2 for share`, [tenantId, link.instance.id]);
        if (control.rowCount !== 1 || control.rows[0].project_id !== current.projectId
          || control.rows[0].process_plan_id !== link.plan?.id || Number(control.rows[0].plan_revision) !== Number(link.plan?.revision)) {
          throw persistenceIntegrity('The linked process instance has no matching durable requester identity.');
        }
        principalActors.add(control.rows[0].initiated_by);
        for (const event of control.rows[0].events ?? []) if (typeof event.actor === 'string') principalActors.add(event.actor);
      }
      if (principalActors.has(principal)) throw conflict('The reviewer must be distinct from the evidence linker, performer, and recorded requirement author.', current.version, 'REVIEWER_NOT_INDEPENDENT');
      const typedDeclarations = requirement.criterionContract?.criteria;
      const declarations = Array.isArray(typedDeclarations)
        ? typedDeclarations.map((entry, index) => ({ index, criterion: entry.text, criterionHash: digest(entry),
          criterionId: entry.id, criterionType: entry.type, mandatory: entry.mandatory,
          source: entry.source, scope: entry.scope }))
        : (requirement.acceptanceCriteria ?? []).map((criterion, index) => ({
          index, criterion, criterionHash: digest({ index, criterion }),
        }));
      if (!Array.isArray(declarations) || declarations.length < 1 || declarations.length > 32 || criteria.length !== declarations.length) {
        throw conflict('The declared acceptance criteria changed or are not reviewable.', current.version, 'REQUIREMENT_CRITERIA_CHANGED');
      }
      const reviewedCriteria = declarations.map((declaration, index) => {
        const supplied = criteria[index];
        if (!supplied || supplied.criterionHash !== declaration.criterionHash
          || !['SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'].includes(supplied.disposition)
          || typeof supplied.note !== 'string' || !supplied.note.trim() || supplied.note.length > 1000) {
          throw conflict('Provide a bounded decision and note for every exact declared criterion.', current.version, 'INVALID_REVIEW_CRITERIA');
        }
        return { ...declaration, disposition: supplied.disposition, note: supplied.note.trim() };
      });
      const conflictSummary = processEvidenceReviewConflict(reviewedCriteria);
      if (conflictResolution !== null && (!conflictResolution || typeof conflictResolution !== 'object'
        || Array.isArray(conflictResolution) || Object.keys(conflictResolution).some((key) => !['decision', 'rationale'].includes(key)))) {
        throw conflict('Provide only an explicit reviewer decision and rationale for a cross-type conflict.', current.version, 'INVALID_REVIEW_RESOLUTION');
      }
      if (conflictSummary.requiresResolution && !conflictResolution) {
        throw conflict('A business/technical disagreement or failed mandatory criterion requires explicit reviewer resolution before the review can be recorded.', current.version, 'REVIEW_CONFLICT_RESOLUTION_REQUIRED');
      }
      if (!conflictSummary.requiresResolution && conflictResolution) {
        throw conflict('A reviewer resolution is not applicable because no cross-type conflict or failed mandatory criterion was found.', current.version, 'REVIEW_RESOLUTION_NOT_APPLICABLE');
      }
      if (conflictResolution && (conflictResolution.decision !== 'PRESERVE_CRITERION_OUTCOMES'
        || typeof conflictResolution.rationale !== 'string' || !conflictResolution.rationale.trim()
        || conflictResolution.rationale.length > 1000)) {
        throw conflict('Resolution must preserve each exact criterion outcome and include a bounded rationale.', current.version, 'INVALID_REVIEW_RESOLUTION');
      }
      const disposition = reviewedCriteria.some((entry) => entry.disposition === 'CONTRADICTED') ? 'CONTRADICTED'
        : reviewedCriteria.some((entry) => entry.disposition === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'SUPPORTED';
      const reviewedAt = new Date().toISOString();
      const acceptanceStatus = conflictSummary.failedMandatoryCriterionIds.length
        ? 'BLOCKED_MANDATORY_FAILURE' : 'REVIEW_ONLY_NOT_ACCEPTED';
      const persistedResolution = conflictResolution ? { schemaVersion: 1, decision: conflictResolution.decision,
        rationale: conflictResolution.rationale.trim(), businessCriterionIds: conflictSummary.conflictBusinessCriterionIds,
        technicalCriterionIds: conflictSummary.conflictTechnicalCriterionIds,
        failedMandatoryCriterionIds: conflictSummary.failedMandatoryCriterionIds, recordedBy: principal, recordedAt: reviewedAt } : null;
      const reviewCore = { schemaVersion: reviewedScenarioCases ? (scenarioExecutionDecisions ? 4 : 3) : 2, id: `process-evidence-review-${randomUUID()}`, tenantId,
        projectId: current.projectId, caseId: current.id, requirementId, draftRevision: expectedDraftRevision,
        criterionContractVersion: requirement.criterionContract?.version ?? null,
        criterionContractHash: requirement.criterionContract?.contentHash ?? null,
        requirementHash, traceHash, contractHash, linkId: link.id, linkHash: link.linkHash,
        source: structuredClone(link.source), plan: structuredClone(link.plan), instance: structuredClone(link.instance),
        ...(link.run ? { run: structuredClone(link.run) } : { runtimeSource: structuredClone(link.runtimeSource) }),
        outputPins: structuredClone(link.outputs), outputEvidenceHashes: (link.outputEvidence ?? []).map((entry) => entry.recordHash ?? null),
        criteria: reviewedCriteria, disposition, conflictResolution: persistedResolution,
        ...(reviewedScenarioCases ? { behaviorPlanId: behaviorPlan.id, behaviorPlanHash: behaviorPlan.planHash,
          evaluationContextHash: contentHash(behaviorPlan.evaluationContext), caseDefinitionsHash: contentHash(behaviorPlan.caseDefinitions),
          scenarioCases: reviewedScenarioCases } : {}),
        failedMandatoryCriterionIds: conflictSummary.failedMandatoryCriterionIds, acceptanceStatus,
        status: 'HUMAN_REVIEWED', verificationStatus: 'NOT_EXECUTED',
        truthStatus: 'UNVERIFIED', reviewerPrincipal: principal, reviewedAt, requestHash, recordedVersion: current.version + 1,
        statement: 'Human attestation against the pinned evidence and declared criteria; this does not establish external truth or execute behavior.' };
      const review = { ...reviewCore, reviewHash: contentHash(reviewCore) };
      requirement.processRunEvidenceReviews ??= [];
      requirement.processRunEvidenceReviews.push(review);
      artifact.processRunEvidenceReviews ??= [];
      artifact.processRunEvidenceReviews.push(review);
      current.version += 1; current.updatedAt = reviewedAt;
      current.idempotency ??= {};
      current.idempotency[commandId] = { action: 'review-process-run-evidence', requestHash, reviewId: review.id, version: current.version, at: reviewedAt };
      const eventData = { reviewId: review.id, reviewHash: review.reviewHash, linkId: link.id, linkHash: link.linkHash,
        requirementId, requirementHash, traceHash, contractHash, sourceHash: contentHash(review.source),
        planHash: contentHash(review.plan), instanceHash: contentHash(review.instance),
        outputPinsHash: contentHash(review.outputPins), criteriaHash: contentHash(review.criteria),
        disposition, reviewerPrincipal: principal, requestHash, recordedVersion: review.recordedVersion, status: 'HUMAN_REVIEWED',
        verificationStatus: 'NOT_EXECUTED', truthStatus: 'UNVERIFIED', reviewSchemaVersion: 2,
        conflictResolutionHash: contentHash(review.conflictResolution), failedMandatoryCriterionIds: review.failedMandatoryCriterionIds,
        acceptanceStatus: review.acceptanceStatus, criterionContractVersion: review.criterionContractVersion,
        criterionContractHash: review.criterionContractHash };
      if (reviewedScenarioCases) Object.assign(eventData, { reviewSchemaVersion: scenarioExecutionDecisions ? 4 : 3,
        behaviorPlanId: behaviorPlan.id, behaviorPlanHash: behaviorPlan.planHash,
        evaluationContextHash: review.evaluationContextHash, caseDefinitionsHash: review.caseDefinitionsHash,
        scenarioCasesHash: contentHash(reviewedScenarioCases) });
      current.events.push({ id: `event-${randomUUID()}`, type: 'ProcessRunEvidenceReviewed', schemaVersion: 2, tenantId,
        actor: principal, correlationId: current.correlationId, causationId: commandId, timestamp: reviewedAt, data: eventData,
        contentHash: contentHash({ type: 'ProcessRunEvidenceReviewed', tenantId, data: eventData }) });
      await this.saveInTransaction(client, current, { expectedVersion, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration });
      review.integrityStatus = 'VALID';
      return { changeCase: current, review, replayed: false };
    });
  }
  async saveForPrincipal(changeCase, {
    expectedVersion = null, principal, commandAuthority = null,
    approvalAuthority = null, effectAuthority = null,
  } = {}) {
    if (!principal) throw projectAccessDenied();
    const saveOptions = {
      expectedVersion, principal,
      requiredPrincipalRoles: commandAuthority?.requiredRoles ?? null,
      authzGeneration: commandAuthority?.authzGeneration ?? null,
    };
    if (!approvalAuthority && !effectAuthority) return super.save(changeCase, saveOptions);
    return this.persistence.transaction(async (client) => {
      // Lock all relevant identity authority before project membership and case rows.
      await lockIdentityRows(client, changeCase.tenantId, [principal, effectAuthority?.principal]);
      if (approvalAuthority) {
        await requirePrincipalAuthority(client, {
          tenantId: changeCase.tenantId, principal,
          roles: approvalAuthority.requiredRoles, authzGeneration: approvalAuthority.authzGeneration,
          actorType: 'human',
        });
      }
      if (commandAuthority) {
        await requirePrincipalAuthority(client, {
          tenantId: changeCase.tenantId, principal,
          roles: commandAuthority.requiredRoles, authzGeneration: commandAuthority.authzGeneration,
        });
      }
      if (effectAuthority) {
        await requirePrincipalAuthority(client, {
          tenantId: changeCase.tenantId, principal: effectAuthority.principal,
          roles: ['release-approver', 'control-owner'], authzGeneration: effectAuthority.authzGeneration,
          actorType: 'human',
        });
      }
      return this.saveInTransaction(client, changeCase, {
        ...saveOptions,
        validateCurrent: (current) => {
          if (approvalAuthority) {
            if (current.currentStage !== 'S9' || current.version !== expectedVersion
              || current.createdBy === principal) {
              throw conflict('The persisted release case is no longer approvable by this principal.', current.version, 'RELEASE_APPROVAL_STALE');
            }
            const added = (changeCase.approvals ?? []).slice(current.approvals?.length ?? 0);
            const events = (changeCase.events ?? []).slice(current.events?.length ?? 0);
            const approval = added.length === 1 ? added[0] : null;
            const bundleRef = current.artifacts?.assurance?.releaseEvidenceBundle?.id;
            if (contentHash(changeCase.approvals?.slice(0, current.approvals?.length ?? 0) ?? [])
                !== contentHash(current.approvals ?? [])
              || !approval || approval.action !== 'release' || approval.principal !== principal
              || approval.authorityGeneration !== approvalAuthority.authzGeneration
              || approval.evidenceBundleRef !== bundleRef
              || events.length !== 1 || events[0].type !== 'ReleaseApprovalRecorded'
              || events[0].actor !== principal || events[0].data?.approvalRef !== approval.id) {
              throw persistenceIntegrity('A release approval must append exactly the authenticated principal approval for the persisted evidence bundle.');
            }
          }
          if (effectAuthority) {
            const currentApproval = releaseApprovalCandidate(current);
            const nextApproval = (changeCase.approvals ?? []).find(({ id }) => id === effectAuthority.approvalRef);
            const draftBundle = current.artifacts?.assurance?.releaseEvidenceBundle;
            const finalBundle = changeCase.artifacts?.assurance?.releaseEvidenceBundle;
            const release = changeCase.artifacts?.release;
            const approvalPayload = nextApproval && Object.fromEntries(Object.entries(nextApproval).filter(([key]) => key !== 'contentHash'));
            const addedEvents = (changeCase.events ?? []).slice(current.events?.length ?? 0);
            const otherApprovalChanged = (current.approvals ?? []).some((approval) => {
              if (approval.id === effectAuthority.approvalRef) return false;
              const next = (changeCase.approvals ?? []).find((entry) => entry.id === approval.id);
              return !next || contentHash(approval) !== contentHash(next);
            });
            if (current.currentStage !== 'S9' || current.version !== expectedVersion
              || !currentApproval || currentApproval.id !== effectAuthority.approvalRef
              || currentApproval.principal !== effectAuthority.principal
              || currentApproval.authorityGeneration !== effectAuthority.authzGeneration
              || currentApproval.action !== 'release' || currentApproval.status !== 'APPROVED'
              || currentApproval.principal === current.createdBy
              || currentApproval.evidenceBundleRef !== draftBundle?.id
              || (changeCase.approvals ?? []).length !== (current.approvals ?? []).length
              || !nextApproval?.usedAt || nextApproval.principal !== currentApproval.principal
              || nextApproval.authorityGeneration !== currentApproval.authorityGeneration
              || nextApproval.evidenceBundleRef !== currentApproval.evidenceBundleRef
              || !Array.isArray(nextApproval.roles)
              || !nextApproval.roles.includes('release-approver') || !nextApproval.roles.includes('control-owner')
              || otherApprovalChanged || contentHash(approvalPayload) !== nextApproval.contentHash
              || !finalBundle || finalBundle.priorBundleRef !== draftBundle?.id
              || contentHash(finalBundle.approvals) !== contentHash([effectAuthority.approvalRef])
              || !release || release.status !== 'RELEASED' || release.externalEffect !== false
              || release.authorizedBy !== effectAuthority.approvalRef || release.evidenceBundleRef !== finalBundle.id
              || changeCase.artifacts?.authority?.decision !== 'ALLOW'
              || changeCase.artifacts?.authority?.approvalRef !== effectAuthority.approvalRef
              || !addedEvents.some((event) => event.type === 'GatePassed' && event.data?.stage === 'S9')) {
              throw conflict('The persisted release approval is stale or was not consumed by this release transition.', current.version, 'RELEASE_APPROVAL_STALE');
            }
          }
        },
      });
    });
  }
  async listWithDiagnostics(tenantId) {
    const result = await super.listWithDiagnostics(tenantId);
    return {
      corruptRecords: result.corruptRecords,
      records: result.records.map((value) => ({
        id: value.id, tenantId: value.tenantId, title: value.title, status: value.status,
        currentStage: value.currentStage, mutation: value.mutation, riskClass: value.riskClass,
        version: value.version, updatedAt: value.updatedAt,
      })),
    };
  }
}

export class PostgresExecutionRunStore extends PostgresDocumentStore {
  constructor(persistence) { super(persistence, 'execution_run'); }

  async #authorizedGitHubCandidateRun(client, { tenantId, runId, principal, authzGeneration }) {
    if (!/^execution-run-[0-9a-f-]{36}$/.test(runId ?? '') || !principal) return null;
    const scope = await client.query(`select project_id from orgward.aggregate_project_scopes
      where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for key share`, [tenantId, runId]);
    if (!scope.rowCount) return null;
    const projectId = scope.rows[0].project_id;
    await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
    await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
    const aggregate = await client.query(`select * from orgward.aggregates
      where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for share`, [tenantId, runId]);
    if (!aggregate.rowCount) return null;
    const run = verifyAggregateRow(aggregate.rows[0]);
    if (run.projectId !== projectId) throw persistenceIntegrity('An execution run scope does not match its saved project identity.');
    return { run, projectId };
  }

  #githubCandidateRepeat(row) {
    if (!row) return null;
    if (!row.result || contentHash(row.result) !== row.attempt_hash) {
      throw persistenceIntegrity('A GitHub candidate verification repeat failed its stored hash check.');
    }
    return structuredClone(row.result);
  }

  async readGitHubCandidateVerificationRun({ tenantId, runId, principal, authzGeneration, commandId = null }) {
    return this.persistence.transaction(async (client) => {
      const context = await this.#authorizedGitHubCandidateRun(client, { tenantId, runId, principal, authzGeneration });
      if (!context) return null;
      let priorAttempt = null;
      if (commandId) {
        const prior = await client.query(`select command_id,request_hash,result,attempt_hash
          from orgward.github_candidate_verification_repeats where tenant_id=$1 and run_id=$2 and command_id=$3`,
        [tenantId, runId, commandId]);
        if (prior.rowCount) priorAttempt = { commandId: prior.rows[0].command_id,
          requestHash: prior.rows[0].request_hash, attempt: this.#githubCandidateRepeat(prior.rows[0]) };
      }
      return { run: structuredClone(context.run), priorAttempt };
    });
  }

  async readGitHubCandidateVerificationRepeats({ tenantId, runId, principal, authzGeneration, commandId = null }) {
    return this.persistence.transaction(async (client) => {
      const context = await this.#authorizedGitHubCandidateRun(client, { tenantId, runId, principal, authzGeneration });
      if (!context) return null;
      const result = await client.query(`select command_id, request_hash, result, attempt_hash
        from orgward.github_candidate_verification_repeats
        where tenant_id=$1 and project_id=$2 and run_id=$3
          and ($4::text is null or command_id=$4)
        order by created_at, attempt_id`, [tenantId, context.projectId, runId, commandId]);
      const attempts = result.rows.map((row) => ({ commandId: row.command_id, requestHash: row.request_hash,
        attempt: this.#githubCandidateRepeat(row) }));
      return commandId === null ? attempts : attempts[0] ?? null;
    });
  }

  async appendGitHubCandidateVerificationRepeat({ tenantId, runId, principal, authzGeneration,
    commandId, requestHash, expectedCandidateEvidenceHash, attempt }) {
    return this.persistence.transaction(async (client) => {
      const context = await this.#authorizedGitHubCandidateRun(client, { tenantId, runId, principal, authzGeneration });
      if (!context) return null;
      const original = context.run.execution?.repositoryCandidate?.candidateEvidence;
      const candidate = context.run.execution?.repositoryCandidate;
      const selection = context.run.githubPatchSelection;
      if (original?.version !== 'github-candidate-evidence-v1'
        || original.hash !== expectedCandidateEvidenceHash
        || context.run.execution?.evidenceHash !== expectedCandidateEvidenceHash
        || !selection || attempt?.sourceSnapshotId !== selection.sourceSnapshot?.snapshotId
        || attempt?.sourceTreeDigest !== candidate?.sourceTreeDigest
        || attempt?.candidateTreeDigest !== candidate?.treeDigest
        || attempt?.candidateEvidenceVersion !== original?.version
        || attempt?.verifier?.id !== selection.verifier?.id
        || attempt?.verifier?.version !== selection.verifier?.version
        || attempt?.verifier?.profileHash !== selection.verifier?.profileHash) {
        throw conflict('The saved GitHub candidate evidence changed. Reload before repeating verification.', context.run.version,
          'GITHUB_CANDIDATE_EVIDENCE_STALE');
      }
      const prior = await client.query(`select command_id, request_hash, result, attempt_hash
        from orgward.github_candidate_verification_repeats
        where tenant_id=$1 and run_id=$2 and command_id=$3`, [tenantId, runId, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].request_hash !== requestHash) throw conflict('This verification command ID was already used for different candidate evidence.', null, 'IDEMPOTENCY_CONFLICT');
        return { attempt: this.#githubCandidateRepeat(prior.rows[0]), replayed: true };
      }
      if (!attempt || attempt.runId !== runId || attempt.candidateEvidenceHash !== expectedCandidateEvidenceHash
        || attempt.comparison === undefined || !['matched', 'mismatch', 'inconclusive'].includes(attempt.comparison)
        || !/^github-candidate-verification-[0-9a-f-]{36}$/.test(attempt.attemptId ?? '')) {
        throw new Error('The GitHub candidate verification repeat record is invalid.');
      }
      const attemptHash = contentHash(attempt);
      const inserted = await client.query(`insert into orgward.github_candidate_verification_repeats
        (tenant_id,project_id,run_id,attempt_id,command_id,request_hash,candidate_evidence_version,
          candidate_evidence_hash,source_snapshot_id,source_tree_digest,candidate_tree_digest,verifier_id,
          verifier_version,verifier_profile_hash,verifier_command_hash,comparison,result,attempt_hash)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
        on conflict (tenant_id,run_id,command_id) do nothing returning attempt_id`,
      [tenantId, context.projectId, runId, attempt.attemptId, commandId, requestHash,
        attempt.candidateEvidenceVersion, attempt.candidateEvidenceHash, attempt.sourceSnapshotId,
        attempt.sourceTreeDigest, attempt.candidateTreeDigest, attempt.verifier.id, attempt.verifier.version,
        attempt.verifier.profileHash, attempt.verifier.commandHash, attempt.comparison,
        canonicalJson(attempt), attemptHash]);
      if (!inserted.rowCount) {
        const concurrent = await client.query(`select command_id,request_hash,result,attempt_hash
          from orgward.github_candidate_verification_repeats where tenant_id=$1 and run_id=$2 and command_id=$3`,
        [tenantId, runId, commandId]);
        if (!concurrent.rowCount) throw persistenceIntegrity('A GitHub candidate verification repeat conflict has no replay record.');
        if (concurrent.rows[0].request_hash !== requestHash) throw conflict('This verification command ID was already used for different candidate evidence.', null, 'IDEMPOTENCY_CONFLICT');
        return { attempt: this.#githubCandidateRepeat(concurrent.rows[0]), replayed: true };
      }
      const event = { eventId: `event-${randomUUID()}`, schemaVersion: '1.0', tenantId,
        aggregateId: attempt.attemptId, aggregateVersion: 1, type: 'GitHubCandidateVerificationRepeated',
        actor: principal, occurredAt: attempt.createdAt, correlationId: commandId, causationId: runId,
        data: { runId, attemptId: attempt.attemptId, candidateEvidenceHash: attempt.candidateEvidenceHash,
          comparison: attempt.comparison, status: attempt.verification.status,
          exitCode: attempt.verification.exitCode, outputHash: attempt.verification.outputHash }, evidenceRefs: [] };
      await recordEvent(client, { tenantId, kind: 'github_candidate_verification_repeat', id: attempt.attemptId,
        version: 1, commandId, event });
      return { attempt: structuredClone(attempt), replayed: false };
    });
  }

  #deepSeekProfile(row) {
    return row ? {
      id: row.profile_id, revision: Number(row.revision), label: row.label, model: row.model_id,
      credentialReference: row.credential_reference, maxOutputTokens: Number(row.max_output_tokens),
      enabled: row.enabled, createdBy: row.created_by, updatedBy: row.updated_by,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      verification: row.verification_status ? {
        status: row.verification_status,
        requestedAt: row.verification_requested_at instanceof Date ? row.verification_requested_at.toISOString() : String(row.verification_requested_at),
        checkedAt: row.verification_checked_at instanceof Date ? row.verification_checked_at?.toISOString() ?? null : row.verification_checked_at ?? null,
        cooldownUntil: row.verification_cooldown_until instanceof Date ? row.verification_cooldown_until.toISOString() : String(row.verification_cooldown_until),
        profileRevision: Number(row.verification_profile_revision),
        credentialVersion: Number(row.verification_credential_version),
      } : null,
    } : null;
  }

  async listTenantDeepSeekProfiles({ tenantId, principal, authzGeneration, tenantAdminOnly = false }) {
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, {
        tenantId, principal, authzGeneration,
        roles: tenantAdminOnly ? ['tenant-admin'] : [],
        anyRoleGroups: tenantAdminOnly ? [] : [['workspace-read', 'workspace-write', 'tenant-admin']],
        ...(tenantAdminOnly ? { actorType: 'human' } : {}),
      });
      const result = await client.query(`select p.*,
          case when p.enabled and s.status='active' and s.expires_at > clock_timestamp()
            and v.profile_revision=p.revision and v.credential_version=s.version then v.status end as verification_status,
          case when p.enabled and s.status='active' and s.expires_at > clock_timestamp()
            and v.profile_revision=p.revision and v.credential_version=s.version then v.requested_at end as verification_requested_at,
          case when p.enabled and s.status='active' and s.expires_at > clock_timestamp()
            and v.profile_revision=p.revision and v.credential_version=s.version then v.checked_at end as verification_checked_at,
          case when p.enabled and s.status='active' and s.expires_at > clock_timestamp()
            and v.profile_revision=p.revision and v.credential_version=s.version then v.cooldown_until end as verification_cooldown_until,
          case when p.enabled and s.status='active' and s.expires_at > clock_timestamp()
            and v.profile_revision=p.revision and v.credential_version=s.version then v.profile_revision end as verification_profile_revision,
          case when p.enabled and s.status='active' and s.expires_at > clock_timestamp()
            and v.profile_revision=p.revision and v.credential_version=s.version then v.credential_version end as verification_credential_version
        from orgward.tenant_deepseek_profiles p
        left join orgward.secret_references s on s.tenant_id=p.tenant_id and s.reference=p.credential_reference
        left join orgward.tenant_deepseek_profile_verifications v on v.tenant_id=p.tenant_id and v.profile_id=p.profile_id
        where p.tenant_id=$1 order by p.profile_id`, [tenantId]);
      return result.rows.map((row) => this.#deepSeekProfile(row));
    });
  }

  async getTenantModelOutputBudget({ tenantId, principal, authzGeneration }) {
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['tenant-admin'], actorType: 'human', authzGeneration });
      const control = await client.query(`select daily_output_token_limit,budget_revision,budget_updated_by,budget_reason,budget_updated_at
        from orgward.tenant_model_handoff_controls where tenant_id=$1`, [tenantId]);
      const usage = await client.query(`with sampled as (
          select clock_timestamp() as sampled_at
        ), budget_window as (
          select date_trunc('day',sampled_at at time zone 'UTC') at time zone 'UTC' as window_start
          from sampled
        )
        select coalesce(sum(case
          when d.usage_status='reported' then d.usage_output_tokens
          when d.usage_status='dispatch_not_started' then 0
          else d.requested_output_tokens end),0)::bigint as used_output_tokens,
          budget_window.window_start as window_starts_at
        from budget_window left join orgward.provider_dispatch_attempts d
          on d.tenant_id=$1 and d.model_provider is not null and d.created_at >= budget_window.window_start
        group by budget_window.window_start`, [tenantId]);
      const row = control.rows[0] ?? {};
      const dailyOutputTokenLimit = row.daily_output_token_limit === null || row.daily_output_token_limit === undefined
        ? null : Number(row.daily_output_token_limit);
      const usedOutputTokens = Number(usage.rows[0]?.used_output_tokens ?? 0);
      return { dailyOutputTokenLimit, revision: Number(row.budget_revision ?? 0), usedOutputTokens,
        remainingOutputTokens: dailyOutputTokenLimit === null ? null : Math.max(0, dailyOutputTokenLimit - usedOutputTokens),
        windowStartsAt: usage.rows[0]?.window_starts_at?.toISOString?.() ?? String(usage.rows[0]?.window_starts_at ?? ''),
        updatedBy: row.budget_updated_by ?? null, reason: row.budget_reason ?? null,
        updatedAt: row.budget_updated_at?.toISOString?.() ?? row.budget_updated_at ?? null };
    });
  }

  async configureTenantModelOutputBudget({ tenantId, principal, authzGeneration, commandId,
    expectedRevision, dailyOutputTokenLimit, reason }) {
    if (!tenantId || !principal || !/^[a-z0-9][a-z0-9_.:-]{0,159}$/i.test(commandId ?? '')
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || !Number.isSafeInteger(dailyOutputTokenLimit) || dailyOutputTokenLimit < 1 || dailyOutputTokenLimit > 10_000_000
      || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
      throw Object.assign(new Error('Provide a valid daily output-token limit and reason.'), { statusCode: 400, code: 'INVALID_TENANT_MODEL_BUDGET' });
    }
    const operation = 'execution.tenant-model-output-budget.put';
    const payload = { expectedRevision, dailyOutputTokenLimit, reason: reason.trim() };
    const requestHash = contentHash(canonicalJson({ tenantId, principal, operation, ...payload }));
    return this.persistence.transaction(async (client) => {
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['tenant-admin'], actorType: 'human', authzGeneration });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`select * from orgward.command_results
        where tenant_id=$1 and operation=$2 and command_id=$3`, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This command ID was already used with different budget input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.budget?.tenantId !== tenantId || recorded.budget?.revision !== expectedRevision + 1) {
          throw persistenceIntegrity('A tenant model budget command result does not match its revision.');
        }
        return { budget: recorded.budget, replayed: true };
      }
      await client.query(`insert into orgward.tenant_model_handoff_controls (tenant_id)
        values ($1) on conflict (tenant_id) do nothing`, [tenantId]);
      const current = await client.query(`select budget_revision from orgward.tenant_model_handoff_controls
        where tenant_id=$1 for update`, [tenantId]);
      if (!current.rowCount) throw conflict('Tenant model budget control is unavailable.', null, 'TENANT_MODEL_HANDOFF_CONTROL_UNAVAILABLE');
      const revision = Number(current.rows[0].budget_revision);
      if (revision !== expectedRevision) throw conflict('The tenant model budget changed. Reload it before saving.', revision, 'VERSION_CONFLICT');
      const updated = await client.query(`update orgward.tenant_model_handoff_controls
        set daily_output_token_limit=$2,budget_revision=$3,budget_updated_by=$4,budget_reason=$5,budget_updated_at=now()
        where tenant_id=$1 and budget_revision=$6 returning budget_updated_at`,
      [tenantId, dailyOutputTokenLimit, revision + 1, principal, reason.trim(), revision]);
      if (!updated.rowCount) throw conflict('The tenant model budget changed. Reload it before saving.', revision, 'VERSION_CONFLICT');
      const event = { eventId: `event-${randomUUID()}`, schemaVersion: '1.0', tenantId, aggregateId: tenantId,
        aggregateVersion: revision + 1, type: 'TenantModelOutputBudgetConfigured', actor: principal,
        occurredAt: updated.rows[0].budget_updated_at.toISOString(), causationId: commandId,
        data: { revision: revision + 1, dailyOutputTokenLimit, reason: reason.trim() }, evidenceRefs: [] };
      await recordEvent(client, { tenantId, kind: 'tenant_model_handoff_control', id: tenantId,
        version: revision + 1, commandId, event });
      const budget = { tenantId, dailyOutputTokenLimit, revision: revision + 1, updatedBy: principal,
        reason: reason.trim(), updatedAt: event.occurredAt };
      const result = { budget };
      await client.query(`insert into orgward.command_results
        (tenant_id,operation,command_id,payload_hash,aggregate_kind,aggregate_id,result,result_hash)
        values ($1,$2,$3,$4,'tenant_model_handoff_control',$5,$6::jsonb,$7)`,
      [tenantId, operation, commandId, requestHash, tenantId, canonicalJson(result), contentHash(result)]);
      return { ...result, replayed: false };
    });
  }

  async getTenantDeepSeekProfile({ client = null, tenantId, profileId }) {
    if (!tenantId || !profileId) return null;
    const read = async (queryable) => {
      const result = await queryable.query(`select * from orgward.tenant_deepseek_profiles
        where tenant_id=$1 and profile_id=$2 for share`, [tenantId, profileId]);
      return result.rowCount ? this.#deepSeekProfile(result.rows[0]) : null;
    };
    return client ? read(client) : this.persistence.transaction(read);
  }

  async saveTenantDeepSeekProfile({ tenantId, principal, authzGeneration, commandId, expectedRevision,
    profileId, label, model, credentialReference, maxOutputTokens, enabled, reason, validateCredential,
    assertProfileIdAvailable }) {
    if (!tenantId || !principal || !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(profileId ?? '')
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || typeof label !== 'string' || label.trim().length < 1 || label.trim().length > 120
      || !/^[A-Za-z0-9._:-]{1,100}$/.test(model ?? '')
      || !/^secret-[a-z0-9][a-z0-9._-]{0,79}$/.test(credentialReference ?? '')
      || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 64 || maxOutputTokens > 512
      || typeof enabled !== 'boolean' || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500
      || typeof validateCredential !== 'function' || typeof assertProfileIdAvailable !== 'function') {
      throw Object.assign(new Error('The DeepSeek profile command is invalid.'), { statusCode: 400, code: 'INVALID_DEEPSEEK_PROFILE' });
    }
    const operation = 'execution.deepseek-profile.put';
    const payload = { profileId, expectedRevision, label: label.trim(), model, credentialReference,
      maxOutputTokens, enabled, reason: reason.trim() };
    const payloadHash = contentHash(canonicalJson({ tenantId, principal, ...payload }));
    let outcome;
    try {
      outcome = await this.persistence.transaction(async (client) => {
        await requirePrincipalAuthority(client, {
          tenantId, principal, roles: ['tenant-admin'], actorType: 'human', authzGeneration,
        });
        assertProfileIdAvailable({ profileId });
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
        const prior = await client.query(`select * from orgward.command_results
          where tenant_id=$1 and operation=$2 and command_id=$3`, [tenantId, operation, commandId]);
        if (prior.rowCount) {
          if (prior.rows[0].payload_hash !== payloadHash) throw conflict('This command ID was already used with different profile input.', null, 'IDEMPOTENCY_CONFLICT');
          const result = verifyCommandRow(prior.rows[0]);
          if (result.profile?.id !== profileId || result.profile?.revision !== expectedRevision + 1) {
            throw persistenceIntegrity('A DeepSeek profile command result does not match its profile revision.');
          }
          return { ...result, replayed: true };
        }
        if (enabled) await validateCredential({ client, tenantId, reference: credentialReference });
        const currentResult = await client.query(`select * from orgward.tenant_deepseek_profiles
          where tenant_id=$1 and profile_id=$2 for update`, [tenantId, profileId]);
        const current = currentResult.rowCount ? this.#deepSeekProfile(currentResult.rows[0]) : null;
        const currentRevision = current?.revision ?? 0;
        if (currentRevision !== expectedRevision) {
          throw conflict('The DeepSeek profile changed. Reload it before saving.', currentRevision, 'VERSION_CONFLICT');
        }
        const revision = currentRevision + 1;
        const saved = await client.query(`insert into orgward.tenant_deepseek_profiles
          (tenant_id,profile_id,revision,label,model_id,credential_reference,max_output_tokens,enabled,created_by,updated_by,updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,clock_timestamp())
          on conflict (tenant_id,profile_id) do update set revision=excluded.revision,label=excluded.label,
            model_id=excluded.model_id,credential_reference=excluded.credential_reference,
            max_output_tokens=excluded.max_output_tokens,enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at
          returning *`, [tenantId, profileId, revision, label.trim(), model, credentialReference,
          maxOutputTokens, enabled, principal]);
        const profile = this.#deepSeekProfile(saved.rows[0]);
        const event = {
          eventId: `event-${randomUUID()}`, schemaVersion: '1.0', tenantId, aggregateId: profileId,
          aggregateVersion: revision, type: 'TenantDeepSeekProfileSaved', actor: principal,
          occurredAt: new Date().toISOString(), correlationId: commandId, causationId: commandId,
          data: { profileId, revision, label: profile.label, model: profile.model,
            credentialReference: profile.credentialReference, maxOutputTokens, enabled, reason: reason.trim() },
          evidenceRefs: [],
        };
        await recordEvent(client, { tenantId, kind: 'tenant_deepseek_profile', id: profileId,
          version: revision, commandId, event });
        const result = { profile };
        await client.query(`insert into orgward.command_results
          (tenant_id,operation,command_id,payload_hash,aggregate_kind,aggregate_id,result,result_hash)
          values ($1,$2,$3,$4,'tenant_deepseek_profile',$5,$6::jsonb,$7)`,
        [tenantId, operation, commandId, payloadHash, profileId, canonicalJson(result), contentHash(result)]);
        return { ...result, replayed: false };
      });
    } catch (error) {
      if (error.code === '23505') throw conflict('A conflicting DeepSeek profile write was committed.', null, 'IDEMPOTENCY_CONFLICT');
      throw error;
    }
    if (!outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async compileSoftwareDeliveryDraft({
    tenantId, projectId, caseId, principal, authzGeneration, expectedProjectVersion,
    expectedCaseVersion, expectedCaseStateHash, g6PlanHash, compilerVersion, buildPlan,
  }) {
    if (!tenantId || !projectId || !caseId || !principal || typeof buildPlan !== 'function') throw projectAccessDenied();
    return this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'owner' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
      const projectRow = await client.query(`
        select * from orgward.aggregates where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2 for update
      `, [tenantId, projectId]);
      if (!projectRow.rowCount) return null;
      const project = verifyAggregateRow(projectRow.rows[0]);
      if (project.version !== expectedProjectVersion) throw conflict('The saved project changed. Reload before compiling the delivery draft.', project.version);
      const caseRow = await client.query(`
        select * from orgward.aggregates where tenant_id = $1 and aggregate_kind = 'change_case' and aggregate_id = $2 for share
      `, [tenantId, caseId]);
      if (!caseRow.rowCount) return null;
      const changeCase = verifyAggregateRow(caseRow.rows[0]);
      if (changeCase.version !== expectedCaseVersion || caseRow.rows[0].state_hash !== expectedCaseStateHash
        || changeCase.tenantId !== tenantId || changeCase.projectId !== projectId) {
        throw conflict('The accepted change case changed during compilation. Reload before retrying.', changeCase.version, 'ACCEPTED_PLAN_STALE');
      }
      const plan = await buildPlan({ project, changeCase });
      if (!plan || plan.status !== 'DRAFT' || plan.kind !== 'software_delivery'
        || plan.binding?.g6PlanHash !== g6PlanHash || plan.compilerVersion !== compilerVersion) {
        throw persistenceIntegrity('A software delivery compiler returned a plan with invalid bindings.');
      }
      const planHash = contentHash(plan);
      const prior = await client.query(`
        select plan_id, plan_hash, plan from orgward.software_delivery_plans
        where tenant_id = $1 and project_id = $2 and case_id = $3 and g6_plan_hash = $4 and compiler_version = $5
        for update
      `, [tenantId, projectId, caseId, g6PlanHash, compilerVersion]);
      if (prior.rowCount) {
        const stored = prior.rows[0].plan;
        if (prior.rows[0].plan_hash !== contentHash(stored) || prior.rows[0].plan_hash !== planHash
          || prior.rows[0].plan_id !== plan.id) throw conflict('A different software delivery plan is already bound to this accepted G6 generation.', null, 'SOFTWARE_PLAN_BINDING_CONFLICT');
        return { plan: stored, replayed: true };
      }
      await client.query(`
        insert into orgward.software_delivery_plans
          (tenant_id, project_id, case_id, g6_plan_hash, compiler_version, plan_id, plan_hash, plan, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      `, [tenantId, projectId, caseId, g6PlanHash, compilerVersion, plan.id, planHash, canonicalJson(plan), principal]);
      return { plan, replayed: false };
    });
  }

  async listSoftwareDeliveryDrafts({ tenantId, projectId, caseId, principal, authzGeneration }) {
    return this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, anyRoleGroups: [['workspace-read', 'workspace-write']], authzGeneration });
      const result = await client.query(`
        select p.plan_id, p.plan_hash, p.plan,
          review.review_revision, review.review_hash, review,
          runtime.runtime_revision as runtime_revision,
          runtime.snapshot_hash as runtime_snapshot_hash,
          runtime.review_revision as runtime_review_revision,
          runtime.review_hash as runtime_review_hash
        from orgward.software_delivery_plans p
        left join lateral (
          select review_revision, review_hash, review
          from orgward.software_delivery_assignment_reviews
          where tenant_id = p.tenant_id and plan_id = p.plan_id
          order by review_revision desc limit 1
        ) review on true
        left join lateral (
          select runtime_revision,snapshot_hash,review_revision,review_hash
          from orgward.software_delivery_runtime_plans
          where tenant_id=p.tenant_id and project_id=p.project_id and case_id=p.case_id and plan_id=p.plan_id
          order by runtime_revision desc limit 1
        ) runtime on true
        where p.tenant_id = $1 and p.project_id = $2 and p.case_id = $3 order by p.created_at, p.plan_id
      `, [tenantId, projectId, caseId]);
      const plans = [];
      for (const row of result.rows) {
        if (row.plan_id !== row.plan?.id || row.plan_hash !== contentHash(row.plan)) throw persistenceIntegrity('A stored software delivery plan failed its integrity check.');
        let assignmentReview = null;
        if (row.review_revision !== null) {
          const { review_hash: storedReviewHash, review: storedReview } = row;
          const reviewCore = storedReview && typeof storedReview === 'object'
            ? Object.fromEntries(Object.entries(storedReview).filter(([key]) => key !== 'reviewHash')) : null;
          if (!reviewCore || storedReview.reviewHash !== storedReviewHash
            || storedReview.planId !== row.plan_id || storedReview.draftHash !== row.plan?.contentHash
            || digest(reviewCore) !== storedReviewHash) {
            throw persistenceIntegrity('A stored software delivery assignment review failed its integrity check.');
          }
          assignmentReview = storedReview;
        }
        let promotion = null;
        if (row.runtime_snapshot_hash !== null) {
          const runtime = await resolveRuntimeProcessPlan(client, { tenantId, projectId, planId: row.plan_id, revision: Number(row.runtime_revision) });
          if (!runtime || runtime.snapshotHash !== row.runtime_snapshot_hash
            || Number(row.runtime_review_revision) !== runtime.binding?.reviewRevision
            || row.runtime_review_hash !== runtime.binding?.reviewHash) throw persistenceIntegrity('A stored software runtime promotion failed its review binding.');
          promotion = { runtimeRevision: Number(row.runtime_revision), snapshotHash: row.runtime_snapshot_hash,
            reviewRevision: Number(row.runtime_review_revision), reviewHash: row.runtime_review_hash };
        }
        plans.push({ plan: row.plan, assignmentReview, promotion });
      }
      return plans;
    });
  }

  async promoteSoftwareDeliveryDraft({ tenantId, projectId, caseId, planId, principal, authzGeneration,
    expectedProjectVersion, expectedCaseVersion, expectedReviewRevision, idempotencyKey, requestHash }) {
    const operation = 'execution.software-delivery.promote';
    if (!tenantId || !projectId || !caseId || !planId || !principal) throw projectAccessDenied();
    return this.persistence.transaction(async (client) => {
      const membership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'owner' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${planId}`]);
      const previous = await client.query(`select request_hash,result,result_hash from orgward.software_delivery_runtime_commands
        where tenant_id=$1 and project_id=$2 and case_id=$3 and plan_id=$4 and runtime_revision=$5 and command_kind='promote' and idempotency_key=$6 for update`,
      [tenantId, projectId, caseId, planId, expectedReviewRevision, idempotencyKey]);
      if (previous.rowCount) {
        const row = previous.rows[0];
        if (row.request_hash !== requestHash) throw conflict('This promotion idempotency key was used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        if (contentHash(row.result) !== row.result_hash) throw persistenceIntegrity('The promotion replay receipt failed integrity verification.');
        return { result: row.result, replayed: true };
      }
      const projectRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for update`, [tenantId, projectId]);
      if (!projectRow.rowCount) return null;
      const project = verifyAggregateRow(projectRow.rows[0]);
      if (project.version !== expectedProjectVersion) throw conflict('The project changed; reload before promotion.', project.version, 'SOURCE_BINDING_STALE');
      const caseRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!caseRow.rowCount) return null;
      const changeCase = verifyAggregateRow(caseRow.rows[0]);
      if (changeCase.projectId !== projectId || changeCase.tenantId !== tenantId || changeCase.version !== expectedCaseVersion
        || changeCase.accountableOwner !== principal) throw conflict('The accepted case or owner authority changed; reload before promotion.', changeCase.version, 'ACCEPTED_PLAN_STALE');
      if (!verifySourceBinding(changeCase.sourceBinding).valid || changeCase.sourceBinding.projectId !== projectId
        || changeCase.sourceBinding.projectVersion !== project.version) throw conflict('The pinned case source is stale or invalid.', project.version, 'SOURCE_BINDING_STALE');
      const pinned = pinProjectSourceObject(project, { projectId, expectedProjectVersion: project.version,
        expectedBlueprintId: changeCase.sourceBinding.blueprintId,
        expectedBlueprintVersion: changeCase.sourceBinding.blueprintVersion, sourceObjectId: changeCase.sourceBinding.objectId,
        ...sourceBindingSelection(changeCase.sourceBinding) });
      if (pinned.sourceHash !== changeCase.sourceBinding.sourceHash || !verifyAcceptedG6Plan(changeCase).valid) {
        throw conflict('The source or accepted G4/G5/G6 baselines changed; create a new case before promotion.', changeCase.version, 'ACCEPTED_PLAN_STALE');
      }
      const draftRow = await client.query(`select plan_hash,plan from orgward.software_delivery_plans
        where tenant_id=$1 and project_id=$2 and case_id=$3 and plan_id=$4 for update`, [tenantId, projectId, caseId, planId]);
      if (!draftRow.rowCount) return null;
      const draft = draftRow.rows[0].plan;
      if (draftRow.rows[0].plan_hash !== contentHash(draft) || !verifySoftwareDeliveryDraft(changeCase, draft)
        || draft.compilerVersion !== SOFTWARE_PLAN_COMPILER_VERSION) throw conflict('The compiled software draft failed source/provenance verification.', changeCase.version, 'SOFTWARE_PLAN_INTEGRITY_INVALID');
      const reviewRow = await client.query(`select review_revision,review_hash,review from orgward.software_delivery_assignment_reviews
        where tenant_id=$1 and project_id=$2 and case_id=$3 and plan_id=$4 order by review_revision desc limit 1 for update`,
      [tenantId, projectId, caseId, planId]);
      if (!reviewRow.rowCount || Number(reviewRow.rows[0].review_revision) !== expectedReviewRevision) {
        throw conflict('A current owner assignment review is required for promotion.', reviewRow.rowCount ? Number(reviewRow.rows[0].review_revision) : 0, 'SOFTWARE_ASSIGNMENT_REVIEW_STALE');
      }
      const review = reviewRow.rows[0].review;
      if (reviewRow.rows[0].review_hash !== review.reviewHash || review.planId !== planId || review.draftHash !== draft.contentHash
        || review.binding?.caseId !== caseId || review.binding?.projectId !== projectId
        || review.binding?.sourceBindingHash !== changeCase.sourceBinding.bindingHash
        || review.binding?.projectVersion !== draft.binding.projectVersion
        || review.binding?.blueprintId !== draft.binding.blueprintId
        || review.binding?.blueprintVersion !== draft.binding.blueprintVersion
        || review.binding?.blueprintSchemaVersion !== draft.binding.blueprintSchemaVersion
        || review.binding?.sourceObjectId !== draft.binding.sourceObjectId
        || review.binding?.sourceObjectType !== draft.binding.sourceObjectType
        || review.binding?.intentHash !== draft.binding.intentHash
        || review.binding?.requirementsBaselineVersion !== draft.binding.requirementsBaselineVersion
        || review.binding?.architectureBaselineVersion !== draft.binding.architectureBaselineVersion
        || review.binding?.g6PlanHash !== draft.binding.g6PlanHash || review.binding?.sourceHash !== draft.binding.sourceHash
        || digest(Object.fromEntries(Object.entries(review).filter(([key]) => key !== 'reviewHash'))) !== review.reviewHash) {
        throw persistenceIntegrity('The owner assignment review does not match the compiled draft provenance.');
      }
      if (review.assignments.some((entry) => !entry.assignee?.principal || !entry.assignee?.membershipId
        || !Number.isSafeInteger(entry.assignee.membershipGeneration) || !Number.isSafeInteger(entry.assignee.authzGeneration))) {
        throw conflict('This legacy owner review does not bind an exact principal and generation. Revise the review before promotion.', null, 'SOFTWARE_ASSIGNMENT_REVIEW_BINDING_INCOMPLETE');
      }
      let snapshot;
      try { snapshot = softwareRuntimePlanSnapshot({ draft, review, project, principal }); }
      catch (error) { throw conflict(error.message, null, error.code ?? 'SOFTWARE_PLAN_INTEGRITY_INVALID'); }
      await verifyCurrentHumanSoftwareAssignments(client, { tenantId, projectId, project, plan: snapshot });
      const existing = await client.query(`select snapshot_hash from orgward.software_delivery_runtime_plans where tenant_id=$1 and plan_id=$2 and runtime_revision=$3 for update`, [tenantId, planId, snapshot.revision]);
      if (existing.rowCount) {
        if (existing.rows[0].snapshot_hash !== snapshot.snapshotHash) throw conflict('A different immutable runtime snapshot already exists for this draft.', null, 'SOFTWARE_RUNTIME_SNAPSHOT_CONFLICT');
      } else {
        await client.query(`insert into orgward.software_delivery_runtime_plans
          (tenant_id,project_id,case_id,plan_id,runtime_revision,snapshot_hash,review_revision,review_hash,snapshot,created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
        [tenantId, projectId, caseId, planId, snapshot.revision, snapshot.snapshotHash, review.revision, review.reviewHash, canonicalJson(snapshot), principal]);
      }
      const result = { tenantId, projectId, caseId, planId, revision: snapshot.revision, runtimeRevision: snapshot.revision, snapshotHash: snapshot.snapshotHash,
        reviewRevision: review.revision, reviewHash: review.reviewHash };
      await client.query(`insert into orgward.software_delivery_runtime_commands
        (tenant_id,project_id,case_id,plan_id,runtime_revision,command_kind,idempotency_key,request_hash,result,result_hash)
        values ($1,$2,$3,$4,$5,'promote',$6,$7,$8::jsonb,$9)`,
      [tenantId, projectId, caseId, planId, snapshot.revision, idempotencyKey, requestHash, canonicalJson(result), contentHash(result)]);
      return { result, replayed: false };
    });
  }

  async startSoftwareDeliveryInstance({ tenantId, projectId, caseId, planId, revision, principal, authzGeneration, idempotencyKey, requestHash }) {
    const operation = 'execution.software-delivery.start-instance';
    if (!tenantId || !projectId || !caseId || !planId || !principal) throw projectAccessDenied();
    const commandId = `software-runtime-start:${idempotencyKey}`;
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'owner' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${planId}`]);
      const projectRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for update`, [tenantId, projectId]);
      if (!projectRow.rowCount) return null;
      const project = verifyAggregateRow(projectRow.rows[0]);
      const caseRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for update`, [tenantId, caseId]);
      if (!caseRow.rowCount) return null;
      const changeCase = verifyAggregateRow(caseRow.rows[0]);
      if (changeCase.projectId !== projectId || changeCase.tenantId !== tenantId || changeCase.accountableOwner !== principal) {
        throw conflict('The case owner or project binding changed; reload before starting work.', changeCase.version, 'ACCEPTED_PLAN_STALE');
      }
      const previous = await client.query(`select request_hash,result,result_hash from orgward.software_delivery_runtime_commands
        where tenant_id=$1 and project_id=$2 and case_id=$3 and plan_id=$4 and runtime_revision=$5 and command_kind='start-instance' and idempotency_key=$6 for update`,
      [tenantId, projectId, caseId, planId, revision, idempotencyKey]);
      if (previous.rowCount) {
        const row = previous.rows[0];
        if (row.request_hash !== requestHash) throw conflict('This instance-start idempotency key was used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        if (contentHash(row.result) !== row.result_hash) throw persistenceIntegrity('The instance-start replay receipt failed integrity verification.');
        return { result: row.result, replayed: true };
      }
      const resolved = await resolveRuntimeProcessPlan(client, { tenantId, projectId, project, planId, revision });
      if (!resolved || resolved.kind !== 'software_delivery_runtime_plan' || resolved.binding.caseId !== caseId) {
        throw conflict('An owner-promoted immutable software delivery snapshot is required.', null, 'SOFTWARE_RUNTIME_PROMOTION_REQUIRED');
      }
      const sourceBinding = changeCase.sourceBinding;
      const blueprint = latestBlueprint(project);
      if (!verifySourceBinding(sourceBinding).valid || sourceBinding.projectId !== projectId
        || sourceBinding.projectVersion !== project.version
        || sourceBinding.blueprintId !== blueprint?.id || sourceBinding.blueprintVersion !== blueprint?.version
        || resolved.source?.projectId !== projectId || resolved.source?.blueprintId !== sourceBinding.blueprintId
        || resolved.source?.blueprintVersion !== sourceBinding.blueprintVersion
        || resolved.source?.processId !== sourceBinding.objectId
        || resolved.binding?.projectVersion !== sourceBinding.projectVersion
        || resolved.binding?.blueprintId !== sourceBinding.blueprintId
        || resolved.binding?.blueprintVersion !== sourceBinding.blueprintVersion
        || resolved.binding?.sourceHash !== sourceBinding.sourceHash
        || resolved.binding?.sourceBindingHash !== sourceBinding.bindingHash) {
        throw conflict('The promoted software snapshot is pinned to an older or unverifiable saved design. Create a new governed case and review before starting work.',
          project.version, 'SOURCE_BINDING_STALE');
      }
      let currentBinding;
      try {
        currentBinding = pinProjectSourceObject(project, {
          projectId, expectedProjectVersion: project.version, expectedBlueprintId: blueprint.id,
          expectedBlueprintVersion: blueprint.version, sourceObjectId: sourceBinding.objectId,
          ...sourceBindingSelection(sourceBinding),
        });
      } catch {
        throw conflict('The promoted software snapshot source is unavailable in the current saved design. Create a new governed case and review before starting work.',
          project.version, 'SOURCE_BINDING_STALE');
      }
      if (currentBinding.sourceHash !== sourceBinding.sourceHash) {
        throw conflict('The promoted software snapshot no longer matches the current saved-design object. Create a new governed case and review before starting work.',
          project.version, 'SOURCE_BINDING_STALE');
      }
      await verifyCurrentHumanSoftwareAssignments(client, { tenantId, projectId, project, plan: resolved });
      const plan = resolved;
      const instanceId = randomUUID();
      await client.query(`insert into orgward.process_task_instance_controls
        (tenant_id,project_id,process_plan_id,plan_revision,plan_instance_id,status,initiated_by,version,events)
        values ($1,$2,$3,$4,$5,'ACTIVE',$6,0,'[]'::jsonb)`, [tenantId, projectId, planId, revision, instanceId, principal]);
      const assignees = await verifyCurrentHumanSoftwareAssignments(client, { tenantId, projectId, project, plan });
      for (const task of plan.tasks) {
        const assignment = assignees.get(task.id);
        await client.query(`insert into orgward.process_task_instances
          (tenant_id,project_id,process_plan_id,plan_revision,plan_instance_id,task_id,blueprint_id,blueprint_version,
            process_id,actor_id,role_id,actor_type,assigned_principal,assigned_membership_generation,assigned_authz_generation,status,version)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'human',$12,$13,$14,'PLANNED',0)`,
        [tenantId, projectId, planId, revision, instanceId, task.id, plan.source.blueprintId, plan.source.blueprintVersion,
          plan.source.processId, assignment.actor.id, assignment.role.id, assignment.principal,
          assignment.membershipGeneration, assignment.authzGeneration]);
      }
      const result = { tenantId, projectId, caseId, planId, revision, planInstanceId: instanceId,
        snapshotHash: plan.snapshotHash, taskCount: plan.tasks.length };
      await client.query(`insert into orgward.software_delivery_runtime_commands
        (tenant_id,project_id,case_id,plan_id,runtime_revision,command_kind,idempotency_key,request_hash,result,result_hash)
        values ($1,$2,$3,$4,$5,'start-instance',$6,$7,$8::jsonb,$9)`,
      [tenantId, projectId, caseId, planId, revision, idempotencyKey, requestHash, canonicalJson(result), contentHash(result)]);
      const event = { id: `software-runtime-start-event-${randomUUID()}`, type: 'SoftwareDeliveryInstanceStarted',
        actor: principal, at: new Date().toISOString(), causationId: commandId,
        data: { projectId, caseId, planId, revision, planInstanceId: instanceId, taskCount: plan.tasks.length } };
      event.contentHash = contentHash(event);
      await recordEvent(client, { tenantId, kind: 'process_task_instance_control', id: instanceId, version: 0, commandId, event });
      return { result, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async reviewSoftwareDeliveryDraftAssignments({
    tenantId, projectId, caseId, planId, principal, authzGeneration,
    expectedProjectVersion, expectedCaseVersion, expectedReviewRevision, draftHash,
    idempotencyKey, requestHash, assignments,
  }) {
    if (!tenantId || !projectId || !caseId || !planId || !principal) throw projectAccessDenied();
    const invalid = (message, code = 'INVALID_SOFTWARE_ASSIGNMENT_REVIEW', statusCode = 400) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code, retryable: false });
      throw error;
    };
    return this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'owner' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:software-delivery-assignment:${planId}`]);

      const priorCommand = await client.query(`
        select request_hash, review_revision from orgward.software_delivery_assignment_commands
        where tenant_id = $1 and plan_id = $2 and idempotency_key = $3
        for update
      `, [tenantId, planId, idempotencyKey]);
      if (priorCommand.rowCount) {
        const prior = priorCommand.rows[0];
        if (prior.request_hash !== requestHash) {
          const error = new Error('This idempotency key was already used with different assignment review input.');
          Object.assign(error, { statusCode: 409, code: 'IDEMPOTENCY_CONFLICT', retryable: false });
          throw error;
        }
        const saved = await client.query(`
          select review_revision, review_hash, review from orgward.software_delivery_assignment_reviews
          where tenant_id = $1 and plan_id = $2 and review_revision = $3 for share
        `, [tenantId, planId, prior.review_revision]);
        if (!saved.rowCount || saved.rows[0].review.reviewHash !== saved.rows[0].review_hash
          || digest(Object.fromEntries(Object.entries(saved.rows[0].review).filter(([key]) => key !== 'reviewHash'))) !== saved.rows[0].review_hash) {
          throw persistenceIntegrity('The saved assignment review replay failed integrity verification.');
        }
        return { review: saved.rows[0].review, replayed: true };
      }

      const projectRow = await client.query(`
        select * from orgward.aggregates where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2 for update
      `, [tenantId, projectId]);
      if (!projectRow.rowCount) return null;
      const project = verifyAggregateRow(projectRow.rows[0]);
      if (project.version !== expectedProjectVersion) throw conflict('The project changed. Reload before saving assignment review.', project.version);

      const caseRow = await client.query(`
        select * from orgward.aggregates where tenant_id = $1 and aggregate_kind = 'change_case' and aggregate_id = $2 for share
      `, [tenantId, caseId]);
      if (!caseRow.rowCount) return null;
      const changeCase = verifyAggregateRow(caseRow.rows[0]);
      if (changeCase.version !== expectedCaseVersion || changeCase.tenantId !== tenantId || changeCase.projectId !== projectId) {
        throw conflict('The accepted case changed. Reload before saving assignment review.', changeCase.version, 'ACCEPTED_PLAN_STALE');
      }
      if (changeCase.accountableOwner !== principal) throw projectAccessDenied();
      if (!verifySourceBinding(changeCase.sourceBinding).valid || changeCase.sourceBinding.projectId !== projectId
        || changeCase.sourceBinding.projectVersion !== expectedProjectVersion || project.version !== expectedProjectVersion) {
        throw conflict('The pinned project source is stale or invalid. Create a new case from the current saved design.', project.version, 'SOURCE_BINDING_STALE');
      }
      const currentBinding = pinProjectSourceObject(project, {
        projectId, expectedProjectVersion: project.version,
        expectedBlueprintId: changeCase.sourceBinding.blueprintId,
        expectedBlueprintVersion: changeCase.sourceBinding.blueprintVersion,
        sourceObjectId: changeCase.sourceBinding.objectId,
        ...sourceBindingSelection(changeCase.sourceBinding),
      });
      if (currentBinding.sourceHash !== changeCase.sourceBinding.sourceHash) {
        throw conflict('The pinned saved-design object changed. Create a new case from the current design.', project.version, 'SOURCE_BINDING_STALE');
      }
      if (!verifyAcceptedG6Plan(changeCase).valid) throw conflict('The accepted G4/G5/G6 baselines failed integrity verification.', changeCase.version, 'ACCEPTED_PLAN_STALE');

      const draftRow = await client.query(`
        select plan_hash, plan from orgward.software_delivery_plans
        where tenant_id = $1 and project_id = $2 and case_id = $3 and plan_id = $4 for update
      `, [tenantId, projectId, caseId, planId]);
      if (!draftRow.rowCount) return null;
      const draft = draftRow.rows[0].plan;
      if (draftRow.rows[0].plan_hash !== contentHash(draft) || draft.contentHash !== draftHash
        || draft.compilerVersion !== SOFTWARE_PLAN_COMPILER_VERSION
        || !verifySoftwareDeliveryDraft(changeCase, draft)) {
        throw conflict('The compiled draft changed or failed integrity verification. Reload the case before assigning work.', changeCase.version, 'SOFTWARE_PLAN_INTEGRITY_INVALID');
      }
      const binding = draft.binding;
      const blueprint = latestBlueprint(project);
      if (!blueprint || blueprint.version !== binding.blueprintVersion
        || binding.caseId !== caseId || binding.projectId !== projectId
        || binding.sourceHash !== changeCase.sourceBinding.sourceHash
        || binding.intentHash !== changeCase.intent.contentHash
        || binding.requirementsBaselineHash !== changeCase.artifacts.requirements.acceptedBaseline?.contentHash
        || binding.architectureBaselineHash !== changeCase.artifacts.architecture.acceptedBaseline?.draftHash
        || binding.g6PlanHash !== changeCase.artifacts.plan.contentHash) {
        throw conflict('The compiled draft is not bound to the current accepted source and baselines.', changeCase.version, 'SOFTWARE_PLAN_INTEGRITY_INVALID');
      }
      if (!Array.isArray(assignments) || assignments.length !== draft.tasks.length || !draft.tasks.length) {
        invalid('Provide exactly one assignment for every compiled DRAFT task.');
      }
      const taskById = new Map(draft.tasks.map((task) => [task.id, task]));
      const seenTaskIds = new Set();
      for (const assignment of assignments) {
        if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)
          || Object.keys(assignment).some((key) => !['taskId', 'actorId', 'roleId', 'targetPrincipal'].includes(key))
          || typeof assignment.taskId !== 'string' || typeof assignment.actorId !== 'string' || typeof assignment.roleId !== 'string'
          || typeof assignment.targetPrincipal !== 'string' || !assignment.targetPrincipal) {
          invalid('Each assignment must name a compiled task and an exact actor/role/principal binding.');
        }
        if (seenTaskIds.has(assignment.taskId)) invalid('Each compiled task may appear only once.');
        seenTaskIds.add(assignment.taskId);
        if (!taskById.has(assignment.taskId)) invalid('An assignment names a task that is not in this compiled draft.', 'SOFTWARE_ASSIGNMENT_TASK_UNKNOWN');
      }
      if (seenTaskIds.size !== taskById.size) invalid('The assignment review is missing one or more compiled tasks.');

      const actorBindingRows = await client.query(`
        select b.actor_id, b.role_id, b.blueprint_version, b.target_principal,
          b.target_membership_generation, b.target_authz_generation,
          identity.display_name, identity.actor_type, identity.status as identity_status,
          identity.authz_generation as current_authz_generation,
          membership.access, membership.generation as current_membership_generation, membership.revoked_at
        from orgward.project_actor_binding_proposals b
        join orgward.oidc_principals identity
          on identity.tenant_id = b.tenant_id and identity.principal = b.target_principal
        join orgward.project_memberships membership
          on membership.tenant_id = b.tenant_id and membership.project_id = b.project_id and membership.principal = b.target_principal
        where b.tenant_id = $1 and b.project_id = $2 and b.blueprint_version = $3 and b.status = 'enabled'
        order by b.actor_id, b.role_id, b.target_principal
        for share of b, identity, membership
      `, [tenantId, projectId, binding.blueprintVersion]);
      const objects = Object.values(blueprint.areas ?? {}).flatMap((area) => area.items ?? []);
      const objectsById = new Map(objects.map((object) => [object.id, object]));
      const enabledBindings = new Map();
      for (const row of actorBindingRows.rows) {
        const actor = objectsById.get(row.actor_id);
        const role = objectsById.get(row.role_id);
        const linked = actor && role && ((actor.assignedRoles ?? []).includes(role.id)
          || (blueprint.relations ?? []).some((relation) => relation.source === actor.id
            && relation.target === role.id && relation.type === 'assigned-to'));
        const actorType = actor?.type === 'actor-human' ? 'human' : actor?.type === 'actor-agent' ? 'workload' : null;
        const current = linked && row.identity_status === 'active' && row.revoked_at === null
          && ['owner', 'editor'].includes(row.access) && actorType === row.actor_type
          && Number(row.target_authz_generation) === Number(row.current_authz_generation)
          && Number(row.target_membership_generation) === Number(row.current_membership_generation);
        if (current) enabledBindings.set(`${row.actor_id}\n${row.role_id}\n${row.target_principal}`, {
          actorId: actor.id, actorName: actor.name, actorType,
          roleId: role.id, roleName: role.name,
          assigneeName: row.display_name, principal: row.target_principal,
          membershipId: `${projectId}:${row.target_principal}`,
          membershipGeneration: Number(row.current_membership_generation),
          authzGeneration: Number(row.current_authz_generation),
        });
      }
      const assignmentByTaskId = new Map(assignments.map((entry) => [entry.taskId, entry]));
      const reviewedAssignments = draft.tasks.map((task) => {
        const assignment = assignmentByTaskId.get(task.id);
        const current = enabledBindings.get(`${assignment.actorId}\n${assignment.roleId}\n${assignment.targetPrincipal}`);
        if (!current) throw conflict('An assigned actor binding is no longer current or eligible. Refresh the blueprint bindings and review again.', project.version, 'ACTOR_BINDING_STALE');
        return { taskId: task.id, g6WorkItemId: task.g6WorkItemId, assignee: current };
      });

      const priorHead = await client.query(`
        select review_revision from orgward.software_delivery_assignment_reviews
        where tenant_id = $1 and plan_id = $2 order by review_revision desc limit 1
      `, [tenantId, planId]);
      const currentRevision = priorHead.rowCount ? Number(priorHead.rows[0].review_revision) : 0;
      if (currentRevision !== expectedReviewRevision) throw conflict('The assignment review changed. Reload before saving.', currentRevision, 'SOFTWARE_ASSIGNMENT_REVIEW_STALE');
      const revision = currentRevision + 1;
      const reviewCore = {
        schemaVersion: 1,
        kind: 'software_delivery_assignment_review',
        planId,
        draftHash,
        revision,
        status: 'REVIEWED',
        executable: false,
        binding: {
          projectId, caseId, sourceHash: binding.sourceHash, sourceBindingHash: changeCase.sourceBinding.bindingHash,
          projectVersion: binding.projectVersion, blueprintId: binding.blueprintId,
          blueprintVersion: binding.blueprintVersion, blueprintSchemaVersion: binding.blueprintSchemaVersion,
          sourceObjectId: binding.sourceObjectId, sourceObjectType: binding.sourceObjectType,
          intentHash: binding.intentHash,
          requirementsBaselineVersion: binding.requirementsBaselineVersion,
          requirementsBaselineHash: binding.requirementsBaselineHash,
          architectureBaselineVersion: binding.architectureBaselineVersion,
          architectureBaselineHash: binding.architectureBaselineHash,
          g6PlanHash: binding.g6PlanHash, compilerVersion: draft.compilerVersion,
        },
        assignments: reviewedAssignments,
      };
      const normalizedReviewCore = JSON.parse(canonicalJson(reviewCore));
      const reviewHash = digest(normalizedReviewCore);
      const review = { ...normalizedReviewCore, reviewHash };
      await client.query(`
        insert into orgward.software_delivery_assignment_reviews
          (tenant_id, project_id, case_id, plan_id, review_revision, draft_hash, review_hash, review, created_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      `, [tenantId, projectId, caseId, planId, revision, draftHash, reviewHash, canonicalJson(review), principal]);
      await client.query(`
        insert into orgward.software_delivery_assignment_commands
          (tenant_id, plan_id, idempotency_key, request_hash, review_revision)
        values ($1, $2, $3, $4, $5)
      `, [tenantId, planId, idempotencyKey, requestHash, revision]);
      return { review, replayed: false };
    });
  }

  async createForProcessTask({
    tenantId, projectId, principal, authzGeneration, planId, revision, planInstanceId = null,
    taskId, profileId, parentRunId = null, commandId, requestHash, repositoryRef = null,
    behaviorTestCaseId = null, behaviorTestPlanId = null, behaviorCheckPlan = null, buildRun,
  }) {
    if (!tenantId || !projectId || !principal || typeof buildRun !== 'function') throw projectAccessDenied();
    const operation = 'execution.process-task.request';
    let outcome;
    try {
      outcome = await this.persistence.transaction(async (client) => {
        await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
        await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
        const priorCommand = await client.query(`
          select * from orgward.command_results
          where tenant_id = $1 and operation = $2 and command_id = $3
        `, [tenantId, operation, commandId]);
        if (priorCommand.rowCount) {
          if (priorCommand.rows[0].payload_hash !== requestHash) {
            throw conflict('This command ID was already used with different process task input.', null, 'IDEMPOTENCY_CONFLICT');
          }
          const recorded = verifyCommandRow(priorCommand.rows[0]);
          if (priorCommand.rows[0].aggregate_kind !== 'execution_run'
            || recorded.id !== priorCommand.rows[0].aggregate_id || recorded.tenantId !== tenantId
            || recorded.projectId !== projectId || recorded.processTaskRef?.processPlanId !== planId
            || recorded.processTaskRef?.revision !== revision
            || (planInstanceId && recorded.processTaskRef?.planInstanceId !== planInstanceId)
            || recorded.processTaskRef?.taskId !== taskId
            || (recorded.processTaskRef?.behaviorTestPlan?.caseId ?? null) !== behaviorTestCaseId
            || (recorded.processTaskRef?.behaviorTestPlan?.planId ?? null) !== behaviorTestPlanId
            || (recorded.processTaskRef?.delegation?.parentRunId ?? null) !== parentRunId) {
            throw persistenceIntegrity('A process task command result does not match its execution run reference.');
          }
          const selected = await client.query(`
            select a.*, s.project_id as scoped_project_id
            from orgward.aggregates a
            join orgward.aggregate_project_scopes s
              on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
            where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
              and s.project_id = $3
            for share of a, s
          `, [tenantId, recorded.id, projectId]);
          if (!selected.rowCount) throw persistenceIntegrity('A process task command result has no linked run.');
          const run = verifyAggregateRow(selected.rows[0]);
          if (run.projectId !== projectId || contentHash(run.processTaskRef) !== contentHash(recorded.processTaskRef)) {
            throw persistenceIntegrity('A process task command result no longer matches its linked run.');
          }
          if (behaviorTestCaseId || behaviorTestPlanId) {
            const caseRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for share`,
              [tenantId, behaviorTestCaseId]);
            if (!caseRow.rowCount) throw persistenceIntegrity('A behavior-plan replay has no retained case.');
            const changeCase = verifyAggregateRow(caseRow.rows[0]);
            await PostgresChangeCaseStore.prototype.verifyProcessBehaviorTestPlans.call(this, changeCase, client);
            const behaviorPlan = (changeCase.artifacts?.processBehaviorTestPlans ?? []).find((candidate) => candidate.id === behaviorTestPlanId);
            if (!verifyProcessBehaviorTestPlan(behaviorPlan) || behaviorPlan.caseId !== changeCase.id
              || behaviorPlan.projectId !== projectId || behaviorPlan.tenantId !== tenantId
              || run.processTaskRef?.behaviorTestPlan?.planHash !== behaviorPlan.planHash) {
              throw persistenceIntegrity('A behavior-plan replay no longer matches its retained authorization evidence.');
            }
          }
          return { run, replayed: true };
        }

        const selectedProject = await client.query(`
          select * from orgward.aggregates
          where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
          for update
        `, [tenantId, projectId]);
        if (!selectedProject.rowCount) return null;
        const project = verifyAggregateRow(selectedProject.rows[0]);
        const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId, project, planId, revision });
        if (!plan) throw conflict('The saved process plan revision was not found.', null, 'PROCESS_PLAN_REVISION_NOT_FOUND');
        if (plan.kind === 'software_delivery_runtime_plan') throw conflict('Owner-promoted software work contains human checkpoints only; it cannot create a model execution run.', null, 'SOFTWARE_AGENT_RUNTIME_UNSUPPORTED');
        const revisions = (project.processPlans ?? []).filter((candidate) => candidate.id === planId)
          .sort((left, right) => (left.revision ?? 1) - (right.revision ?? 1));
        if (!/^[0-9a-f-]{36}$/i.test(planInstanceId ?? '') && planInstanceId !== null) {
          throw conflict('The plan instance reference is invalid.', null, 'INVALID_PROCESS_PLAN_INSTANCE');
        }
        const task = plan.tasks.find((candidate) => candidate.id === taskId);
        if (!task) throw conflict('The task was not found in this saved graph revision.', null, 'PROCESS_PLAN_TASK_NOT_FOUND');
        let behaviorTestPlanRef = null;
        if (behaviorTestCaseId || behaviorTestPlanId) {
          if (!behaviorTestCaseId || !behaviorTestPlanId || !behaviorCheckPlan?.planHash) {
            throw conflict('Choose a complete authorized behavior test plan and configured check plan.', null, 'BEHAVIOR_TEST_PLAN_REQUIRED');
          }
          const caseRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2 for share`,
            [tenantId, behaviorTestCaseId]);
          if (!caseRow.rowCount) throw conflict('The authorized behavior test plan is unavailable in this tenant.', null, 'BEHAVIOR_TEST_PLAN_NOT_FOUND');
          const changeCase = verifyAggregateRow(caseRow.rows[0]);
          await PostgresChangeCaseStore.prototype.verifyProcessBehaviorTestPlans.call(this, changeCase, client);
          const behaviorPlan = (changeCase.artifacts?.processBehaviorTestPlans ?? []).find((candidate) => candidate.id === behaviorTestPlanId);
          const requirement = changeCase.artifacts?.requirements?.requirements?.find((candidate) => candidate.id === behaviorPlan?.requirementId);
          const requirementHash = requirement ? contentHash(Object.fromEntries(Object.entries(requirement)
            .filter(([key]) => !['processRunEvidenceLinks', 'processRunEvidenceReviews', 'processIntentEvaluationAcceptances', 'behaviorTestPlans'].includes(key)))) : null;
          if (changeCase.projectId !== projectId || changeCase.tenantId !== tenantId || !verifyProcessBehaviorTestPlan(behaviorPlan)
            || !requirement || changeCase.artifacts?.requirements?.draftRevision !== behaviorPlan.draftRevision
            || requirementHash !== behaviorPlan.requirementHash || requirement.processTrace?.traceHash !== behaviorPlan.traceHash
            || behaviorPlan.processPlan?.id !== planId || Number(behaviorPlan.processPlan?.revision) !== Number(revision)
            || behaviorPlan.processPlan?.taskId !== taskId || behaviorPlan.source?.processSnapshotHash !== requirement.processTrace?.source?.processSnapshotHash
            || behaviorPlan.processPlan?.hash !== (plan.snapshotHash ?? contentHash(plan))
            || behaviorPlan.checkPlan?.hash !== behaviorCheckPlan.planHash
            || behaviorPlan.repositoryHash !== contentHash(repositoryRef)
            || contentHash(behaviorPlan.repository) !== contentHash(repositoryRef)
            || behaviorPlan.assertions.some((assertion) => !behaviorCheckPlan.requiredChecks.some((check) => check.id === assertion.check.id
              && check.version === assertion.check.version && check.commandHash === assertion.check.commandHash))) {
            throw conflict('The authorized behavior plan is stale or does not match this exact process task and check plan.', null, 'BEHAVIOR_TEST_PLAN_STALE');
          }
          if (Date.parse(behaviorPlan.createdAt) >= Date.now()) throw conflict('The behavior plan must be authorized before the execution request.', null, 'BEHAVIOR_TEST_PLAN_NOT_PREAUTHORIZED');
          behaviorTestPlanRef = { caseId: changeCase.id, planId: behaviorPlan.id, planHash: behaviorPlan.planHash,
            requirementId: behaviorPlan.requirementId, requirementHash: behaviorPlan.requirementHash,
            draftRevision: behaviorPlan.draftRevision, traceHash: behaviorPlan.traceHash, createdAt: behaviorPlan.createdAt,
            checkPlanHash: behaviorPlan.checkPlan.hash, criterionContractVersion: behaviorPlan.criterionContractVersion,
            criterionContractHash: behaviorPlan.criterionContractHash, fileMappings: structuredClone(behaviorPlan.fileMappings),
            fileMappingsHash: contentHash(behaviorPlan.fileMappings) };
        }
        const instanceId = planInstanceId ?? randomUUID();
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${tenantId}:process-plan-instance:${instanceId}`,
        ]);

        const instanceTasks = await client.query(`
          select * from orgward.process_task_instances
          where tenant_id = $1 and plan_instance_id = $2
          order by task_id
          for update
        `, [tenantId, instanceId]);
        const taskInstances = instanceTasks.rows;
        const instanceExists = instanceTasks.rowCount > 0;
        let instanceControl = await lockProcessTaskControl(client, tenantId, instanceId);
        if (instanceExists) {
          if (!instanceControl) throw persistenceIntegrity('An existing process instance has no durable control record.');
          requireActiveProcessTaskControl(instanceControl);
        }
        if (!instanceExists && planInstanceId !== null) {
          throw conflict('A task can join only an existing plan instance; start a new instance from a root task without supplying an instance ID.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
        }
        if (instanceExists && taskInstances.some((runtime) => runtime.project_id !== projectId
          || runtime.process_plan_id !== planId || Number(runtime.plan_revision) !== revision
          || runtime.blueprint_id !== plan.source.blueprintId
          || Number(runtime.blueprint_version) !== plan.source.blueprintVersion)) {
          throw conflict('This plan instance is already pinned to another immutable graph revision.', null, 'PROCESS_TASK_INSTANCE_PIN_CONFLICT');
        }
        if (!instanceExists) {
          const latest = revisions.at(-1);
          if (latest?.revision !== revision) {
            throw conflict('A new plan instance must start from the latest saved graph revision.', null, 'PROCESS_PLAN_REVISION_STALE');
          }
          if (!processPlanUsesCurrentOrViewOnlyBlueprint(project, plan)) {
            throw conflict('A new plan instance must use the current saved blueprint version.', null, 'PROCESS_PLAN_BLUEPRINT_STALE');
          }
          await client.query(`insert into orgward.process_task_instance_controls
            (tenant_id,project_id,process_plan_id,plan_revision,plan_instance_id,status,initiated_by,version,events)
            values ($1,$2,$3,$4,$5,'ACTIVE',$6,0,'[]'::jsonb)`,
          [tenantId, projectId, plan.id, plan.revision, instanceId, principal]);
        }
        if (project.id !== plan.source.projectId) {
          throw conflict('The plan belongs to another project.', null, 'PROCESS_PLAN_PROJECT_MISMATCH');
        }
        if (!Array.isArray(task.dependencies)) throw persistenceIntegrity('A saved process task has invalid dependencies.');
        if (plan.kind === 'manual_process_flow_plan' && !['manual', 'manual-exception'].includes(task.flowRef?.kind)) throw conflict('Advanced flow decisions and loops require human work.', null, 'PROCESS_FLOW_HUMAN_DECISION_REQUIRED');
        const flowActivation = plan.kind === 'manual_process_flow_plan' ? await requireManualFlowTaskReady(client, plan, taskId, taskInstances, instanceControl, instanceId) : null;
        const duplicateTask = taskInstances.some((runtime) => runtime.task_id === taskId);
        if (duplicateTask) throw conflict('This task already has an approval request in this plan instance.', null, 'PROCESS_TASK_ALREADY_REQUESTED');
        if (!instanceExists && task.dependencies.length) {
          throw conflict('A plan instance must start with a root task that has no dependencies.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
        }
        const linkedByTask = new Map(taskInstances.map((runtime) => [runtime.task_id, runtime]));
        for (const dependencyId of task.dependencies) {
          const dependencyRuntime = linkedByTask.get(dependencyId);
          const verifiedHumanSuccess = dependencyRuntime?.status === 'SUCCEEDED'
            && dependencyRuntime.actor_type === 'human'
            ? await hasVerifiedHumanTaskSuccess(client, dependencyRuntime)
            : true;
          if (dependencyRuntime?.status !== 'SUCCEEDED' || !verifiedHumanSuccess) {
            throw conflict('Every task dependency must be succeeded in this same plan instance.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
          }
        }

        const assignee = task.assignee;
        if (assignee?.kind !== 'blueprint-actor' || !assignee.actorId || !assignee.roleId) {
          throw conflict('Assign this task to a currently enabled blueprint actor and role before requesting approval.', null, 'PROCESS_TASK_ASSIGNMENT_REQUIRED');
        }
        const blueprint = project.blueprintVersions?.find((candidate) => candidate.id === plan.source.blueprintId
          && candidate.version === plan.source.blueprintVersion);
        const blueprintObjects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
        const actor = blueprintObjects.find((item) => item.id === assignee.actorId);
        const role = blueprintObjects.find((item) => item.id === assignee.roleId);
        const linkedRole = actor && role?.type === 'role'
          && ((actor.assignedRoles ?? []).includes(role.id)
            || (blueprint.relations ?? []).some((relation) => relation.source === actor.id
              && relation.target === role.id && relation.type === 'assigned-to'));
        const expectedActorType = actor?.type === 'actor-agent' ? 'workload' : null;
        if (actor?.type === 'actor-human') {
          throw conflict('Human-assigned tasks require a durable human checkpoint flow; they cannot be represented as executor runs.', null, 'PROCESS_TASK_HUMAN_CHECKPOINT_REQUIRED');
        }
        if (!blueprint || !linkedRole || !expectedActorType) {
          throw conflict('The task assignment does not match an actor and role in its pinned blueprint.', null, 'PROCESS_TASK_ASSIGNMENT_INVALID');
        }
        const binding = await client.query(`
          select b.status, b.execution_profile_ids, b.target_principal, b.target_membership_generation, b.target_authz_generation,
            identity.actor_type, identity.status as identity_status,
            identity.authz_generation as current_authz_generation
          from orgward.project_actor_binding_proposals b
          join orgward.oidc_principals identity
            on identity.tenant_id = b.tenant_id and identity.principal = b.target_principal
          where b.tenant_id = $1 and b.project_id = $2 and b.blueprint_version = $3
            and b.actor_id = $4 and b.role_id = $5
          for update of b, identity
        `, [tenantId, projectId, plan.source.blueprintVersion, actor.id, role.id]);
        if (!binding.rowCount || binding.rows[0].status !== 'enabled') {
          throw conflict('The task requires an enabled actor binding for its pinned blueprint version.', null, 'PROCESS_TASK_ACTOR_BINDING_UNAVAILABLE');
        }
        const target = binding.rows[0];
        if (!Array.isArray(target.execution_profile_ids) || !target.execution_profile_ids.includes(profileId)) {
          throw conflict('This agent identity is approved only for its owner-selected execution profiles. Choose a profile shown on its binding.', null, 'PROCESS_TASK_PROFILE_OUTSIDE_ENVELOPE');
        }
        const membership = await client.query(`
          select access, generation, revoked_at
          from orgward.project_memberships
          where tenant_id = $1 and project_id = $2 and principal = $3
          for update
        `, [tenantId, projectId, target.target_principal]);
        if (target.actor_type !== expectedActorType) {
          throw conflict('The assigned identity type no longer matches its blueprint actor.', null, 'PROCESS_TASK_ACTOR_TYPE_MISMATCH');
        }
        if (target.identity_status !== 'active' || !membership.rowCount || membership.rows[0].revoked_at !== null
          || !['owner', 'editor'].includes(membership.rows[0].access)) {
          throw conflict('The assigned identity is no longer an active project owner or editor.', null, 'PROCESS_TASK_ACTOR_BINDING_INELIGIBLE');
        }
        if (Number(target.target_authz_generation) !== Number(target.current_authz_generation)
          || Number(target.target_membership_generation) !== Number(membership.rows[0].generation)) {
          throw conflict('The assigned identity or project membership changed after binding approval.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
        }

        let delegatedContext = null;
        let delegation = null;
        if (parentRunId) {
          const parentRecord = await client.query(`select a.*,s.project_id as scoped_project_id
            from orgward.aggregates a join orgward.aggregate_project_scopes s
              on s.tenant_id=a.tenant_id and s.aggregate_kind=a.aggregate_kind and s.aggregate_id=a.aggregate_id
            where a.tenant_id=$1 and a.aggregate_kind='execution_run' and a.aggregate_id=$2 and s.project_id=$3
            for share of a,s`, [tenantId, parentRunId, projectId]);
          if (!parentRecord.rowCount) throw conflict('The parent run is unavailable in this project.', null, 'PROCESS_TASK_DELEGATION_PARENT_UNAVAILABLE');
          const parentRun = verifyAggregateRow(parentRecord.rows[0]);
          const parentRef = parentRun.processTaskRef;
          if (parentRun.status !== 'SUCCEEDED' || parentRun.execution?.status !== 'COMPLETED'
            || !parentRef || parentRef.processPlanId !== planId || parentRef.revision !== revision
            || parentRef.planInstanceId !== instanceId || parentRef.blueprintId !== plan.source.blueprintId
            || parentRef.blueprintVersion !== plan.source.blueprintVersion || parentRef.taskId === taskId
            || (parentRef.actorId === actor.id && parentRef.roleId === role.id)) {
            throw conflict('Delegation requires a completed parent run in this exact source and a different enabled actor/role binding.', null, 'PROCESS_TASK_DELEGATION_SOURCE_MISMATCH');
          }
          const parentRuntime = await client.query(`select * from orgward.process_task_instances
            where tenant_id=$1 and project_id=$2 and plan_instance_id=$3 and task_id=$4 for share`,
          [tenantId, projectId, instanceId, parentRef.taskId]);
          if (!parentRuntime.rowCount || parentRuntime.rows[0].execution_run_id !== parentRun.id
            || parentRuntime.rows[0].status !== 'SUCCEEDED' || parentRuntime.rows[0].actor_type !== 'workload') {
            throw conflict('The parent run is not a completed linked workload task.', null, 'PROCESS_TASK_DELEGATION_PARENT_UNAVAILABLE');
          }
          const parentBinding = await client.query(`select b.status,b.execution_profile_ids,b.target_principal,
              b.target_membership_generation,b.target_authz_generation,
              i.actor_type,i.status as identity_status,i.authz_generation as current_authz_generation,
              m.access,m.generation as current_membership_generation,m.revoked_at
            from orgward.project_actor_binding_proposals b
            join orgward.oidc_principals i on i.tenant_id=b.tenant_id and i.principal=b.target_principal
            join orgward.project_memberships m on m.tenant_id=b.tenant_id and m.project_id=b.project_id and m.principal=b.target_principal
            where b.tenant_id=$1 and b.project_id=$2 and b.blueprint_version=$3 and b.actor_id=$4 and b.role_id=$5
            for share of b,i,m`, [tenantId, projectId, parentRef.blueprintVersion, parentRef.actorId, parentRef.roleId]);
          if (!parentBinding.rowCount || parentBinding.rows[0].status !== 'enabled'
            || parentBinding.rows[0].target_principal !== parentRuntime.rows[0].assigned_principal
            || !Array.isArray(parentBinding.rows[0].execution_profile_ids)
            || !parentBinding.rows[0].execution_profile_ids.includes(parentRun.profile?.id)
            || parentBinding.rows[0].actor_type !== 'workload' || parentBinding.rows[0].identity_status !== 'active'
            || parentBinding.rows[0].revoked_at !== null || !['owner','editor'].includes(parentBinding.rows[0].access)
            || Number(parentBinding.rows[0].target_authz_generation) !== Number(parentBinding.rows[0].current_authz_generation)
            || Number(parentBinding.rows[0].target_membership_generation) !== Number(parentBinding.rows[0].current_membership_generation)) {
            throw conflict('The completed parent no longer has its current owner-approved profile envelope.', null, 'PROCESS_TASK_DELEGATION_PARENT_BINDING_STALE');
          }
          const parentOutput = [parentRun.execution.stdout, parentRun.execution.stderr].filter((value) => typeof value === 'string' && value.length).join('\n');
          delegatedContext = { parentRunId: parentRun.id, parentStatus: parentRun.status,
            parentExecutionHash: contentHash(parentRun.execution), text: parentOutput.slice(0, 4000) };
          delegation = { parentRunId: parentRun.id, parentExecutionHash: delegatedContext.parentExecutionHash,
            contextHash: contentHash(delegatedContext) };
        }

        const processTaskRef = {
          processPlanId: plan.id, revision: plan.revision,
          planInstanceId: instanceId, taskId: task.id,
          blueprintId: plan.source.blueprintId, blueprintVersion: plan.source.blueprintVersion,
          processId: plan.source.processId, processName: plan.source.processName,
          actorId: actor.id, roleId: role.id,
          ...(flowActivation ? { flowBinding: { snapshotHash: plan.snapshotHash, definitionHash: plan.flow.definitionHash, activationIdentity: flowActivation.identity } } : {}),
          ...(delegation ? { delegation } : {}),
          ...(behaviorTestPlanRef ? { behaviorTestPlan: behaviorTestPlanRef } : {}),
          ...(repositoryRef ? { repository: structuredClone(repositoryRef) } : {}),
        };
        const run = await buildRun({ project, plan, task, processTaskRef, client, delegatedContext,
          behaviorTestPlan: behaviorTestPlanRef });
        if (!run || run.tenantId !== tenantId || run.projectId !== projectId
          || run.processTaskRef && contentHash(run.processTaskRef) !== contentHash(processTaskRef)) {
          throw persistenceIntegrity('A process task run builder returned mismatched immutable references.');
        }
        run.processTaskRef = processTaskRef;
        await client.query(`
          insert into orgward.process_task_instances (
            tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id, task_id,
            blueprint_id, blueprint_version, process_id, actor_id, role_id, actor_type,
            assigned_principal, assigned_membership_generation, assigned_authz_generation,
            status, version, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'PLANNED',0,now(),now())
        `, [tenantId, projectId, plan.id, plan.revision, instanceId, task.id,
          plan.source.blueprintId, plan.source.blueprintVersion, plan.source.processId,
          actor.id, role.id, expectedActorType, target.target_principal,
          Number(target.target_membership_generation), Number(target.target_authz_generation)]);
        await this.saveInTransaction(client, run, {
          principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
        });
        const commandResult = { id: run.id, tenantId, projectId, version: run.version, processTaskRef };
        await client.query(`
          insert into orgward.command_results
            (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
          values ($1, $2, $3, $4, 'execution_run', $5, $6::jsonb, $7)
        `, [tenantId, operation, commandId, requestHash, run.id, canonicalJson(commandResult), contentHash(commandResult)]);
        return { run, replayed: false };
      });
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'aggregates_execution_process_task_once_idx') {
        throw conflict('This task already has an approval request in this plan instance.', null, 'PROCESS_TASK_ALREADY_REQUESTED');
      }
      throw error;
    }
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async cancelProcessTaskRun({
    tenantId, projectId, runId, principal, authzGeneration, version, commandId, requestHash,
  }) {
    if (!tenantId || !projectId || !runId || !principal || !commandId || !requestHash) throw projectAccessDenied();
    const operation = 'execution.process-task.cancel';
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const priorCommand = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (priorCommand.rowCount) {
        if (priorCommand.rows[0].payload_hash !== requestHash) {
          throw conflict('This command ID was already used with different cancellation input.', null, 'IDEMPOTENCY_CONFLICT');
        }
        const recorded = verifyCommandRow(priorCommand.rows[0]);
        if (priorCommand.rows[0].aggregate_kind !== 'execution_run'
          || recorded.id !== runId || priorCommand.rows[0].aggregate_id !== runId
          || recorded.tenantId !== tenantId || recorded.projectId !== projectId
          || recorded.status !== 'CANCELLED') {
          throw persistenceIntegrity('A cancellation command result does not match its linked execution run.');
        }
        const selected = await client.query(`
          select a.*, s.project_id as scoped_project_id
          from orgward.aggregates a
          join orgward.aggregate_project_scopes s
            on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
          where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
            and s.project_id = $3
          for share of a, s
        `, [tenantId, runId, projectId]);
        if (!selected.rowCount) throw persistenceIntegrity('A cancellation command result has no scoped execution run.');
        const run = verifyAggregateRow(selected.rows[0]);
        const cancellation = run.events?.filter((entry) => entry.type === 'ExecutionCancelled' && entry.causationId === commandId) ?? [];
        if (run.status !== 'CANCELLED' || run.requestedBy !== principal
          || contentHash(run.processTaskRef) !== contentHash(recorded.processTaskRef)
          || cancellation.length !== 1) {
          throw persistenceIntegrity('A cancellation replay no longer matches its immutable run event.');
        }
        return { run, replayed: true };
      }

      await lockLinkedRunControl(client, tenantId, runId);

      const selected = await client.query(`
        select a.*, s.project_id as scoped_project_id
        from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
          and s.project_id = $3
        for update of a
      `, [tenantId, runId, projectId]);
      if (!selected.rowCount) return null;
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.projectId !== projectId || run.tenantId !== tenantId) {
        throw persistenceIntegrity('The linked execution run project scope does not match its aggregate.');
      }
      if (run.requestedBy !== principal) throw projectAccessDenied();
      if (!run.processTaskRef) throw conflict('Only a linked process-task run can be withdrawn.', run.version, 'PROCESS_TASK_CANCELLATION_UNAVAILABLE');
      if (!['AWAITING_APPROVAL', 'APPROVED', 'PAUSED'].includes(run.status)) {
        throw conflict('Only pending, approved, or paused linked runs can be withdrawn; a running task cannot be withdrawn here.', run.version, 'PROCESS_TASK_CANCELLATION_UNAVAILABLE');
      }
      if (run.version !== version) throw conflict(`Version conflict: expected persisted version ${version}. Reload before retrying.`, run.version);
      const ref = run.processTaskRef;
      const runtimeRows = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id = $1 and project_id = $2 and plan_instance_id = $3 and task_id = $4
        for update
      `, [tenantId, projectId, ref.planInstanceId, ref.taskId]);
      const runtime = assertLinkedWorkloadRuntime(runtimeRows.rows[0], run);
      cancelProcessTaskExecutionRun(run, { principal, commandId });
      await this.saveInTransaction(client, run, {
        expectedVersion: version, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
        runtimeCommandId: commandId,
      });
      const commandResult = {
        id: run.id, tenantId, projectId, version: run.version, status: 'CANCELLED',
        processTaskRef: structuredClone(run.processTaskRef),
      };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1, $2, $3, $4, 'execution_run', $5, $6::jsonb, $7)
      `, [tenantId, operation, commandId, requestHash, run.id, canonicalJson(commandResult), contentHash(commandResult)]);
      return { run, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async pauseProcessTaskRun({
    tenantId, projectId, runId, principal, authzGeneration, version, commandId, requestHash,
  }) {
    if (!tenantId || !projectId || !runId || !principal || !commandId || !requestHash) throw projectAccessDenied();
    const operation = 'execution.process-task.pause';
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const priorCommand = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (priorCommand.rowCount) {
        if (priorCommand.rows[0].payload_hash !== requestHash) {
          throw conflict('This command ID was already used with different pause input.', null, 'IDEMPOTENCY_CONFLICT');
        }
        const recorded = verifyCommandRow(priorCommand.rows[0]);
        if (priorCommand.rows[0].aggregate_kind !== 'execution_run'
          || recorded.id !== runId || recorded.tenantId !== tenantId || recorded.projectId !== projectId
          || recorded.status !== 'PAUSED') {
          throw persistenceIntegrity('A pause command result does not match its linked execution run.');
        }
        const selected = await client.query(`
          select a.* from orgward.aggregates a
          join orgward.aggregate_project_scopes s
            on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
          where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
            and s.project_id = $3
          for share of a, s
        `, [tenantId, runId, projectId]);
        if (!selected.rowCount) throw persistenceIntegrity('A pause command result has no scoped execution run.');
        const run = verifyAggregateRow(selected.rows[0]);
        const pauseEvents = run.events?.filter((event) => event.type === 'ExecutionPaused' && event.causationId === commandId) ?? [];
        if (run.projectId !== projectId || run.requestedBy !== principal
          || contentHash(run.processTaskRef) !== contentHash(recorded.processTaskRef) || pauseEvents.length !== 1) {
          throw persistenceIntegrity('A pause replay no longer matches its immutable run event.');
        }
        return { run, replayed: true };
      }

      await lockLinkedRunControl(client, tenantId, runId);

      const selected = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
          and s.project_id = $3
        for update of a
      `, [tenantId, runId, projectId]);
      if (!selected.rowCount) return null;
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.projectId !== projectId || run.tenantId !== tenantId) {
        throw persistenceIntegrity('The linked execution run project scope does not match its aggregate.');
      }
      if (run.requestedBy !== principal) throw projectAccessDenied();
      if (!run.processTaskRef) throw conflict('Only a linked process-task run can be paused.', run.version, 'PROCESS_TASK_PAUSE_UNAVAILABLE');
      if (!['AWAITING_APPROVAL', 'APPROVED'].includes(run.status)) {
        throw conflict('Only a pending or approved linked run can be paused before work starts.', run.version, 'PROCESS_TASK_PAUSE_UNAVAILABLE');
      }
      if (run.version !== version) throw conflict(`Version conflict: expected persisted version ${version}. Reload before retrying.`, run.version);
      const ref = run.processTaskRef;
      const runtimeRows = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id = $1 and project_id = $2 and plan_instance_id = $3 and task_id = $4
        for update
      `, [tenantId, projectId, ref.planInstanceId, ref.taskId]);
      const runtime = assertLinkedWorkloadRuntime(runtimeRows.rows[0], run);
      if (runtime.started_at !== null || runtime.completed_at !== null) {
        throw persistenceIntegrity('A linked run can only be paused before its task runtime starts.');
      }
      pauseProcessTaskExecutionRun(run, { principal, commandId });
      await this.saveInTransaction(client, run, {
        expectedVersion: version, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
        runtimeCommandId: commandId,
      });
      const commandResult = {
        id: run.id, tenantId, projectId, version: run.version, status: 'PAUSED',
        processTaskRef: structuredClone(run.processTaskRef),
      };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1, $2, $3, $4, 'execution_run', $5, $6::jsonb, $7)
      `, [tenantId, operation, commandId, requestHash, run.id, canonicalJson(commandResult), contentHash(commandResult)]);
      return { run, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async amendPausedProcessTaskRun({
    tenantId, projectId, runId, principal, authzGeneration, version, commandId, requestHash,
    objective, requirements, reason,
  }) {
    if (!tenantId || !projectId || !runId || !principal || !commandId || !requestHash) throw projectAccessDenied();
    const operation = 'execution.process-task.amend';
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const priorCommand = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (priorCommand.rowCount) {
        if (priorCommand.rows[0].payload_hash !== requestHash) {
          throw conflict('This command ID was already used with different amendment input.', null, 'IDEMPOTENCY_CONFLICT');
        }
        const recorded = verifyCommandRow(priorCommand.rows[0]);
        if (priorCommand.rows[0].aggregate_kind !== 'execution_run' || recorded.id !== runId
          || recorded.tenantId !== tenantId || recorded.projectId !== projectId || recorded.status !== 'PAUSED') {
          throw persistenceIntegrity('An amendment command result does not match its linked execution run.');
        }
        const selected = await client.query(`
          select a.* from orgward.aggregates a
          join orgward.aggregate_project_scopes s
            on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
          where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
            and s.project_id = $3
          for share of a, s
        `, [tenantId, runId, projectId]);
        if (!selected.rowCount) throw persistenceIntegrity('An amendment command result has no scoped execution run.');
        const run = verifyAggregateRow(selected.rows[0]);
        const amendmentEvents = run.events?.filter((entry) => entry.type === 'ExecutionInstructionsAmended'
          && entry.causationId === commandId) ?? [];
        const recordedRevision = run.interventionRevisions?.find((entry) => entry.revision === recorded.interventionRevision?.revision);
        if (run.projectId !== projectId || run.requestedBy !== principal || amendmentEvents.length !== 1
          || contentHash(recordedRevision) !== contentHash(recorded.interventionRevision)
          || contentHash(amendmentEvents[0]?.data?.revision) !== contentHash(recorded.interventionRevision)) {
          throw persistenceIntegrity('An amendment replay no longer matches its immutable run revision.');
        }
        return { run, replayed: true };
      }

      await lockLinkedRunControl(client, tenantId, runId);

      const selected = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
          and s.project_id = $3
        for update of a
      `, [tenantId, runId, projectId]);
      if (!selected.rowCount) return null;
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.projectId !== projectId || run.tenantId !== tenantId) {
        throw persistenceIntegrity('The linked execution run project scope does not match its aggregate.');
      }
      if (run.requestedBy !== principal) throw projectAccessDenied();
      if (!run.processTaskRef) throw conflict('Only a linked process-task run can be amended.', run.version, 'PROCESS_TASK_AMEND_UNAVAILABLE');
      if (run.status !== 'PAUSED' || run.approval !== null || run.execution !== null) {
        throw conflict('Only a paused, unapproved linked run can be amended before execution.', run.version, 'PROCESS_TASK_AMEND_UNAVAILABLE');
      }
      if (run.version !== version) throw conflict(`Version conflict: expected persisted version ${version}. Reload before retrying.`, run.version);
      const ref = run.processTaskRef;
      const runtimeRows = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id = $1 and project_id = $2 and plan_instance_id = $3 and task_id = $4
        for update
      `, [tenantId, projectId, ref.planInstanceId, ref.taskId]);
      const runtime = assertLinkedWorkloadRuntime(runtimeRows.rows[0], run);
      if (runtime.started_at !== null || runtime.completed_at !== null) {
        throw conflict('Instructions can only be amended before the linked task runtime starts.', run.version, 'PROCESS_TASK_AMEND_UNAVAILABLE');
      }
      amendPausedProcessTaskExecutionRun(run, { principal, commandId, objective, requirements, reason });
      const revision = run.interventionRevisions.at(-1);
      if (run.workItem.proposalContext) {
        const buildPrompt = run.workItem.taskGuidance ? buildBlueprintProposalPrompt : buildLegacyBlueprintProposalPrompt;
        buildPrompt({
          task: { id: ref.taskId, title: run.title, detail: revision.objective },
          proposalContext: run.workItem.proposalContext,
          ...(run.workItem.taskGuidance ? { taskGuidance: run.workItem.taskGuidance, processTaskRef: ref } : {}),
          amendedRequirements: revision.requirements,
        });
      }
      await this.saveInTransaction(client, run, {
        expectedVersion: version, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
        runtimeCommandId: commandId,
      });
      const commandResult = {
        id: run.id, tenantId, projectId, version: run.version, status: 'PAUSED',
        processTaskRef: structuredClone(run.processTaskRef),
        interventionRevision: structuredClone(run.interventionRevisions.at(-1)),
      };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1, $2, $3, $4, 'execution_run', $5, $6::jsonb, $7)
      `, [tenantId, operation, commandId, requestHash, run.id, canonicalJson(commandResult), contentHash(commandResult)]);
      return { run, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async resumeProcessTaskRun({
    tenantId, projectId, runId, principal, authzGeneration, version, commandId, requestHash,
    validateCurrentProfile, reason = null,
  }) {
    if (!tenantId || !projectId || !runId || !principal || !commandId || !requestHash
      || typeof validateCurrentProfile !== 'function'
      || (reason !== null && (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500))) throw projectAccessDenied();
    reason = reason?.replace(/\s+/g, ' ').trim() ?? null;
    const operation = 'execution.process-task.resume';
    const outcome = await this.persistence.transaction(async (client) => {
      const callerMembership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const priorCommand = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (priorCommand.rowCount) {
        if (priorCommand.rows[0].payload_hash !== requestHash) {
          throw conflict('This command ID was already used with different resume input.', null, 'IDEMPOTENCY_CONFLICT');
        }
        const recorded = verifyCommandRow(priorCommand.rows[0]);
        if (priorCommand.rows[0].aggregate_kind !== 'execution_run'
          || recorded.id !== runId || recorded.tenantId !== tenantId || recorded.projectId !== projectId
          || recorded.status !== 'AWAITING_APPROVAL') {
          throw persistenceIntegrity('A resume command result does not match its linked execution run.');
        }
        const selected = await client.query(`
          select a.* from orgward.aggregates a
          join orgward.aggregate_project_scopes s
            on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
          where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
            and s.project_id = $3
          for share of a, s
        `, [tenantId, runId, projectId]);
        if (!selected.rowCount) throw persistenceIntegrity('A resume command result has no scoped execution run.');
        const run = verifyAggregateRow(selected.rows[0]);
        const resumeEvents = run.events?.filter((event) => event.type === 'ExecutionResumed' && event.causationId === commandId) ?? [];
        const resumeEvent = resumeEvents[0];
        const ownerRecovery = run.requestedBy !== principal && callerMembership.access === 'owner';
        if (run.projectId !== projectId || (run.requestedBy !== principal && !ownerRecovery)
          || resumeEvent?.actor !== principal || Boolean(resumeEvent?.data?.ownerRecovery) !== ownerRecovery
          || (ownerRecovery && (resumeEvent?.data?.reason !== reason || !reason?.trim()))
          || contentHash(run.processTaskRef) !== contentHash(recorded.processTaskRef) || resumeEvents.length !== 1) {
          throw persistenceIntegrity('A resume replay no longer matches its immutable run event.');
        }
        return { run, replayed: true };
      }

      const selectedProject = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
        for share
      `, [tenantId, projectId]);
      if (!selectedProject.rowCount) return null;
      const project = verifyAggregateRow(selectedProject.rows[0]);
      await lockLinkedRunControl(client, tenantId, runId);
      const selected = await client.query(`
        select a.* from orgward.aggregates a
        join orgward.aggregate_project_scopes s
          on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
        where a.tenant_id = $1 and a.aggregate_kind = 'execution_run' and a.aggregate_id = $2
          and s.project_id = $3
        for update of a
      `, [tenantId, runId, projectId]);
      if (!selected.rowCount) return null;
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.projectId !== projectId || run.tenantId !== tenantId) {
        throw persistenceIntegrity('The linked execution run project scope does not match its aggregate.');
      }
      const ownerRecovery = run.requestedBy !== principal && callerMembership.access === 'owner';
      if (run.requestedBy !== principal && !ownerRecovery) throw projectAccessDenied();
      if (ownerRecovery && !reason?.trim()) throw conflict('Current project owner recovery requires a reason.', run.version, 'RECOVERY_REASON_REQUIRED');
      if (!run.processTaskRef) throw conflict('Only a linked process-task run can be resumed.', run.version, 'PROCESS_TASK_RESUME_UNAVAILABLE');
      if (run.status !== 'PAUSED') throw conflict('Only a paused linked run can be resumed.', run.version, 'PROCESS_TASK_RESUME_UNAVAILABLE');
      if (run.version !== version) throw conflict(`Version conflict: expected persisted version ${version}. Reload before retrying.`, run.version);

      const ref = run.processTaskRef;
      const runtimeRows = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id = $1 and project_id = $2 and plan_instance_id = $3 and task_id = $4
        for update
      `, [tenantId, projectId, ref.planInstanceId, ref.taskId]);
      const runtime = assertLinkedWorkloadRuntime(runtimeRows.rows[0], run);
      if (runtime.started_at !== null || runtime.completed_at !== null || run.approval !== null) {
        throw persistenceIntegrity('A paused process task must remain unstarted and require a new approval.');
      }

      const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId, project, planId: ref.processPlanId, revision: ref.revision });
      if (!plan || plan.source?.projectId !== projectId || plan.source?.blueprintId !== ref.blueprintId
        || plan.source?.blueprintVersion !== ref.blueprintVersion || plan.source?.processId !== ref.processId) {
        throw conflict('The immutable plan revision pinned to this paused task is no longer available.', run.version, 'PROCESS_PLAN_REVISION_NOT_FOUND');
      }
      if (plan.kind === 'manual_process_flow_plan') await requireAdvancedLinkedRunActivation(client, run);
      const task = plan.tasks?.find((candidate) => candidate.id === ref.taskId);
      const assignee = task?.assignee;
      if (!task || assignee?.kind !== 'blueprint-actor' || assignee.actorId !== ref.actorId || assignee.roleId !== ref.roleId) {
        throw conflict('The immutable task or actor assignment no longer matches the paused request.', run.version, 'PROCESS_TASK_ASSIGNMENT_STALE');
      }
      const expectedRequirements = [
        ...task.inputs.map((entry) => `Use input: ${entry.label}`),
        ...task.outputs.map((entry) => `Produce output: ${entry.label}`),
      ];
      const expectedSourceRefs = [
        `process-plan:${plan.id}:revision:${plan.revision}`,
        `task:${task.id}`,
        ...task.inputs.map((entry) => `input:${entry.objectId}`),
        ...task.outputs.map((entry) => `output:${entry.objectId}`),
      ];
      if (task.title !== run.title || task.detail !== run.workItem.objective
        || contentHash(expectedRequirements) !== contentHash(run.workItem.requirements)
        || contentHash(expectedSourceRefs) !== contentHash(run.workItem.sourceRefs)) {
        throw conflict('The pinned task instructions or dependencies no longer match the paused request.', run.version, 'PROCESS_TASK_ASSIGNMENT_STALE');
      }
      if (!Array.isArray(task.dependencies)) throw persistenceIntegrity('The pinned process task has invalid dependencies.');
      if (task.dependencies.length) {
        const dependencies = await client.query(`
          select task_id, status from orgward.process_task_instances
          where tenant_id = $1 and project_id = $2 and plan_instance_id = $3 and task_id = any($4::text[])
          order by task_id for share
        `, [tenantId, projectId, ref.planInstanceId, task.dependencies]);
        const completed = new Map(dependencies.rows.map((entry) => [entry.task_id, entry.status]));
        if (task.dependencies.some((dependencyId) => completed.get(dependencyId) !== 'SUCCEEDED')) {
          throw conflict('A paused task cannot resume until its dependencies are still succeeded in the same instance.', run.version, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
        }
      }

      const blueprint = project.blueprintVersions?.find((entry) => entry.id === ref.blueprintId && entry.version === ref.blueprintVersion);
      const blueprintObjects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
      const actor = blueprintObjects.find((entry) => entry.id === ref.actorId);
      const role = blueprintObjects.find((entry) => entry.id === ref.roleId);
      const linkedRole = actor?.type === 'actor-agent' && role?.type === 'role'
        && ((actor.assignedRoles ?? []).includes(role.id)
          || (blueprint.relations ?? []).some((entry) => entry.source === actor.id
            && entry.target === role.id && entry.type === 'assigned-to'));
      if (!blueprint || !linkedRole) {
        throw conflict('The pinned blueprint actor or role assignment is no longer valid.', run.version, 'PROCESS_TASK_ASSIGNMENT_STALE');
      }
      const bindingRows = await client.query(`
        select b.status, b.target_principal, b.target_membership_generation, b.target_authz_generation,
          identity.actor_type, identity.status as identity_status,
          identity.authz_generation as current_authz_generation
        from orgward.project_actor_binding_proposals b
        join orgward.oidc_principals identity
          on identity.tenant_id = b.tenant_id and identity.principal = b.target_principal
        where b.tenant_id = $1 and b.project_id = $2 and b.blueprint_version = $3
          and b.actor_id = $4 and b.role_id = $5
        for update of b, identity
      `, [tenantId, projectId, ref.blueprintVersion, ref.actorId, ref.roleId]);
      const binding = bindingRows.rows[0];
      if (!binding || binding.status !== 'enabled' || binding.target_principal !== runtime.assigned_principal
        || binding.actor_type !== 'workload' || binding.identity_status !== 'active'
        || Number(binding.target_authz_generation) !== Number(binding.current_authz_generation)
        || Number(binding.target_authz_generation) !== Number(runtime.assigned_authz_generation)) {
        throw conflict('The original workload binding is no longer current; the paused request remains paused.', run.version, 'PROCESS_TASK_ACTOR_BINDING_STALE');
      }
      const membershipRows = await client.query(`
        select access, generation, revoked_at from orgward.project_memberships
        where tenant_id = $1 and project_id = $2 and principal = $3
        for update
      `, [tenantId, projectId, binding.target_principal]);
      const membership = membershipRows.rows[0];
      if (!membership || membership.revoked_at !== null || !['owner', 'editor'].includes(membership.access)
        || Number(membership.generation) !== Number(binding.target_membership_generation)
        || Number(membership.generation) !== Number(runtime.assigned_membership_generation)) {
        throw conflict('The original workload project membership is no longer current; the paused request remains paused.', run.version, 'PROCESS_TASK_ACTOR_BINDING_STALE');
      }
      await validateCurrentProfile(run, client);

      resumeProcessTaskExecutionRun(run, { principal, commandId, ownerRecovery, reason });
      await this.saveInTransaction(client, run, {
        expectedVersion: version, principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
        runtimeCommandId: commandId,
      });
      const commandResult = {
        id: run.id, tenantId, projectId, version: run.version, status: 'AWAITING_APPROVAL',
        processTaskRef: structuredClone(run.processTaskRef),
      };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1, $2, $3, $4, 'execution_run', $5, $6::jsonb, $7)
      `, [tenantId, operation, commandId, requestHash, run.id, canonicalJson(commandResult), contentHash(commandResult)]);
      return { run, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async listProcessTaskInstancesForPrincipal({ tenantId, projectId, principal, authzGeneration }) {
    if (!tenantId || !projectId || !principal) return null;
    return this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'reader' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, anyRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']], authzGeneration,
      });
      const projectResult = await client.query(`select * from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, projectId]);
      if (!projectResult.rowCount) return null;
      const project = verifyAggregateRow(projectResult.rows[0]);
      const advancedControls = (project.processPlans ?? []).some((plan) => plan.kind === 'manual_process_flow_plan')
        ? await client.query(`select * from orgward.process_task_instance_controls where tenant_id=$1 and project_id=$2 order by plan_instance_id for share`, [tenantId, projectId]) : { rows: [] };
      const controlsById = new Map(advancedControls.rows.map((control) => [control.plan_instance_id, control]));
      const result = await client.query(`
        select r.*, c.status as instance_control_status, c.version as instance_control_version,
          c.initiated_by as instance_control_initiated_by, c.pause_reason as instance_control_pause_reason,
          c.pause_boundary as instance_control_pause_boundary, c.events as instance_control_events,
          (caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access in ('editor','owner') and caller_membership.revoked_at is null
            and (c.initiated_by = $3 or caller_membership.access = 'owner')
            and c.status = 'PAUSED'
            and not exists (select 1 from orgward.process_task_instances active
              where active.tenant_id=r.tenant_id and active.plan_instance_id=r.plan_instance_id
                and active.status in ('IN_PROGRESS','ESCALATED','RUNNING'))
            and not exists (select 1 from orgward.execution_worker_leases l
              join orgward.aggregates la on la.tenant_id=l.tenant_id and la.aggregate_kind='execution_run' and la.aggregate_id=l.run_id
              where l.tenant_id=r.tenant_id and l.lease_until>now()
                and la.state #>> '{processTaskRef,planInstanceId}'=r.plan_instance_id::text)
            and not exists (select 1 from orgward.provider_dispatch_attempts d
              join orgward.aggregates da on da.tenant_id=d.tenant_id and da.aggregate_kind='execution_run' and da.aggregate_id=d.run_id
              where d.tenant_id=r.tenant_id and da.state #>> '{processTaskRef,planInstanceId}'=r.plan_instance_id::text
                and d.status in ('reserved','handed_off','outcome_unknown'))
          ) as can_cancel_instance,
          (caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access in ('editor','owner') and caller_membership.revoked_at is null
            and (c.initiated_by = $3 or caller_membership.access = 'owner')) as can_control_instance,
          (caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access = 'owner' and caller_membership.revoked_at is null) as can_recover_instance,
          (caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access = 'owner' and caller_membership.revoked_at is null
            and c.status in ('PAUSE_REQUESTED','PAUSED')
            and not exists (select 1 from orgward.process_task_instances active
              where active.tenant_id=r.tenant_id and active.plan_instance_id=r.plan_instance_id
                and active.status in ('IN_PROGRESS','ESCALATED','RUNNING'))
            and not exists (select 1 from orgward.execution_worker_leases l
              join orgward.aggregates la on la.tenant_id=l.tenant_id and la.aggregate_kind='execution_run' and la.aggregate_id=l.run_id
              where l.tenant_id=r.tenant_id and l.lease_until>now()
                and la.state #>> '{processTaskRef,planInstanceId}'=r.plan_instance_id::text)
            and exists (select 1 from orgward.provider_dispatch_attempts d
              join orgward.aggregates da on da.tenant_id=d.tenant_id and da.aggregate_kind='execution_run' and da.aggregate_id=d.run_id
              where d.tenant_id=r.tenant_id and da.state #>> '{processTaskRef,planInstanceId}'=r.plan_instance_id::text
                and d.status in ('reserved','handed_off','outcome_unknown')
                and da.state #>> '{profile,kind}' in ('provider-openai','provider-deepseek')
                and da.state #>> '{workItem,proposalContext,target,type}'='information'
                and case when jsonb_typeof(da.state #> '{workItem,proposalContext,sourceEnvelope,sources}')='array'
                  then jsonb_array_length(da.state #> '{workItem,proposalContext,sourceEnvelope,sources}') between 1 and 8 else false end
                and not (da.state ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan']
                  or (da.state->'workItem') ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan','tools']))
            and not exists (select 1 from orgward.provider_dispatch_attempts d
              join orgward.aggregates da on da.tenant_id=d.tenant_id and da.aggregate_kind='execution_run' and da.aggregate_id=d.run_id
              where d.tenant_id=r.tenant_id and da.state #>> '{processTaskRef,planInstanceId}'=r.plan_instance_id::text
                and d.status in ('reserved','handed_off','outcome_unknown')
                and (d.status <> 'outcome_unknown' or coalesce(da.state #>> '{profile,kind}','') not in ('provider-openai','provider-deepseek')
                  or da.state #>> '{workItem,proposalContext,target,type}' <> 'information'
                  or case when jsonb_typeof(da.state #> '{workItem,proposalContext,sourceEnvelope,sources}')='array'
                    then jsonb_array_length(da.state #> '{workItem,proposalContext,sourceEnvelope,sources}') not between 1 and 8 else true end
                  or da.state ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan']
                  or (da.state->'workItem') ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan','tools']))
          ) as can_abandon_unverified,
          (coalesce(r.effective_assigned_principal, r.assigned_principal) = $3 and p.status = 'active'
            and coalesce(r.effective_assigned_authz_generation, r.assigned_authz_generation) = p.authz_generation
            and coalesce(r.effective_assigned_membership_generation, r.assigned_membership_generation) = m.generation and m.revoked_at is null)
            as assigned_to_current_principal,
          (r.effective_assigned_principal is not null) as has_effective_assignment_override,
          p.display_name as effective_assignee_display_name,
          (caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access = 'owner' and caller_membership.revoked_at is null)
            as can_view_effective_assignee,
          (caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access = 'owner' and caller_membership.revoked_at is null)
            as can_resolve_escalation,
          case when r.status = 'ESCALATED' and r.actor_type = 'human'
            and caller.status = 'active' and caller.actor_type = 'human'
            and caller.authz_generation = $4 and caller.roles @> array['workspace-write']::text[]
            and caller_membership.access = 'owner' and caller_membership.revoked_at is null then (
              select coalesce(jsonb_agg(jsonb_build_object('principal', eligible.principal, 'displayName', eligible.display_name)
                order by eligible.display_name, eligible.principal), '[]'::jsonb)
              from orgward.project_memberships eligible_membership
              join orgward.oidc_principals eligible
                on eligible.tenant_id = eligible_membership.tenant_id and eligible.principal = eligible_membership.principal
              where eligible_membership.tenant_id = r.tenant_id and eligible_membership.project_id = r.project_id
                and eligible_membership.revoked_at is null and eligible_membership.access in ('owner','editor')
                and eligible.status = 'active' and eligible.actor_type = 'human'
                and eligible.roles @> array['workspace-write']::text[]
                and eligible.principal <> coalesce(r.effective_assigned_principal, r.assigned_principal)
            ) else '[]'::jsonb end as human_reassignment_candidates
        from orgward.process_task_instances r
        left join orgward.process_task_instance_controls c
          on c.tenant_id = r.tenant_id and c.plan_instance_id = r.plan_instance_id
        left join orgward.oidc_principals p
          on p.tenant_id = r.tenant_id and p.principal = coalesce(r.effective_assigned_principal, r.assigned_principal)
        left join orgward.project_memberships m
          on m.tenant_id = r.tenant_id and m.project_id = r.project_id and m.principal = coalesce(r.effective_assigned_principal, r.assigned_principal)
        left join orgward.oidc_principals caller
          on caller.tenant_id = r.tenant_id and caller.principal = $3
        left join orgward.project_memberships caller_membership
          on caller_membership.tenant_id = r.tenant_id and caller_membership.project_id = r.project_id
            and caller_membership.principal = $3
        where r.tenant_id = $1 and r.project_id = $2
        order by r.created_at, r.plan_instance_id, r.task_id
        for share of r
      `, [tenantId, projectId, principal, authzGeneration]);
      const plans = new Map();
      const planRefs = new Map(result.rows.map((row) => [`${row.process_plan_id}\n${row.plan_revision}`, {
        planId: row.process_plan_id, revision: Number(row.plan_revision),
      }]));
      for (const [key, ref] of planRefs) {
        const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId, project, ...ref });
        if (!plan) throw persistenceIntegrity('A process task instance references a missing immutable plan revision.');
        const runtimes = result.rows.filter((row) => `${row.process_plan_id}\n${row.plan_revision}` === key);
        const tasks = verifyRuntimePlanTasks(plan, runtimes);
        verifyCompleteSoftwareRuntimeInstance(plan, runtimes, tasks);
        plans.set(`${plan.id}\n${plan.revision ?? 1}`, plan);
      }
      const promoted = await client.query(`select plan_id,runtime_revision from orgward.software_delivery_runtime_plans
        where tenant_id=$1 and project_id=$2 order by plan_id,runtime_revision`, [tenantId, projectId]);
      for (const row of promoted.rows) {
        const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId, project, planId: row.plan_id, revision: Number(row.runtime_revision) });
        if (!plan) throw persistenceIntegrity('A promoted software delivery plan snapshot is missing.');
        plans.set(`${plan.id}\n${plan.revision}`, plan);
      }
      for (const row of result.rows) {
        const plan = plans.get(`${row.process_plan_id}\n${Number(row.plan_revision)}`);
        const task = plan?.tasks?.find((candidate) => candidate.id === row.task_id);
        row.can_apply_human_task_output = Boolean(row.can_resolve_escalation && row.actor_type === 'human'
          && row.status === 'SUCCEEDED' && task?.outputs?.some((reference) => reference?.type === 'information')
          && await hasVerifiedHumanTaskSuccess(client, row));
      }
      for (const plan of project.processPlans ?? []) {
        if (plan.kind !== 'manual_process_flow_plan') continue;
        verifyManualFlowPlan(plan, project.blueprintVersions?.find((blueprint) => blueprint.id === plan.source.blueprintId && blueprint.version === plan.source.blueprintVersion));
        plans.set(`${plan.id}\n${plan.revision}`, { ...plan, activation: projectManualFlowActivation(plan) });
      }
      const activations = new Map();
      for (const row of result.rows) {
        const plan = plans.get(`${row.process_plan_id}\n${Number(row.plan_revision)}`);
        if (plan?.kind !== 'manual_process_flow_plan') continue;
        if (!activations.has(row.plan_instance_id)) {
          const control = controlsById.get(row.plan_instance_id);
          if (!control) throw persistenceIntegrity('The manual flow instance has no durable control.');
          activations.set(row.plan_instance_id, await manualFlowActivation(client, plan, result.rows.filter((candidate) => candidate.plan_instance_id === row.plan_instance_id), control, row.plan_instance_id));
        }
        row.manual_flow_activation = activations.get(row.plan_instance_id);
      }
      return { instances: result.rows.map((row) => processTaskRuntimeView(row, principal)), plans: [...plans.values()] };
    });
  }

  async pauseProcessTaskInstance({ tenantId, projectId, planInstanceId, principal, authzGeneration, version, reason, commandId, requestHash }) {
    const operation = 'execution.process-instance.pause';
    if (!tenantId || !projectId || !planInstanceId || !principal || !commandId || !requestHash
      || typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) throw projectAccessDenied();
    const outcome = await this.persistence.transaction(async (client) => {
      const membership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3`, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This command ID was already used with different pause input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.planInstanceId !== planInstanceId || recorded.projectId !== projectId) throw persistenceIntegrity('A process pause replay has mismatched instance references.');
        const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
        if (control?.initiated_by !== principal && membership.access !== 'owner') throw projectAccessDenied();
        if (!control || !control.events.some((event) => event.causationId === commandId && event.type === 'ProcessTaskInstancePauseRequested')) {
          throw persistenceIntegrity('A process pause replay no longer matches its append-only event.');
        }
        return { control, replayed: true };
      }
      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) return null;
      if (Number(control.version) !== version) throw conflict('The process instance control changed; reload before retrying.', Number(control.version), 'PROCESS_INSTANCE_CONTROL_CONFLICT');
      if (control.initiated_by !== principal && membership.access !== 'owner') throw projectAccessDenied();
      requireProcessTaskControlNotAbandoned(control);
      if (control.status !== 'ACTIVE') throw conflict('This process instance is already pausing or paused.', Number(control.version), 'PROCESS_INSTANCE_PAUSED');
      const runtimes = await client.query(`select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and plan_instance_id=$3 order by task_id for update`, [tenantId, projectId, planInstanceId]);
      if (!runtimes.rowCount) throw conflict('The process instance was not found.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      await loadProcessInstancePlan(client, { tenantId, projectId, control, runtimes: runtimes.rows });
      const boundary = [];
      let unresolvedWork = runtimes.rows.some((row) => ['IN_PROGRESS', 'ESCALATED', 'RUNNING'].includes(row.status));
      for (const runtime of runtimes.rows) {
        if (runtime.actor_type === 'human' && runtime.status === 'IN_PROGRESS') {
          boundary.push({ taskId: runtime.task_id, actorType: 'human', runtimeVersion: Number(runtime.version), status: runtime.status });
        }
        if (runtime.actor_type !== 'workload' || !runtime.execution_run_id) continue;
        const selected = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for update`, [tenantId, runtime.execution_run_id]);
        if (!selected.rowCount) throw persistenceIntegrity('A linked process task run is missing during instance pause.');
        const run = verifyAggregateRow(selected.rows[0]);
        const attempts = await client.query(`select * from orgward.provider_dispatch_attempts where tenant_id=$1 and run_id=$2 for update`, [tenantId, run.id]);
        const leases = await client.query(`select worker_id from orgward.execution_worker_leases where tenant_id=$1 and run_id=$2 and lease_until>now() for update`, [tenantId, run.id]);
        for (const attempt of attempts.rows) {
          if (attempt.status === 'reserved') await client.query(`update orgward.provider_dispatch_attempts set status='cancelled',finished_at=now(),updated_at=now() where tenant_id=$1 and run_id=$2 and attempt_id=$3 and status='reserved'`, [tenantId, run.id, attempt.attempt_id]);
        }
        if (leases.rowCount && !attempts.rows.some((attempt) => attempt.status === 'handed_off')) {
          await client.query(`update orgward.execution_worker_leases set cancel_requested_at=coalesce(cancel_requested_at,now()),cancel_reason=coalesce(cancel_reason,'process_instance_pause'),updated_at=now() where tenant_id=$1 and run_id=$2 and lease_until>now()`, [tenantId, run.id]);
        }
        if (['AWAITING_APPROVAL', 'APPROVED'].includes(run.status)) {
          pauseProcessTaskExecutionRun(run, { principal: run.requestedBy, commandId, instanceControl: true, actor: principal });
          await this.saveInTransaction(client, run, { expectedVersion: Number(selected.rows[0].version),
            principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration, runtimeCommandId: commandId,
            instanceControlMutation: true });
          continue;
        }
        const unresolvedAttempt = attempts.rows.find((attempt) => ['handed_off', 'outcome_unknown'].includes(attempt.status));
        const hasLiveLease = Boolean(leases.rowCount);
        if (run.status === 'RUNNING' || unresolvedAttempt || hasLiveLease) {
          if (unresolvedAttempt || hasLiveLease) unresolvedWork = true;
          const instructionRevision = run.interventionRevisions?.at(-1)?.revision ?? 0;
          boundary.push({ taskId: runtime.task_id, actorType: 'workload', runId: run.id,
            runVersion: Number(run.version), instructionRevision,
            instructionHash: contentHash(run.interventionRevisions?.at(-1) ?? run.workItem), status: run.status,
            attemptId: unresolvedAttempt?.attempt_id ?? null,
            attemptStatus: unresolvedAttempt?.status ?? null,
            liveLease: hasLiveLease });
        }
      }
      let next = await appendProcessTaskControl(client, control, { status: 'PAUSE_REQUESTED',
        reason: reason.trim(), boundary: { tasks: boundary, requestedAt: new Date().toISOString() },
        actor: principal, commandId, eventType: 'ProcessTaskInstancePauseRequested' });
      if (!unresolvedWork) next = await settleProcessTaskPauseIfDrained(client, tenantId, planInstanceId);
      const result = { planInstanceId, projectId, status: next.status, version: Number(next.version), reason: next.pause_reason, pauseBoundary: next.pause_boundary };
      await client.query(`insert into orgward.command_results (tenant_id,operation,command_id,payload_hash,aggregate_kind,aggregate_id,result,result_hash)
        values ($1,$2,$3,$4,'process_task_instance_control',$5,$6::jsonb,$7)`,
      [tenantId, operation, commandId, requestHash, planInstanceId, canonicalJson(result), contentHash(result)]);
      return { control: next, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async resumeProcessTaskInstance({ tenantId, projectId, planInstanceId, principal, authzGeneration, version, commandId, requestHash }) {
    const operation = 'execution.process-instance.resume';
    if (!tenantId || !projectId || !planInstanceId || !principal || !commandId || !requestHash) throw projectAccessDenied();
    const outcome = await this.persistence.transaction(async (client) => {
      const membership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3`, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This command ID was already used with different resume input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.planInstanceId !== planInstanceId || recorded.projectId !== projectId) throw persistenceIntegrity('A process resume replay has mismatched instance references.');
        const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
        if (control?.initiated_by !== principal && membership.access !== 'owner') throw projectAccessDenied();
        if (!control || !control.events.some((event) => event.causationId === commandId && event.type === 'ProcessTaskInstanceResumed')) throw persistenceIntegrity('A process resume replay no longer matches its append-only event.');
        return { control, replayed: true };
      }
      const projectRow = await client.query(`select * from orgward.aggregates where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, projectId]);
      if (!projectRow.rowCount) return null;
      const project = verifyAggregateRow(projectRow.rows[0]);
      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) return null;
      if (Number(control.version) !== version) throw conflict('The process instance control changed; reload before retrying.', Number(control.version), 'PROCESS_INSTANCE_CONTROL_CONFLICT');
      requireProcessTaskControlNotAbandoned(control);
      if (control.status !== 'PAUSED') throw conflict('The process instance must reach its recorded paused boundary before it can resume.', Number(control.version), 'PROCESS_INSTANCE_NOT_PAUSED');
      if (control.initiated_by !== principal && membership.access !== 'owner') throw projectAccessDenied();
      const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId, project, planId: control.process_plan_id, revision: Number(control.plan_revision) });
      if (!plan || plan.source?.projectId !== projectId) throw conflict('The immutable plan revision at the pause boundary is no longer available.', null, 'PROCESS_PLAN_REVISION_NOT_FOUND');
      const runtimes = await client.query(`select * from orgward.process_task_instances where tenant_id=$1 and plan_instance_id=$2 order by task_id for update`, [tenantId, planInstanceId]);
      await loadProcessInstancePlan(client, { tenantId, projectId, control, runtimes: runtimes.rows });
      const byTask = new Map(runtimes.rows.map((runtime) => [runtime.task_id, runtime]));
      for (const taskId of (control.pause_boundary?.tasks ?? []).map((task) => task.taskId)) {
        const task = plan.tasks.find((candidate) => candidate.id === taskId);
        if (!task) throw conflict('The paused task is no longer present in its pinned plan revision.', null, 'PROCESS_PLAN_REVISION_NOT_FOUND');
        for (const dependencyId of task.dependencies ?? []) {
          if (byTask.get(dependencyId)?.status !== 'SUCCEEDED') throw conflict('A pause-boundary task dependency is no longer satisfied; the instance remains paused.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
        }
      }
      const live = await client.query(`select 1 from orgward.execution_worker_leases l
        join orgward.aggregates a on a.tenant_id=l.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=l.run_id
        where l.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2 and l.lease_until>now() limit 1`, [tenantId, planInstanceId]);
      const unresolved = await client.query(`select 1 from orgward.provider_dispatch_attempts d
        join orgward.aggregates a on a.tenant_id=d.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
        where d.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2 and d.status in ('handed_off','outcome_unknown') limit 1`, [tenantId, planInstanceId]);
      if (live.rowCount || unresolved.rowCount || runtimes.rows.some((runtime) => ['IN_PROGRESS', 'ESCALATED', 'RUNNING'].includes(runtime.status))) {
        throw conflict('The recorded pause boundary still has unresolved work; reconcile it before resuming.', Number(control.version), 'PROCESS_INSTANCE_WORK_UNRESOLVED');
      }
      const next = await appendProcessTaskControl(client, control, { status: 'ACTIVE', reason: null,
        boundary: control.pause_boundary, actor: principal, commandId, eventType: 'ProcessTaskInstanceResumed' });
      const result = { planInstanceId, projectId, status: next.status, version: Number(next.version), pauseBoundary: next.pause_boundary,
        freshApprovalRequired: true };
      await client.query(`insert into orgward.command_results (tenant_id,operation,command_id,payload_hash,aggregate_kind,aggregate_id,result,result_hash)
        values ($1,$2,$3,$4,'process_task_instance_control',$5,$6::jsonb,$7)`,
      [tenantId, operation, commandId, requestHash, planInstanceId, canonicalJson(result), contentHash(result)]);
      return { control: next, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async abandonUnverifiedProcessTaskInstance({ tenantId, projectId, planInstanceId, principal, authzGeneration,
    version, commandId, requestHash, reason, evidence, acknowledgeDuplicateCostWork }) {
    const operation = 'execution.process-instance.abandon-unverified';
    const safeReason = typeof reason === 'string' ? reason.trim() : '';
    const safeEvidence = Array.isArray(evidence) ? evidence.map((entry) => typeof entry === 'string' ? entry.trim() : '') : [];
    if (!tenantId || !projectId || !planInstanceId || !principal || !commandId || !requestHash
      || !safeReason || safeReason.length > 1000 || !safeEvidence.length || safeEvidence.length > 20
      || safeEvidence.some((entry) => !entry || entry.length > 1000) || acknowledgeDuplicateCostWork !== true) {
      throw conflict('Unverified abandonment requires a reason, evidence, and explicit duplicate-cost acknowledgement.', null, 'INVALID_UNVERIFIED_ABANDONMENT');
    }
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'owner' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3`, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This command ID was already used with different abandonment input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.planInstanceId !== planInstanceId || recorded.projectId !== projectId) throw persistenceIntegrity('An abandonment replay has mismatched instance references.');
        const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
        if (!control || control.project_id !== projectId || control.status !== 'ABANDONED_UNVERIFIED'
          || !control.events.some((event) => event.causationId === commandId && event.type === 'ProcessTaskInstanceAbandonedUnverified'
            && event.actor === principal)) throw persistenceIntegrity('An abandonment replay no longer matches its append-only event.');
        return { control, replayed: true };
      }
      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) return null;
      if (Number(control.version) !== version) throw conflict('The process instance control changed; reload before retrying.', Number(control.version), 'PROCESS_INSTANCE_CONTROL_CONFLICT');
      if (!['PAUSE_REQUESTED', 'PAUSED'].includes(control.status)) {
        throw conflict('Only a paused or pausing process instance with an unresolved provider result may be abandoned as unverified.', Number(control.version), 'PROCESS_INSTANCE_ABANDONMENT_NOT_ALLOWED');
      }
      const runtimes = await client.query(`select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and plan_instance_id=$3 order by task_id for update`, [tenantId, projectId, planInstanceId]);
      if (!runtimes.rowCount) throw conflict('The process instance was not found.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      await loadProcessInstancePlan(client, { tenantId, projectId, control, runtimes: runtimes.rows });
      if (runtimes.rows.some((runtime) => ['IN_PROGRESS', 'ESCALATED', 'RUNNING'].includes(runtime.status))) {
        throw conflict('Active human or agent task work must settle before this instance can be abandoned as unverified.', Number(control.version), 'PROCESS_INSTANCE_WORK_UNRESOLVED');
      }
      const live = await client.query(`select l.run_id from orgward.execution_worker_leases l
        join orgward.aggregates a on a.tenant_id=l.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=l.run_id
        where l.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2 and l.lease_until>now() limit 1`, [tenantId, planInstanceId]);
      if (live.rowCount) throw conflict('An active worker lease must settle before this instance can be abandoned as unverified.', Number(control.version), 'PROCESS_INSTANCE_WORK_UNRESOLVED');
      const attempts = await client.query(`select d.run_id,d.attempt_id,d.status,a.state #>> '{profile,kind}' as profile_kind,
          (a.state #>> '{profile,kind}' in ('provider-openai','provider-deepseek')
            and a.state #>> '{workItem,proposalContext,target,type}'='information'
            and case when jsonb_typeof(a.state #> '{workItem,proposalContext,sourceEnvelope,sources}')='array'
              then jsonb_array_length(a.state #> '{workItem,proposalContext,sourceEnvelope,sources}') between 1 and 8 else false end
            and not (a.state ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan']
              or (a.state->'workItem') ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan','tools'])) as read_only_model_proposal
        from orgward.provider_dispatch_attempts d
        join orgward.aggregates a on a.tenant_id=d.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
        where d.tenant_id=$1 and a.state #>> '{processTaskRef,planInstanceId}'=$2
          and d.status in ('reserved','handed_off','outcome_unknown')
        order by d.run_id,d.attempt_id for update of d`, [tenantId, planInstanceId]);
      if (!attempts.rowCount || attempts.rows.some((attempt) => attempt.status !== 'outcome_unknown'
        || !['provider-openai', 'provider-deepseek'].includes(attempt.profile_kind) || !attempt.read_only_model_proposal)) {
        throw conflict('This disposition is available only when every unresolved attempt is an outcome-unknown read-only model proposal.', Number(control.version), 'PROCESS_INSTANCE_ABANDONMENT_NOT_ALLOWED');
      }
      const runIds = [...new Set(attempts.rows.map((attempt) => attempt.run_id))].sort();
      const attemptIds = attempts.rows.map((attempt) => attempt.attempt_id).sort();
      const next = await appendProcessTaskControl(client, control, {
        status: 'ABANDONED_UNVERIFIED', reason: safeReason, boundary: control.pause_boundary,
        actor: principal, commandId, eventType: 'ProcessTaskInstanceAbandonedUnverified',
        eventData: { runIds, attemptIds, evidence: safeEvidence, acknowledgeDuplicateCostWork: true,
          authzGeneration: Number(authzGeneration) },
      });
      const result = { projectId, planInstanceId, status: next.status, version: Number(next.version),
        runIds, attemptIds, reason: safeReason, evidence: safeEvidence, acknowledgeDuplicateCostWork: true };
      await client.query(`insert into orgward.command_results (tenant_id,operation,command_id,payload_hash,aggregate_kind,aggregate_id,result,result_hash)
        values ($1,$2,$3,$4,'process_task_instance_control',$5,$6::jsonb,$7)`,
      [tenantId, operation, commandId, requestHash, planInstanceId, canonicalJson(result), contentHash(result)]);
      return { control: next, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async cancelProcessTaskInstance({ tenantId, projectId, planInstanceId, principal, authzGeneration,
    version, commandId, requestHash, reason }) {
    const operation = 'execution.process-instance.cancel';
    const safeReason = typeof reason === 'string' ? reason.trim() : '';
    if (!tenantId || !projectId || !planInstanceId || !principal || !commandId || !requestHash
      || !safeReason || safeReason.length > 1000) {
      throw conflict('Cancellation requires a short reason of up to 1000 characters.', null, 'INVALID_PROCESS_INSTANCE_CANCELLATION');
    }
    const outcome = await this.persistence.transaction(async (client) => {
      const membership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human' });
      const projectRow = await client.query(`select aggregate_id from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, [tenantId, projectId]);
      if (!projectRow.rowCount) return null;
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3`, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This command ID was already used with different cancellation input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.planInstanceId !== planInstanceId || recorded.projectId !== projectId) throw persistenceIntegrity('A cancellation replay has mismatched instance references.');
        const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
        const controlEvent = control?.events?.find((event) => event.causationId === commandId
          && event.type === 'ProcessTaskInstanceCancelled' && event.actor === principal);
        const runIds = recorded.runIds;
        if (!control || control.project_id !== projectId || control.status !== 'CANCELLED'
          || !Array.isArray(runIds) || runIds.some((id, index) => typeof id !== 'string' || (index > 0 && runIds[index - 1] >= id))
          || !controlEvent || canonicalJson(controlEvent.data?.runIds) !== canonicalJson(runIds)) {
          throw persistenceIntegrity('A cancellation replay no longer matches its append-only event and linked runs.');
        }
        const replayedRunIds = [];
        for (const runId of runIds) {
          const selected = await client.query(`select * from orgward.aggregates
            where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for share`, [tenantId, runId]);
          if (!selected.rowCount) throw persistenceIntegrity('A cancelled linked run is missing during instance replay.');
          const run = verifyAggregateRow(selected.rows[0]);
          const event = run.events?.find((entry) => entry.type === 'ExecutionCancelledByProcessInstanceController'
            && entry.causationId === commandId && entry.actor === principal
            && entry.data?.planInstanceId === planInstanceId && entry.data?.processTaskRef?.planInstanceId === planInstanceId);
          if (run.projectId !== projectId || run.status !== 'CANCELLED' || !event) {
            throw persistenceIntegrity('A cancelled linked run no longer matches the instance cancellation command.');
          }
          replayedRunIds.push(runId);
        }
        if (control.initiated_by !== principal && membership.access !== 'owner') throw projectAccessDenied();
        return { control, runIds: replayedRunIds, replayed: true };
      }
      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) return null;
      if (Number(control.version) !== version) throw conflict('The process instance control changed; reload before retrying.', Number(control.version), 'PROCESS_INSTANCE_CONTROL_CONFLICT');
      if (control.initiated_by !== principal && membership.access !== 'owner') throw projectAccessDenied();
      if (control.status !== 'PAUSED') throw conflict('Only a fully paused process instance can be cancelled.', Number(control.version), 'PROCESS_INSTANCE_NOT_PAUSED');
      const runtimes = await client.query(`select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and plan_instance_id=$3 order by task_id for update`, [tenantId, projectId, planInstanceId]);
      if (!runtimes.rowCount) throw conflict('The process instance was not found.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      await loadProcessInstancePlan(client, { tenantId, projectId, control, runtimes: runtimes.rows });
      if (runtimes.rows.some((runtime) => ['IN_PROGRESS', 'ESCALATED', 'RUNNING'].includes(runtime.status))) {
        throw conflict('Active human or agent work must settle before this process instance can be cancelled.', Number(control.version), 'PROCESS_INSTANCE_WORK_UNRESOLVED');
      }
      const runIds = [...new Set(runtimes.rows.map((runtime) => runtime.execution_run_id).filter(Boolean))].sort();
      const runsById = new Map();
      for (const runId of runIds) {
        const selected = await client.query(`select * from orgward.aggregates
          where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for update`, [tenantId, runId]);
        if (!selected.rowCount) throw persistenceIntegrity('A linked process task run is missing during instance cancellation.');
        const run = verifyAggregateRow(selected.rows[0]);
        const runtime = runtimes.rows.find((candidate) => candidate.execution_run_id === runId);
        runsById.set(runId, run);
      }
      const attempts = await client.query(`select d.run_id,d.attempt_id,d.status from orgward.provider_dispatch_attempts d
        where d.tenant_id=$1 and d.run_id=any($2::text[]) order by d.run_id,d.attempt_id for update`, [tenantId, runIds]);
      const leases = await client.query(`select l.run_id from orgward.execution_worker_leases l
        where l.tenant_id=$1 and l.run_id=any($2::text[]) and l.lease_until>now() order by l.run_id,l.worker_id for update`, [tenantId, runIds]);
      if (leases.rowCount || attempts.rows.some((attempt) => ['reserved', 'handed_off', 'outcome_unknown'].includes(attempt.status))) {
        throw conflict('Worker leases and unresolved provider requests must settle before cancellation.', Number(control.version), 'PROCESS_INSTANCE_WORK_UNRESOLVED');
      }
      const cancelledRunIds = [];
      for (const runId of runIds) {
        const run = runsById.get(runId);
        if (['AWAITING_APPROVAL', 'APPROVED', 'PAUSED'].includes(run.status)) {
          cancelProcessTaskExecutionRunByInstance(run, { principal, commandId, planInstanceId });
          await this.saveInTransaction(client, run, { expectedVersion: Number(run.version) - 1,
            principal, requiredPrincipalRoles: ['workspace-write'], authzGeneration,
            instanceControlMutation: true, runtimeCommandId: commandId });
          cancelledRunIds.push(runId);
        } else if (['RUNNING'].includes(run.status)) {
          throw conflict('Running linked work must settle before cancellation.', Number(control.version), 'PROCESS_INSTANCE_WORK_UNRESOLVED');
        }
      }
      const next = await appendProcessTaskControl(client, control, {
        status: 'CANCELLED', reason: safeReason, boundary: control.pause_boundary,
        actor: principal, commandId, eventType: 'ProcessTaskInstanceCancelled',
        eventData: { authzGeneration: Number(authzGeneration), runIds: cancelledRunIds },
      });
      const result = { projectId, planInstanceId, status: next.status, version: Number(next.version), reason: safeReason,
        runIds: cancelledRunIds };
      await client.query(`insert into orgward.command_results (tenant_id,operation,command_id,payload_hash,aggregate_kind,aggregate_id,result,result_hash)
        values ($1,$2,$3,$4,'process_task_instance_control',$5,$6::jsonb,$7)`,
      [tenantId, operation, commandId, requestHash, planInstanceId, canonicalJson(result), contentHash(result)]);
      return { control: next, runIds: cancelledRunIds, replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async pauseUndispatchedProcessTaskRun({ tenantId, projectId, runId, principal, authzGeneration, workerId, expectedVersion }) {
    return this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, { tenantId, principal, roles: ['workspace-write'], authzGeneration });
      const hint = await client.query(`select state->'processTaskRef' as ref from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, runId]);
      const instanceId = hint.rows[0]?.ref?.planInstanceId;
      if (!instanceId) return null;
      const control = await lockProcessTaskControl(client, tenantId, instanceId);
      if (!control || control.project_id !== projectId || control.status !== 'PAUSE_REQUESTED') return null;
      const selected = await client.query(`select * from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 for update`, [tenantId, runId]);
      if (!selected.rowCount) return null;
      const run = verifyAggregateRow(selected.rows[0]);
      if (run.status !== 'RUNNING' || run.version !== expectedVersion || run.projectId !== projectId) return null;
      const attempt = await client.query(`select status from orgward.provider_dispatch_attempts
        where tenant_id=$1 and run_id=$2 for update`, [tenantId, runId]);
      if (attempt.rows.some((row) => row.status !== 'cancelled')) return null;
      const lease = await client.query(`select worker_id from orgward.execution_worker_leases
        where tenant_id=$1 and run_id=$2 and lease_until>now() for update`, [tenantId, runId]);
      if (lease.rows.some((row) => row.worker_id !== workerId)) return null;
      const pauseEvent = (control.events ?? []).findLast?.((event) => event.type === 'ProcessTaskInstancePauseRequested');
      if (!pauseEvent?.causationId) throw persistenceIntegrity('A paused run has no instance pause command to bind its boundary event.');
      pauseUndispatchedProcessTaskExecutionRun(run, { actor: principal, commandId: pauseEvent.causationId });
      await this.saveInTransaction(client, run, { expectedVersion, workerFinalization: true,
        instanceControlMutation: true, runtimeCommandId: pauseEvent.causationId });
      return run;
    });
  }

  async startHumanProcessTask({
    tenantId, projectId, planId, revision, planInstanceId, taskId,
    principal, authzGeneration, commandId, requestHash,
  }) {
    if (!tenantId || !projectId || !planId || !taskId || !principal) throw projectAccessDenied();
    const operation = 'execution.process-task.human-start';
    const outcome = await this.persistence.transaction(async (client) => {
      const callerMembership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human',
      });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This human task command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.projectId !== projectId || recorded.planId !== planId || recorded.revision !== revision
          || (planInstanceId && recorded.planInstanceId !== planInstanceId) || recorded.taskId !== taskId) {
          throw persistenceIntegrity('A human task start command result has mismatched task references.');
        }
        const replay = await selectProcessTaskRuntimeForPrincipal(client, {
          tenantId, projectId, planInstanceId: recorded.planInstanceId, taskId, principal, authzGeneration,
        });
        if (!replay.rowCount) throw persistenceIntegrity('A human task start command has no assigned runtime record.');
        return { runtime: processTaskRuntimeView(replay.rows[0], principal), replayed: true };
      }

      const selectedProject = await client.query(`
        select * from orgward.aggregates
        where tenant_id = $1 and aggregate_kind = 'project' and aggregate_id = $2
        for update
      `, [tenantId, projectId]);
      if (!selectedProject.rowCount) return null;
      const project = verifyAggregateRow(selectedProject.rows[0]);
      const plan = await resolveRuntimeProcessPlan(client, { tenantId, projectId, project, planId, revision });
      if (!plan || plan.source?.projectId !== projectId) throw conflict('The saved process graph revision was not found for this project.', null, 'PROCESS_PLAN_REVISION_NOT_FOUND');
      if (plan.kind === 'software_delivery_runtime_plan' && !planInstanceId) throw conflict('Start the owner-promoted human checkpoint instance before starting a task.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      const task = plan.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw conflict('The task was not found in this saved graph revision.', null, 'PROCESS_PLAN_TASK_NOT_FOUND');
      if (!Array.isArray(task.dependencies)) throw persistenceIntegrity('A saved process task has invalid dependencies.');
      let instanceId = planInstanceId;
      if (!instanceId) {
        if (task.dependencies.length) throw conflict('A dependent human task must join an existing process instance.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
        const latestRevision = (project.processPlans ?? []).filter((candidate) => candidate.id === planId)
          .sort((left, right) => (left.revision ?? 1) - (right.revision ?? 1)).at(-1);
        if (latestRevision?.revision !== revision) throw conflict('A new process instance must start from the latest saved graph revision.', null, 'PROCESS_PLAN_REVISION_STALE');
        if (!processPlanUsesCurrentOrViewOnlyBlueprint(project, plan)) {
          throw conflict('A new process instance must use the current saved blueprint version.', null, 'PROCESS_PLAN_BLUEPRINT_STALE');
        }
        instanceId = randomUUID();
      }
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${tenantId}:process-plan-instance:${instanceId}`,
      ]);
      let control = await lockProcessTaskControl(client, tenantId, instanceId);
      const instanceRows = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id = $1 and plan_instance_id = $2
        order by task_id for update
      `, [tenantId, instanceId]);
      if (planInstanceId && !instanceRows.rowCount) throw conflict('Start a root task before this task joins a process instance.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      if (!planInstanceId && instanceRows.rowCount) throw persistenceIntegrity('The generated human task instance ID already exists.');
      if (instanceRows.rowCount) {
        if (!control) throw persistenceIntegrity('An existing process instance has no durable control record.');
        requireActiveProcessTaskControl(control);
      } else {
        await client.query(`insert into orgward.process_task_instance_controls
          (tenant_id,project_id,process_plan_id,plan_revision,plan_instance_id,status,initiated_by,version,events)
          values ($1,$2,$3,$4,$5,'ACTIVE',$6,0,'[]'::jsonb)`,
        [tenantId, projectId, planId, revision, instanceId, principal]);
      }
      if (instanceRows.rows.some((row) => row.project_id !== projectId || row.process_plan_id !== planId
        || Number(row.plan_revision) !== revision || row.blueprint_id !== plan.source.blueprintId
        || Number(row.blueprint_version) !== plan.source.blueprintVersion)) {
        throw conflict('This instance is pinned to a different immutable graph revision.', null, 'PROCESS_TASK_INSTANCE_PIN_CONFLICT');
      }
      const flowActivation = plan.kind === 'manual_process_flow_plan' ? await requireManualFlowTaskReady(client, plan, taskId, instanceRows.rows, control, instanceId) : null;
      const byTask = new Map(instanceRows.rows.map((row) => [row.task_id, row]));
      for (const dependencyId of task.dependencies) {
        if (byTask.get(dependencyId)?.status !== 'SUCCEEDED') {
          throw conflict('Every dependency must be succeeded in this process instance before the human task can start.', null, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');
        }
      }
      const blueprint = project.blueprintVersions?.find((candidate) => candidate.id === plan.source.blueprintId
        && candidate.version === plan.source.blueprintVersion);
      const objects = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
      const actor = objects.find((item) => item.id === task.assignee?.actorId);
      const role = objects.find((item) => item.id === task.assignee?.roleId);
      const linkedRole = actor && role?.type === 'role'
        && ((actor.assignedRoles ?? []).includes(role.id)
          || (blueprint.relations ?? []).some((relation) => relation.source === actor.id
            && relation.target === role.id && relation.type === 'assigned-to'));
      if (!blueprint || actor?.type !== 'actor-human' || !role || !linkedRole) {
        throw conflict('The saved task must reference a human actor and its assigned blueprint role.', null, 'PROCESS_TASK_HUMAN_ASSIGNMENT_REQUIRED');
      }
      let runtime = byTask.get(taskId);
      if (runtime && (runtime.actor_type !== 'human' || runtime.actor_id !== actor.id || runtime.role_id !== role.id)) {
        throw conflict('The task runtime is not pinned to this human assignment.', null, 'PROCESS_TASK_ASSIGNMENT_CONFLICT');
      }
      if (!runtime) {
        const binding = await client.query(`
          select b.status, b.target_principal, b.target_membership_generation, b.target_authz_generation,
            identity.actor_type, identity.status as identity_status,
            identity.authz_generation as current_authz_generation,
            membership.access, membership.generation as current_membership_generation, membership.revoked_at
          from orgward.project_actor_binding_proposals b
          join orgward.oidc_principals identity
            on identity.tenant_id = b.tenant_id and identity.principal = b.target_principal
          join orgward.project_memberships membership
            on membership.tenant_id = b.tenant_id and membership.project_id = b.project_id
              and membership.principal = b.target_principal
          where b.tenant_id = $1 and b.project_id = $2 and b.blueprint_version = $3
            and b.actor_id = $4 and b.role_id = $5
          for update of b, identity, membership
        `, [tenantId, projectId, plan.source.blueprintVersion, actor.id, role.id]);
        if (!binding.rowCount || binding.rows[0].status !== 'enabled') {
          throw conflict('This human task requires an enabled binding for its pinned blueprint version.', null, 'PROCESS_TASK_ACTOR_BINDING_UNAVAILABLE');
        }
        const target = binding.rows[0];
        if (target.target_principal !== principal || target.actor_type !== 'human' || target.identity_status !== 'active'
          || target.revoked_at !== null || !['owner', 'editor'].includes(target.access)) throw projectAccessDenied();
        if (Number(target.target_authz_generation) !== Number(target.current_authz_generation)
          || Number(target.current_authz_generation) !== authzGeneration
          || Number(target.target_membership_generation) !== Number(target.current_membership_generation)
          || Number(target.current_membership_generation) !== callerMembership.generation) {
          throw conflict('The assigned human or project membership changed after binding approval.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
        }
        await client.query(`
          insert into orgward.process_task_instances (
            tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id, task_id,
            blueprint_id, blueprint_version, process_id, actor_id, role_id, actor_type,
            assigned_principal, assigned_membership_generation, assigned_authz_generation,
            status, version, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'human',$12,$13,$14,'PLANNED',0,now(),now())
        `, [tenantId, projectId, plan.id, revision, instanceId, task.id, plan.source.blueprintId,
          plan.source.blueprintVersion, plan.source.processId, actor.id, role.id, principal,
          Number(target.current_membership_generation), Number(target.current_authz_generation)]);
        const inserted = await client.query(`
          select * from orgward.process_task_instances where tenant_id=$1 and plan_instance_id=$2 and task_id=$3 for update
        `, [tenantId, instanceId, taskId]);
        runtime = inserted.rows[0];
      } else {
        const assignee = effectiveHumanAssignee(runtime);
        if (assignee.principal !== principal
          || assignee.authzGeneration !== authzGeneration
          || assignee.membershipGeneration !== callerMembership.generation) {
          throw conflict('The human assignment or membership changed after this task runtime was created.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
        }
      }
      if (runtime.status !== 'PLANNED') throw conflict('The human task must be planned before its assigned person can start it.', Number(runtime.version), 'PROCESS_TASK_STATE_CONFLICT');
      const event = processTaskRuntimeEvent('HumanTaskStarted', principal, { taskId, processPlanId: planId, revision, planInstanceId: instanceId,
        ...(flowActivation ? { activationIdentity: flowActivation.identity, snapshotHash: plan.snapshotHash, flowHash: plan.flow.definitionHash } : {}) });
      const updated = await client.query(`
        update orgward.process_task_instances
        set status='IN_PROGRESS', version=version+1, started_at=now(), updated_at=now(), events=events || $5::jsonb
        where tenant_id=$1 and plan_instance_id=$2 and task_id=$3 and version=$4
        returning *
      `, [tenantId, instanceId, taskId, Number(runtime.version), canonicalJson([event])]);
      if (!updated.rowCount) throw conflict('The human task changed before it could be started.', Number(runtime.version));
      await recordEvent(client, {
        tenantId, kind: 'process_task_instance', id: `${instanceId}:${taskId}`,
        version: Number(updated.rows[0].version), commandId, event,
      });
      const result = { projectId, planId, revision, planInstanceId: instanceId, taskId, version: Number(updated.rows[0].version) };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1,$2,$3,$4,'process_task_instance',$5,$6::jsonb,$7)
      `, [tenantId, operation, commandId, requestHash, `${instanceId}:${taskId}`, canonicalJson(result), contentHash(result)]);
      const visible = await selectProcessTaskRuntimeForPrincipal(client, {
        tenantId, projectId, planInstanceId: instanceId, taskId, principal, authzGeneration,
      });
      return { runtime: processTaskRuntimeView(visible.rows[0], principal), replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async completeHumanProcessTask({
    tenantId, projectId, planId, revision, planInstanceId, taskId,
    principal, authzGeneration, commandId, requestHash, result, evidence, decisionChoice, outputs, expectedVersion,
  }) {
    if (!tenantId || !projectId || !planId || !planInstanceId || !taskId || !principal) throw projectAccessDenied();
    if (!['succeeded', 'failed'].includes(result)) {
      throw conflict('Choose a succeeded or failed outcome and provide up to 20 short evidence notes.', null, 'INVALID_HUMAN_TASK_OUTCOME');
    }
    if ((outputs !== undefined || expectedVersion !== undefined)
      && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
      throw conflict('Completion requires the current task version.', null, 'PROCESS_TASK_VERSION_REQUIRED');
    }
    const safeEvidence = validateHumanTaskNotes(evidence, { required: result === 'succeeded' });
    const operation = 'execution.process-task.human-complete';
    const outcome = await this.persistence.transaction(async (client) => {
      const callerMembership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human',
      });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`
        select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3
      `, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This human task command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.projectId !== projectId || recorded.planId !== planId || recorded.revision !== revision
          || recorded.planInstanceId !== planInstanceId || recorded.taskId !== taskId) {
          throw persistenceIntegrity('A human task completion command result has mismatched task references.');
        }
        const replay = await selectProcessTaskRuntimeForPrincipal(client, {
          tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
        });
        if (!replay.rowCount) throw persistenceIntegrity('A human task completion command has no assigned runtime record.');
        return { runtime: processTaskRuntimeView(replay.rows[0], principal), replayed: true };
      }
      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) throw persistenceIntegrity('A human task has no matching process instance control.');
      requireProcessTaskControlNotAbandoned(control);
      if (control.status === 'PAUSED') throw conflict('The process instance is paused; an active human task cannot settle after its boundary.', null, 'PROCESS_INSTANCE_PAUSED');
      const selected = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and process_plan_id=$3 and plan_revision=$4
          and plan_instance_id=$5 and task_id=$6
        for update
      `, [tenantId, projectId, planId, revision, planInstanceId, taskId]);
      if (!selected.rowCount) throw conflict('The human task runtime was not found in this project instance.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      const runtime = selected.rows[0];
      const { plan: completedPlan, task: completedTask } = await verifyProcessRuntimeTaskDefinition(client, { tenantId, projectId, planId, revision, taskId, runtime });
      if (completedPlan.kind === 'manual_process_flow_plan') await verifyManualFlowControl(client, completedPlan, control, planInstanceId);
      const savedChoice = normalizeHumanDecisionChoice(completedTask, decisionChoice, result);
      const assignee = effectiveHumanAssignee(runtime);
      if (runtime.actor_type !== 'human' || assignee.principal !== principal) throw projectAccessDenied();
      if (assignee.authzGeneration !== authzGeneration
        || assignee.membershipGeneration !== callerMembership.generation) {
        throw conflict('The human assignment or membership changed after this task runtime was created.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
      }
      if (runtime.status === 'ESCALATED') {
        throw conflict('An escalated human task requires project owner resolution before it can be completed.', Number(runtime.version), 'PROCESS_TASK_ESCALATION_ACTIVE');
      }
      if (runtime.status !== 'IN_PROGRESS') throw conflict('Only an in-progress human task can be completed.', Number(runtime.version), 'PROCESS_TASK_STATE_CONFLICT');
      if (expectedVersion !== undefined && Number(runtime.version) !== expectedVersion) {
        throw conflict('The human task changed before completion. Refresh it and try again.', Number(runtime.version), 'PROCESS_TASK_VERSION_CONFLICT');
      }
      const outputRecords = await normalizeHumanTaskOutputRecords(client, {
        tenantId, projectId, plan: completedPlan, task: completedTask, runtime, principal, outputs, result,
      });
      const taskOutcome = { result, outputSchemaVersion: 1, outputRecords,
        ...(savedChoice ? { decisionChoice: savedChoice } : {}) };
      const event = processTaskRuntimeEvent('HumanTaskCompleted', principal, {
        taskId, processPlanId: planId, revision, planInstanceId, expectedVersion, result, evidence: safeEvidence,
        outputSchemaVersion: 1, outputRecords, ...(savedChoice ? { decisionChoice: savedChoice } : {}),
        ...(completedPlan.kind === 'manual_process_flow_plan' ? { snapshotHash: completedPlan.snapshotHash, flowHash: completedPlan.flow.definitionHash } : {}),
      });
      const status = result === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
      const updated = await client.query(`
        update orgward.process_task_instances
        set status=$5, outcome=$6::jsonb, evidence=$7::jsonb, version=version+1,
          completed_at=now(), updated_at=now(), events=events || $8::jsonb
        where tenant_id=$1 and plan_instance_id=$2 and task_id=$3 and version=$4
        returning *
      `, [tenantId, planInstanceId, taskId, Number(runtime.version), status,
        canonicalJson(taskOutcome), canonicalJson(safeEvidence), canonicalJson([event])]);
      if (!updated.rowCount) throw conflict('The human task changed before it could be completed.', Number(runtime.version));
      await recordEvent(client, {
        tenantId, kind: 'process_task_instance', id: `${planInstanceId}:${taskId}`,
        version: Number(updated.rows[0].version), commandId, event,
      });
      await settleProcessTaskPauseIfDrained(client, tenantId, planInstanceId);
      const commandResult = { projectId, planId, revision, planInstanceId, taskId, version: Number(updated.rows[0].version), status };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1,$2,$3,$4,'process_task_instance',$5,$6::jsonb,$7)
      `, [tenantId, operation, commandId, requestHash, `${planInstanceId}:${taskId}`, canonicalJson(commandResult), contentHash(commandResult)]);
      const visible = await selectProcessTaskRuntimeForPrincipal(client, {
        tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
      });
      return { runtime: processTaskRuntimeView(visible.rows[0], principal), replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async escalateHumanProcessTask({
    tenantId, projectId, planId, revision, planInstanceId, taskId,
    principal, authzGeneration, commandId, requestHash, reason, evidence = [],
  }) {
    if (!tenantId || !projectId || !planId || !planInstanceId || !taskId || !principal) throw projectAccessDenied();
    const safeReason = validateHumanTaskReason(reason);
    const safeEvidence = validateHumanTaskNotes(evidence ?? []);
    const operation = 'execution.process-task.human-escalate';
    const outcome = await this.persistence.transaction(async (client) => {
      const callerMembership = await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human',
      });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`
        select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3
      `, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This human task command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.projectId !== projectId || recorded.planId !== planId || recorded.revision !== revision
          || recorded.planInstanceId !== planInstanceId || recorded.taskId !== taskId) {
          throw persistenceIntegrity('A human task escalation command result has mismatched task references.');
        }
        const replay = await selectProcessTaskRuntimeForPrincipal(client, {
          tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
        });
        if (!replay.rowCount) throw persistenceIntegrity('A human task escalation command has no runtime record.');
        return { runtime: processTaskRuntimeView(replay.rows[0], principal), replayed: true };
      }

      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) throw persistenceIntegrity('A human task has no matching process instance control.');
      requireProcessTaskControlNotAbandoned(control);
      if (control.status === 'PAUSED') throw conflict('The process instance is paused; a late human escalation cannot change its boundary.', null, 'PROCESS_INSTANCE_PAUSED');

      const selected = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and process_plan_id=$3 and plan_revision=$4
          and plan_instance_id=$5 and task_id=$6
        for update
      `, [tenantId, projectId, planId, revision, planInstanceId, taskId]);
      if (!selected.rowCount) throw conflict('The human task runtime was not found in this project instance.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      const runtime = selected.rows[0];
      await verifyProcessRuntimeTaskDefinition(client, { tenantId, projectId, planId, revision, taskId, runtime });
      const assignee = effectiveHumanAssignee(runtime);
      if (runtime.actor_type !== 'human' || assignee.principal !== principal) throw projectAccessDenied();
      if (assignee.authzGeneration !== authzGeneration
        || assignee.membershipGeneration !== callerMembership.generation) {
        throw conflict('The human assignment or membership changed after this task runtime was created.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
      }
      if (runtime.status !== 'IN_PROGRESS') throw conflict('Only an in-progress human task can be escalated.', Number(runtime.version), 'PROCESS_TASK_STATE_CONFLICT');

      const event = processTaskRuntimeEvent('HumanTaskEscalated', principal, {
        taskId, processPlanId: planId, revision, planInstanceId, reason: safeReason, evidence: safeEvidence,
      });
      const updated = await client.query(`
        update orgward.process_task_instances
        set status='ESCALATED', version=version+1, updated_at=now(), events=events || $5::jsonb
        where tenant_id=$1 and plan_instance_id=$2 and task_id=$3 and version=$4
        returning *
      `, [tenantId, planInstanceId, taskId, Number(runtime.version), canonicalJson([event])]);
      if (!updated.rowCount) throw conflict('The human task changed before it could be escalated.', Number(runtime.version));
      await recordEvent(client, {
        tenantId, kind: 'process_task_instance', id: `${planInstanceId}:${taskId}`,
        version: Number(updated.rows[0].version), commandId, event,
      });
      const result = { projectId, planId, revision, planInstanceId, taskId, version: Number(updated.rows[0].version), status: 'ESCALATED' };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1,$2,$3,$4,'process_task_instance',$5,$6::jsonb,$7)
      `, [tenantId, operation, commandId, requestHash, `${planInstanceId}:${taskId}`, canonicalJson(result), contentHash(result)]);
      const visible = await selectProcessTaskRuntimeForPrincipal(client, {
        tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
      });
      return { runtime: processTaskRuntimeView(visible.rows[0], principal), replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async resolveHumanProcessTaskEscalation({
    tenantId, projectId, planId, revision, planInstanceId, taskId,
    principal, authzGeneration, commandId, requestHash, disposition, reason, evidence = [], targetPrincipal = null, expectedVersion = null,
  }) {
    if (!tenantId || !projectId || !planId || !planInstanceId || !taskId || !principal) throw projectAccessDenied();
    if (!['resume', 'reassign', 'succeeded', 'failed'].includes(disposition)
      || (disposition === 'reassign') !== (typeof targetPrincipal === 'string' && /^oidc:[a-f0-9]{64}$/i.test(targetPrincipal))
      || (disposition === 'reassign') !== (Number.isSafeInteger(expectedVersion) && expectedVersion > 0)) {
      throw conflict('Choose resume, reassign, succeeded, or failed and provide an assignee only for reassignment.', null, 'INVALID_HUMAN_TASK_ESCALATION');
    }
    const safeReason = validateHumanTaskReason(reason);
    const safeEvidence = validateHumanTaskNotes(evidence ?? [], { required: disposition === 'succeeded' || disposition === 'reassign' });
    const operation = 'execution.process-task.human-escalation-resolve';
    const outcome = await this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'owner' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration, actorType: 'human',
      });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`
        select * from orgward.command_results where tenant_id=$1 and operation=$2 and command_id=$3
      `, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== requestHash) throw conflict('This owner resolution command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        const recorded = verifyCommandRow(prior.rows[0]);
        if (recorded.projectId !== projectId || recorded.planId !== planId || recorded.revision !== revision
          || recorded.planInstanceId !== planInstanceId || recorded.taskId !== taskId) {
          throw persistenceIntegrity('A human task resolution command result has mismatched task references.');
        }
        const replay = await selectProcessTaskRuntimeForPrincipal(client, {
          tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
        });
        if (!replay.rowCount) throw persistenceIntegrity('A human task resolution command has no runtime record.');
        return { runtime: processTaskRuntimeView(replay.rows[0], principal), replayed: true };
      }

      const control = await lockProcessTaskControl(client, tenantId, planInstanceId);
      if (!control || control.project_id !== projectId) throw persistenceIntegrity('A human task has no matching process instance control.');
      requireProcessTaskControlNotAbandoned(control);
      if (control.status === 'PAUSED') throw conflict('The process instance is paused; a late human resolution cannot change its boundary.', null, 'PROCESS_INSTANCE_PAUSED');
      if (disposition === 'resume' || disposition === 'reassign') requireActiveProcessTaskControl(control);
      if (control.status === 'PAUSED' && disposition === 'resume') throw conflict('The process instance is paused; human work cannot resume until the instance resumes.', null, 'PROCESS_INSTANCE_PAUSED');

      const selected = await client.query(`
        select * from orgward.process_task_instances
        where tenant_id=$1 and project_id=$2 and process_plan_id=$3 and plan_revision=$4
          and plan_instance_id=$5 and task_id=$6
        for update
      `, [tenantId, projectId, planId, revision, planInstanceId, taskId]);
      if (!selected.rowCount) throw conflict('The human task runtime was not found in this project instance.', null, 'PROCESS_TASK_INSTANCE_NOT_FOUND');
      const runtime = selected.rows[0];
      if (disposition === 'reassign' && Number(runtime.version) !== expectedVersion) {
        throw conflict('This human task changed before reassignment. Refresh the current task and try again.', Number(runtime.version), 'PROCESS_TASK_STATE_CONFLICT');
      }
      const { plan: immutablePlan, task: immutableTask } = await verifyProcessRuntimeTaskDefinition(client, { tenantId, projectId, planId, revision, taskId, runtime });
      if (!immutableTask) throw persistenceIntegrity('The escalated human task is missing from its immutable plan snapshot.');
      if (immutablePlan.kind === 'manual_process_flow_plan') await verifyManualFlowControl(client, immutablePlan, control, planInstanceId);
      if (runtime.actor_type !== 'human') throw conflict('Only a human task can be resolved through this path.', null, 'PROCESS_TASK_ASSIGNMENT_CONFLICT');
      if (runtime.status !== 'ESCALATED') throw conflict('Only an escalated human task can be resolved by its project owner.', Number(runtime.version), 'PROCESS_TASK_STATE_CONFLICT');

      if (disposition === 'resume') {
        const currentAssignee = effectiveHumanAssignee(runtime);
        if (runtime.effective_assigned_principal) {
          const identity = await client.query(`
            select status, actor_type, roles, authz_generation
            from orgward.oidc_principals
            where tenant_id=$1 and principal=$2
            for update
          `, [tenantId, currentAssignee.principal]);
          const membership = await client.query(`
            select access, generation, revoked_at
            from orgward.project_memberships
            where tenant_id=$1 and project_id=$2 and principal=$3
            for update
          `, [tenantId, projectId, currentAssignee.principal]);
          if (!identity.rowCount || !membership.rowCount
            || identity.rows[0].status !== 'active' || identity.rows[0].actor_type !== 'human'
            || !identity.rows[0].roles.includes('workspace-write')
            || membership.rows[0].revoked_at !== null
            || !['owner', 'editor'].includes(membership.rows[0].access)
            || Number(identity.rows[0].authz_generation) !== currentAssignee.authzGeneration
            || Number(membership.rows[0].generation) !== currentAssignee.membershipGeneration) {
            throw conflict('The effective assignee identity, membership, or saved authority generations changed; reassign this task or update the saved plan.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
          }
        } else {
          const binding = await client.query(`
            select b.status, b.target_principal, b.target_membership_generation, b.target_authz_generation,
              identity.actor_type, identity.status as identity_status,
              identity.authz_generation as current_authz_generation,
              membership.access, membership.generation as current_membership_generation, membership.revoked_at
            from orgward.project_actor_binding_proposals b
            join orgward.oidc_principals identity
              on identity.tenant_id=b.tenant_id and identity.principal=b.target_principal
            join orgward.project_memberships membership
              on membership.tenant_id=b.tenant_id and membership.project_id=b.project_id
                and membership.principal=b.target_principal
            where b.tenant_id=$1 and b.project_id=$2 and b.blueprint_version=$3
              and b.actor_id=$4 and b.role_id=$5 and b.target_principal=$6
            for update of b, identity, membership
          `, [tenantId, projectId, runtime.blueprint_version, runtime.actor_id, runtime.role_id, currentAssignee.principal]);
          if (!binding.rowCount) throw conflict('The current assignee no longer has a current enabled human binding; reassign this task or update the saved plan.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
          const target = binding.rows[0];
          if (target.status !== 'enabled' || target.actor_type !== 'human' || target.identity_status !== 'active'
            || target.revoked_at !== null || !['owner', 'editor'].includes(target.access)
            || Number(target.target_authz_generation) !== Number(target.current_authz_generation)
            || Number(target.target_membership_generation) !== Number(target.current_membership_generation)
            || Number(target.current_authz_generation) !== currentAssignee.authzGeneration
            || Number(target.current_membership_generation) !== currentAssignee.membershipGeneration) {
            throw conflict('The current assignee identity, membership, generations, or pinned enabled binding changed; reassign this task or update the saved plan.', null, 'PROCESS_TASK_ACTOR_BINDING_STALE');
          }
        }
      }

      let effectiveAssignmentUpdate = null;
      let reassignmentEventData = null;
      if (disposition === 'reassign') {
        const currentAssignee = effectiveHumanAssignee(runtime);
        if (targetPrincipal === currentAssignee.principal) {
          throw conflict('Choose a different active human for reassignment.', Number(runtime.version), 'PROCESS_TASK_ASSIGNMENT_CONFLICT');
        }
        if (immutableTask.assignee?.kind !== 'blueprint-actor'
          || immutableTask.assignee.actorId !== runtime.actor_id || immutableTask.assignee.roleId !== runtime.role_id
          || !runtime.blueprint_id || !Number.isSafeInteger(Number(runtime.blueprint_version))) {
          throw persistenceIntegrity('The escalated human assignment does not match its immutable actor and role snapshot.');
        }
        const targetIdentity = await client.query(`
          select status, actor_type, roles, authz_generation
          from orgward.oidc_principals
          where tenant_id=$1 and principal=$2
          for update
        `, [tenantId, targetPrincipal]);
        const targetMembership = await client.query(`
          select access, generation, revoked_at
          from orgward.project_memberships
          where tenant_id=$1 and project_id=$2 and principal=$3
          for update
        `, [tenantId, projectId, targetPrincipal]);
        if (!targetIdentity.rowCount || !targetMembership.rowCount
          || targetIdentity.rows[0].status !== 'active' || targetIdentity.rows[0].actor_type !== 'human'
          || !targetIdentity.rows[0].roles.includes('workspace-write')
          || targetMembership.rows[0].revoked_at !== null
          || !['owner', 'editor'].includes(targetMembership.rows[0].access)) {
          throw conflict('Choose an active human with workspace write access and an active editor or owner membership in this project.', null, 'PROCESS_TASK_REASSIGNEE_UNAVAILABLE');
        }
        const targetAuthzGeneration = Number(targetIdentity.rows[0].authz_generation);
        const targetMembershipGeneration = Number(targetMembership.rows[0].generation);
        if (!Number.isSafeInteger(targetAuthzGeneration) || targetAuthzGeneration < 1
          || !Number.isSafeInteger(targetMembershipGeneration) || targetMembershipGeneration < 1) {
          throw persistenceIntegrity('The reassignee has invalid current authority generations.');
        }
        effectiveAssignmentUpdate = {
          principal: targetPrincipal,
          membershipGeneration: targetMembershipGeneration,
          authzGeneration: targetAuthzGeneration,
        };
        reassignmentEventData = {
          fromPrincipal: currentAssignee.principal,
          fromMembershipGeneration: currentAssignee.membershipGeneration,
          fromAuthzGeneration: currentAssignee.authzGeneration,
          toPrincipal: targetPrincipal,
          toMembershipGeneration: targetMembershipGeneration,
          toAuthzGeneration: targetAuthzGeneration,
          reassigned: true,
        };
      }

      if (immutablePlan.kind === 'manual_process_flow_plan' && immutableTask.flowRef.decisionId && disposition === 'succeeded') {
        throw conflict('A decision requires the assigned human to resume and save an explicit choice.', null, 'PROCESS_DECISION_RESUME_REQUIRED');
      }
      const status = ['resume', 'reassign'].includes(disposition) ? 'IN_PROGRESS' : disposition === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
      const taskOutcome = ['resume', 'reassign'].includes(disposition) ? runtime.outcome : { result: disposition };
      const taskEvidence = ['resume', 'reassign'].includes(disposition) ? runtime.evidence : safeEvidence;
      const event = processTaskRuntimeEvent('HumanTaskEscalationResolved', principal, {
        taskId, processPlanId: planId, revision, planInstanceId,
        disposition: disposition === 'reassign' ? 'resume' : disposition,
        ...(disposition === 'reassign' ? { ownerAction: 'reassign', ...reassignmentEventData } : {}),
        reason: safeReason, evidence: safeEvidence,
        ...(immutablePlan.kind === 'manual_process_flow_plan' ? { snapshotHash: immutablePlan.snapshotHash, flowHash: immutablePlan.flow.definitionHash } : {}),
      });
      const updated = await client.query(`
        update orgward.process_task_instances
        set status=$5, outcome=$6::jsonb, evidence=$7::jsonb, version=version+1,
          completed_at=case when $5 in ('SUCCEEDED', 'FAILED') then now() else null end,
          effective_assigned_principal=coalesce($9, effective_assigned_principal),
          effective_assigned_membership_generation=coalesce($10, effective_assigned_membership_generation),
          effective_assigned_authz_generation=coalesce($11, effective_assigned_authz_generation),
          updated_at=now(), events=events || $8::jsonb
        where tenant_id=$1 and plan_instance_id=$2 and task_id=$3 and version=$4
        returning *
      `, [tenantId, planInstanceId, taskId, Number(runtime.version), status,
        canonicalJson(taskOutcome), canonicalJson(taskEvidence), canonicalJson([event]),
        effectiveAssignmentUpdate?.principal ?? null, effectiveAssignmentUpdate?.membershipGeneration ?? null,
        effectiveAssignmentUpdate?.authzGeneration ?? null]);
      if (!updated.rowCount) throw conflict('The escalated task changed before the owner resolution was saved.', Number(runtime.version));
      await recordEvent(client, {
        tenantId, kind: 'process_task_instance', id: `${planInstanceId}:${taskId}`,
        version: Number(updated.rows[0].version), commandId, event,
      });
      if (['SUCCEEDED', 'FAILED'].includes(status)) await settleProcessTaskPauseIfDrained(client, tenantId, planInstanceId);
      const result = { projectId, planId, revision, planInstanceId, taskId, version: Number(updated.rows[0].version), status, disposition };
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, aggregate_kind, aggregate_id, result, result_hash)
        values ($1,$2,$3,$4,'process_task_instance',$5,$6::jsonb,$7)
      `, [tenantId, operation, commandId, requestHash, `${planInstanceId}:${taskId}`, canonicalJson(result), contentHash(result)]);
      const visible = await selectProcessTaskRuntimeForPrincipal(client, {
        tenantId, projectId, planInstanceId, taskId, principal, authzGeneration,
      });
      return { runtime: processTaskRuntimeView(visible.rows[0], principal), replayed: false };
    });
    if (outcome && !outcome.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    return outcome;
  }

  async authorizeProjectForPrincipal({ tenantId, projectId, principal, authzGeneration } = {}) {
    if (!tenantId || !projectId || !principal) throw projectAccessDenied();
    return this.persistence.transaction(async (client) => {
      await lockProjectAccess(client, { tenantId, projectId, principal, minimum: 'editor' });
      await requirePrincipalAuthority(client, {
        tenantId, principal, roles: ['workspace-write'], authzGeneration,
      });
      return true;
    });
  }

  async saveForPrincipal(run, {
    expectedVersion = null, principal, requiredPrincipalRoles = null, authzGeneration = null, validateCurrent = null,
  } = {}) {
    if (!principal) throw projectAccessDenied();
    return super.save(run, { expectedVersion, principal, requiredPrincipalRoles, authzGeneration, validateCurrent });
  }

  async recoverRunning(recover) {
    if (this.kind !== 'execution_run' || typeof recover !== 'function') throw new Error('Execution recovery requires a handler.');
    return this.persistence.transaction(async (client) => {
      const selected = await client.query(`
        select * from orgward.aggregates
        where aggregate_kind = 'execution_run' and state->>'status' = 'RUNNING'
        order by updated_at, aggregate_id
      `);
      let recovered = 0;
      for (const hintRow of selected.rows) {
        const hint = verifyAggregateRow(hintRow);
        let control = null;
        if (hint.processTaskRef) {
          control = await lockProcessTaskControl(client, hint.tenantId, hint.processTaskRef.planInstanceId);
          if (!control || ['PAUSED', 'ABANDONED_UNVERIFIED', 'CANCELLED'].includes(control.status)) continue;
        }
        const locked = await client.query(`select * from orgward.aggregates
          where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2
            and version=$3 and state->>'status'='RUNNING'
          for update skip locked`, [hint.tenantId, hint.id, hint.version]);
        if (!locked.rowCount) continue;
        const row = locked.rows[0];
        const lease = await client.query(`
          select 1 from orgward.execution_worker_leases
          where tenant_id = $1 and run_id = $2 and lease_until > now()
          for share
        `, [row.tenant_id, row.aggregate_id]);
        if (lease.rowCount) continue;
        const run = verifyAggregateRow(row);
        const previousVersion = run.version;
        const previousEvents = Array.isArray(run.events) ? run.events.length : 0;
        const shouldRecover = await recover(run);
        if (shouldRecover === false) continue;
        await updateAggregate(client, run, 'execution_run', previousVersion);
        if (run.processTaskRef) {
          await syncProcessTaskRuntimeFromRun(client, run);
        }
        const newEvents = Array.isArray(run.events) ? run.events.slice(previousEvents) : [];
        for (const event of newEvents) {
          await recordEvent(client, {
            tenantId: run.tenantId, kind: 'execution_run', id: run.id,
            version: event.aggregateVersion ?? event.version ?? run.version,
            commandId: event.causationId ?? null, event,
          });
        }
        await client.query(`update orgward.provider_dispatch_attempts
          set status='outcome_unknown',handed_off_at=coalesce(handed_off_at,now()),finished_at=now(),updated_at=now()
          where tenant_id=$1 and run_id=$2 and status in ('reserved','handed_off')`, [row.tenant_id, row.aggregate_id]);
        await client.query(`
          delete from orgward.execution_worker_leases
          where tenant_id = $1 and run_id = $2 and lease_until <= now()
        `, [row.tenant_id, row.aggregate_id]);
        if (run.processTaskRef && control?.status === 'PAUSE_REQUESTED') {
          await settleProcessTaskPauseIfDrained(client, run.tenantId, run.processTaskRef.planInstanceId);
        }
        recovered += 1;
      }
      return recovered;
    });
  }
}

function normalizeLegacy(kind, value) {
  const state = structuredClone(value);
  if (kind === 'project') {
    state.tenantId ??= 'tenant-reference-bank';
    state.version ??= 1;
    state.schemaVersion ??= '1.0';
    state.events ??= [];
    delete state.commandRecords;
  }
  if (kind === 'change_case' || kind === 'execution_run') delete state.projectId;
  return state;
}

function validLegacy(kind, state, fileName, tenantId) {
  const common = state && typeof state === 'object' && !Array.isArray(state)
    && IDENTIFIERS[kind].test(state.id ?? '')
    && fileName === `${state.id}.json`
    && state.tenantId === tenantId
    && Number.isInteger(state.version) && state.version >= 0
    && typeof state.updatedAt === 'string' && !Number.isNaN(Date.parse(state.updatedAt));
  if (!common) return false;
  if (kind === 'project') {
    return typeof state.name === 'string' && typeof state.phase === 'string'
      && Array.isArray(state.conversation) && Array.isArray(state.blueprintVersions) && Array.isArray(state.events);
  }
  if (kind === 'change_case') {
    return typeof state.title === 'string' && typeof state.status === 'string' && typeof state.currentStage === 'string'
      && Array.isArray(state.events) && state.idempotency && typeof state.idempotency === 'object';
  }
  return typeof state.title === 'string' && typeof state.status === 'string'
    && state.profile && typeof state.profile === 'object' && state.workItem && typeof state.workItem === 'object'
    && Array.isArray(state.events);
}

export class LegacyImporter {
  constructor(persistence, directories = {}) {
    this.persistence = persistence;
    this.sources = [
      ['project', directories.projects ? path.resolve(directories.projects) : null],
      ['change_case', directories.changeCases ? path.resolve(directories.changeCases) : null],
      ['execution_run', directories.executionRuns ? path.resolve(directories.executionRuns) : null],
    ];
  }

  async scan(tenantId) {
    const items = [];
    for (const [kind, directory] of this.sources) {
      if (!directory) continue;
      let names;
      try { names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort(); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (items.length + names.length > 10_000) throw new Error('Legacy import is limited to 10,000 records per command.');
      for (const name of names) {
        const sourcePath = `${kind}/${name}`;
        const file = path.join(directory, name);
        const stat = await lstat(file);
        if (!stat.isFile()) {
          const target = stat.isSymbolicLink() ? await readlink(file) : stat.mode.toString(8);
          items.push({
            kind, sourcePath, sourceHash: contentHash(`unsafe:${name}:${target}`), state: null, stateHash: null,
            id: null, status: 'quarantined', errorCode: 'UNSAFE_SOURCE_FILE',
          });
          continue;
        }
        if (stat.size > 5_000_000) {
          items.push({
            kind, sourcePath, sourceHash: contentHash(`oversize:${name}:${stat.size}`), state: null, stateHash: null,
            id: null, status: 'quarantined', errorCode: 'SOURCE_FILE_TOO_LARGE',
          });
          continue;
        }
        const bytes = await readFile(file);
        const sourceHash = contentHash(bytes);
        try {
          const state = normalizeLegacy(kind, JSON.parse(bytes.toString('utf8')));
          if (!validLegacy(kind, state, name, tenantId)) throw new Error('INVALID_LEGACY_RECORD');
          items.push({ kind, sourcePath, sourceHash, state, stateHash: contentHash(state), id: state.id, status: 'importable' });
        } catch {
          items.push({ kind, sourcePath, sourceHash, state: null, stateHash: null, id: null, status: 'quarantined', errorCode: 'INVALID_LEGACY_RECORD' });
        }
      }
    }
    return items;
  }

  async run({ tenantId, commandId, payloadHash, mode, actor = null, authzGeneration = null, onResult = null }) {
    const scanned = await this.scan(tenantId);
    if (mode === 'dry-run') {
      return this.persistence.transaction(async (client) => {
        if (actor) await requirePrincipalAuthority(client, {
          tenantId, principal: actor, roles: ['tenant-admin'], actorType: 'human', authzGeneration,
        });
        for (const item of scanned) {
          if (item.status === 'quarantined') continue;
          const existing = await client.query(`
            select * from orgward.aggregates
            where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
          `, [tenantId, item.kind, item.id]);
          if (!existing.rowCount) continue;
          try {
            verifyAggregateRow(existing.rows[0]);
            item.status = item.stateHash === existing.rows[0].state_hash ? 'unchanged' : 'quarantined';
            item.errorCode = item.status === 'unchanged' ? null : 'TARGET_CONFLICT';
          } catch {
            item.status = 'quarantined';
            item.errorCode = 'TARGET_CORRUPT';
          }
        }
        const counts = {
          discovered: scanned.length,
          importable: scanned.filter((item) => item.status === 'importable').length,
          unchanged: scanned.filter((item) => item.status === 'unchanged').length,
          quarantined: scanned.filter((item) => item.status === 'quarantined').length,
        };
        const response = { result: { mode, counts, items: scanned.map(({ state: _state, ...item }) => item) }, replayed: false };
        await onResult?.(response);
        return response;
      });
    }
    const operation = 'persistence.legacy-import';
    const response = await this.persistence.transaction(async (client) => {
      if (actor) await requirePrincipalAuthority(client, {
        tenantId, principal: actor, roles: ['tenant-admin'], actorType: 'human', authzGeneration,
      });
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${operation}:${commandId}`]);
      const prior = await client.query(`
        select * from orgward.command_results
        where tenant_id = $1 and operation = $2 and command_id = $3
      `, [tenantId, operation, commandId]);
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== payloadHash) throw conflict('This command ID was already used with different input.', null, 'IDEMPOTENCY_CONFLICT');
        return { result: verifyCommandRow(prior.rows[0]), replayed: true };
      }

      const items = [];
      for (const item of scanned) {
        if (item.status === 'quarantined') {
          items.push(item);
          continue;
        }
        const existing = await client.query(`
          select * from orgward.aggregates
          where tenant_id = $1 and aggregate_kind = $2 and aggregate_id = $3
          for update
        `, [tenantId, item.kind, item.id]);
        if (existing.rowCount) {
          let unchanged = false;
          try {
            const state = verifyAggregateRow(existing.rows[0]);
            unchanged = state.tenantId === tenantId && item.stateHash === existing.rows[0].state_hash;
          } catch { /* Treat corrupt targets as a conflict; never overwrite them. */ }
          items.push({ ...item, status: unchanged ? 'unchanged' : 'quarantined', errorCode: unchanged ? null : 'TARGET_CONFLICT' });
          continue;
        }
        await insertAggregate(client, item.state, item.kind);
        items.push({ ...item, status: 'imported', errorCode: null });
      }
      const publicItems = items.map(({ state: _state, stateHash, errorCode, ...item }) => ({ ...item, stateHash, errorCode }));
      const result = {
        mode,
        counts: {
          discovered: items.length,
          imported: items.filter((item) => item.status === 'imported').length,
          unchanged: items.filter((item) => item.status === 'unchanged').length,
          quarantined: items.filter((item) => item.status === 'quarantined').length,
        },
        items: publicItems,
      };
      await client.query(`
        insert into orgward.legacy_imports (tenant_id, import_id, payload_hash, status, result)
        values ($1, $2, $3, 'completed', $4::jsonb)
      `, [tenantId, commandId, payloadHash, canonicalJson(result)]);
      for (const item of items) {
        await client.query(`
          insert into orgward.legacy_import_items
            (tenant_id, import_id, source_kind, source_path, source_hash, aggregate_id, state_hash, status, error_code)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [tenantId, commandId, item.kind, item.sourcePath, item.sourceHash, item.id, item.stateHash, item.status, item.errorCode]);
      }
      await client.query(`
        insert into orgward.command_results
          (tenant_id, operation, command_id, payload_hash, result, result_hash)
        values ($1, $2, $3, $4, $5::jsonb, $6)
      `, [tenantId, operation, commandId, payloadHash, canonicalJson(result), contentHash(result)]);
      const event = {
        eventId: `event-${randomUUID()}`, schemaVersion: '1.0', tenantId, aggregateId: commandId,
        aggregateVersion: 1, type: 'LegacyImportCompleted', actor: actor ?? 'platform-operator', occurredAt: new Date().toISOString(),
        correlationId: commandId, causationId: commandId, data: { ...result.counts }, evidenceRefs: [],
      };
      await recordEvent(client, { tenantId, kind: 'legacy_import', id: commandId, version: 1, commandId, event });
      return { result, replayed: false };
    });
    if (!response.replayed) await this.persistence.afterCommit({ operation, commandId, tenantId });
    await onResult?.(response);
    return response;
  }
}
