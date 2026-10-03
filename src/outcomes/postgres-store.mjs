import { randomUUID } from 'node:crypto';
import { canonicalJson, contentHash, persistenceIntegrity, recordEvent, verifyAggregateRow } from '../platform/postgres.mjs';
import { lockProjectAccess, requirePrincipalAuthority } from '../platform/postgres-stores.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { createChangeCase, pinProjectSourceObject } from '../sdlc/engine.mjs';
import { latestBlueprint } from '../model.mjs';
import { OUTCOME_STATUSES, learningProposal, outcomeEvaluation, outcomeFailure, outcomeImportPreview } from './contracts.mjs';

const scope = (context) => [context.tenantId, context.projectId];
function verified(row) {
  if (!row || !row.state || contentHash(row.state) !== row.state_hash) throw persistenceIntegrity('An outcome record failed its stored hash check.');
  return structuredClone(row.state);
}
export class PostgresOutcomeStore {
  constructor(persistence, changeCaseStore) { this.persistence = persistence; this.changeCaseStore = changeCaseStore; }
  async #authorize(client, context, operation = 'read') {
    const owner = ['review', 'assign', 'follow-up', 'import'].includes(operation);
    const membership = await lockProjectAccess(client, { ...context,
      minimum: operation === 'read' ? 'reader' : owner ? 'owner' : 'editor' });
    await requirePrincipalAuthority(client, { ...context,
      ...(operation === 'read' ? { anyRoleGroups: [['workspace-read', 'workspace-write', 'tenant-admin']] }
        : { roles: ['workspace-write'], actorType: 'human' }) });
    return membership;
  }
  async #owner(client, context, principal) {
    const result = await client.query(`select p.principal from orgward.oidc_principals p
      join orgward.project_memberships m on m.tenant_id=p.tenant_id and m.principal=p.principal
      where p.tenant_id=$1 and m.project_id=$2 and p.principal=$3 and p.status='active'
        and p.actor_type='human' and 'workspace-write'=any(p.roles) and m.revoked_at is null
        and m.access in ('owner','editor') for share of p,m`, [...scope(context), principal]);
    if (!result.rowCount) throw outcomeFailure('OUTCOME_OWNER_UNAVAILABLE', 'Choose a current human project editor with workspace write access.', 403);
  }
  async #read(client, context, outcomeId, write = false) {
    const result = await client.query(`select state,state_hash from orgward.customer_outcomes
      where tenant_id=$1 and project_id=$2 and outcome_id=$3 ${write ? 'for update' : ''}`, [...scope(context), outcomeId]);
    return result.rowCount ? verified(result.rows[0]) : null;
  }
  async #project(client, context) {
    const result = await client.query(`select * from orgward.aggregates
      where tenant_id=$1 and aggregate_kind='project' and aggregate_id=$2 for share`, scope(context));
    if (!result.rowCount) throw outcomeFailure('SOURCE_PROJECT_NOT_FOUND', 'The current saved project was not found.', 404);
    return verifyAggregateRow(result.rows[0]);
  }
  async #replay(client, context, operation, input, payloadHash) {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',
      [`outcome:${context.tenantId}:${context.projectId}:${operation}:${input.commandId}`]);
    const result = await client.query(`select payload_hash,outcome_id from orgward.customer_outcome_commands
      where tenant_id=$1 and project_id=$2 and operation=$3 and command_id=$4`, [...scope(context), operation, input.commandId]);
    if (!result.rowCount) return null;
    if (result.rows[0].payload_hash !== payloadHash) throw outcomeFailure('IDEMPOTENCY_CONFLICT', 'This command ID is bound to different outcome input.');
    return this.#read(client, context, result.rows[0].outcome_id);
  }
  async #recordCommand(client, context, operation, input, payloadHash, outcome) {
    await client.query(`insert into orgward.customer_outcome_commands
      (tenant_id,project_id,operation,command_id,payload_hash,outcome_id) values ($1,$2,$3,$4,$5,$6)`,
    [...scope(context), operation, input.commandId, payloadHash, outcome.id]);
  }
  async #limit(client, context) {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`outcome-count:${context.tenantId}:${context.projectId}`]);
    const count = await client.query(`select count(*)::int as count from orgward.customer_outcomes where tenant_id=$1 and project_id=$2`, scope(context));
    if (count.rows[0].count >= 200) throw outcomeFailure('OUTCOME_PROJECT_LIMIT', 'This project has reached its 200-outcome history limit. Existing evidence is retained.');
  }
  async #write(client, context, outcome, type, input, created = false) {
    if (!created) outcome.version += 1;
    outcome.updatedAt = new Date().toISOString();
    const event = { id: `event-${randomUUID()}`, type, at: outcome.updatedAt, actor: context.principal,
      data: { sourceBindingHash: outcome.source.bindingHash, ownerPrincipal: outcome.ownerPrincipal, status: outcome.status,
        observationHash: outcome.latestEvaluation.observationHash, proposalHash: input.proposalHash ?? null } };
    outcome.events.push(event);
    if (created) await client.query(`insert into orgward.customer_outcomes
      (tenant_id,project_id,outcome_id,state,state_hash) values ($1,$2,$3,$4::jsonb,$5)`,
    [...scope(context), outcome.id, canonicalJson(outcome), contentHash(outcome)]);
    else await client.query(`update orgward.customer_outcomes set state=$4::jsonb,state_hash=$5,updated_at=now()
      where tenant_id=$1 and project_id=$2 and outcome_id=$3`,
    [...scope(context), outcome.id, canonicalJson(outcome), contentHash(outcome)]);
    await recordEvent(client, { tenantId: context.tenantId, kind: 'customer_outcome', id: outcome.id,
      version: outcome.version, commandId: input.commandId, event });
  }
  async #source(client, context, source) {
    let binding;
    if (source.kind === 'manual') {
      binding = { kind: 'manual', summary: source.summary, reportedBy: context.principal,
        evidenceKind: 'HUMAN_REPORTED', recordedAt: new Date().toISOString() };
    } else if (source.kind === 'release') {
      const result = await client.query(`select state,state_hash from orgward.protected_release_actions
        where tenant_id=$1 and project_id=$2 and action_id=$3 for share`, [...scope(context), source.actionId]);
      if (!result.rowCount) throw outcomeFailure('OUTCOME_SOURCE_NOT_FOUND', 'The release action was not found in this project.', 404);
      const action = verified(result.rows[0]);
      if (digest(action.request) !== action.requestHash) throw persistenceIntegrity('The release source request failed its hash check.');
      binding = { kind: 'release', actionId: action.id, requestHash: action.requestHash, statusAtCapture: action.status,
        environmentId: action.request.environment.id, candidateEvidenceHash: action.request.candidate.candidateEvidenceHash,
        candidateTreeDigest: action.request.candidate.candidateTreeDigest, runId: action.request.candidate.runId,
        lastObservation: action.observations.at(-1) ?? null };
    } else {
      const result = await client.query(`select a.* from orgward.aggregates a
        join orgward.aggregate_project_scopes s on s.tenant_id=a.tenant_id and s.aggregate_kind=a.aggregate_kind and s.aggregate_id=a.aggregate_id
        where a.tenant_id=$1 and a.aggregate_kind='execution_run' and a.aggregate_id=$2 and s.project_id=$3 for share of a`,
      [context.tenantId, source.runId, context.projectId]);
      if (!result.rowCount) throw outcomeFailure('OUTCOME_SOURCE_NOT_FOUND', 'The task run was not found in this project.', 404);
      const run = verifyAggregateRow(result.rows[0]);
      binding = { kind: 'task', runId: run.id, title: run.title ?? run.workItem?.objective ?? 'Saved task run',
        statusAtCapture: run.status, runVersion: run.version, evidenceHash: run.execution?.evidenceHash ?? null,
        processTaskRef: run.processTaskRef ?? null };
    }
    return { ...binding, bindingHash: digest(binding) };
  }
  async list(context) {
    return this.persistence.transaction(async (client) => {
      const membership = await this.#authorize(client, context);
      const found = await client.query(`select state,state_hash from orgward.customer_outcomes
        where tenant_id=$1 and project_id=$2
        order by case when state->>'status' in ('OPEN','IN_PROGRESS') then 0 else 1 end,updated_at desc,outcome_id desc limit 200`, scope(context));
      const releaseRows = await client.query(`select state,state_hash from orgward.protected_release_actions
        where tenant_id=$1 and project_id=$2 order by created_at desc limit 50`, scope(context));
      const releases = releaseRows.rows.map((row) => { const action = verified(row); return { actionId: action.id,
        status: action.status, environmentId: action.request.environment.id,
        candidateEvidenceHash: action.request.candidate.candidateEvidenceHash }; });
      const taskRows = await client.query(`select a.* from orgward.aggregates a join orgward.aggregate_project_scopes s
        on s.tenant_id=a.tenant_id and s.aggregate_kind=a.aggregate_kind and s.aggregate_id=a.aggregate_id
        where a.tenant_id=$1 and a.aggregate_kind='execution_run' and s.project_id=$2
        order by a.updated_at desc limit 100`, scope(context));
      const tasks = taskRows.rows.map((row) => { const run = verifyAggregateRow(row);
        return { runId: run.id, status: run.status, title: run.title ?? run.workItem?.objective ?? 'Saved task run' }; });
      const project = await this.#project(client, context);
      const blueprint = latestBlueprint(project);
      const members = await client.query(`select p.principal,p.display_name as "displayName",m.access
        from orgward.project_memberships m join orgward.oidc_principals p on p.tenant_id=m.tenant_id and p.principal=m.principal
        where m.tenant_id=$1 and m.project_id=$2 and m.revoked_at is null and p.status='active'
          and p.actor_type='human' and 'workspace-write'=any(p.roles) and m.access in ('owner','editor') order by p.display_name,p.principal`, scope(context));
      const identity = await client.query(`select actor_type,roles from orgward.oidc_principals where tenant_id=$1 and principal=$2`,
        [context.tenantId, context.principal]);
      const write = ['owner', 'editor'].includes(membership.access) && identity.rows[0].actor_type === 'human'
        && identity.rows[0].roles.includes('workspace-write');
      return { outcomes: found.rows.map(verified), permissions: { write, review: write && membership.access === 'owner',
        assign: write && membership.access === 'owner', followUp: write && membership.access === 'owner' }, sources: { releases, tasks,
        design: blueprint ? { projectVersion: project.version, blueprintId: blueprint.id, blueprintVersion: blueprint.version,
          objects: Object.values(blueprint.areas ?? {}).flatMap((area) => area.items ?? []).map(({ id, type, name }) => ({ id, type, name })) } : null,
        members: members.rows } };
    });
  }
  async read(context, outcomeId) {
    return this.persistence.transaction(async (client) => { await this.#authorize(client, context); return this.#read(client, context, outcomeId); });
  }
  async create(context, input, payloadHash) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, context, 'create');
      const replay = await this.#replay(client, context, 'create', input, payloadHash);
      if (replay) return { outcome: replay, replayed: true };
      await this.#owner(client, context, input.ownerPrincipal);
      await this.#limit(client, context);
      const outcome = { id: `outcome-${randomUUID()}`, tenantId: context.tenantId, projectId: context.projectId,
        version: 1, title: input.title, category: input.category, ownerPrincipal: input.ownerPrincipal, status: 'OPEN',
        source: await this.#source(client, context, input.source), createdBy: context.principal,
        createdAt: new Date().toISOString(), updatedAt: null, observations: [], latestEvaluation: outcomeEvaluation(), proposals: [], events: [] };
      await this.#write(client, context, outcome, 'CustomerOutcomeCreated', input, true);
      await this.#recordCommand(client, context, 'create', input, payloadHash, outcome);
      return { outcome, replayed: false };
    });
  }
  async previewImport(context, prepared) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, context, 'import');
      return { preview: outcomeImportPreview(prepared) };
    });
  }
  async import(context, input, prepared, payloadHash) {
    return this.persistence.transaction(async (client) => {
      await this.#authorize(client, context, 'import');
      const replay = await this.#replay(client, context, 'import', input, payloadHash);
      if (replay) return { outcome: replay, replayed: true };
      await this.#owner(client, context, input.ownerPrincipal);
      await this.#limit(client, context);
      const at = new Date().toISOString();
      const source = await this.#source(client, context, { kind: 'manual',
        summary: `Imported human-reported evidence from ${prepared.origin.outcomeId}.` });
      const observations = prepared.observations.map((original) => {
        const core = { id: `observation-${randomUUID()}`, window: original.window, measures: original.measures,
          reportedBy: context.principal, evidenceKind: 'HUMAN_REPORTED', recordedAt: at, sourceBindingHash: source.bindingHash,
          importedOrigin: { observationId: original.id, observationHash: original.observationHash,
            reportedBy: original.reportedBy, recordedAt: original.recordedAt, sourceBindingHash: original.sourceBindingHash } };
        return { ...core, observationHash: digest(core) };
      });
      const last = observations.at(-1);
      const outcome = { id: `outcome-${randomUUID()}`, tenantId: context.tenantId, projectId: context.projectId,
        version: 1, title: prepared.title, category: prepared.category, ownerPrincipal: input.ownerPrincipal, status: 'OPEN',
        source, importedFrom: { ...prepared.origin, exportHash: prepared.exportHash, importHash: prepared.importHash,
          importedBy: context.principal, importedAt: at, authorityImported: false },
        createdBy: context.principal, createdAt: at, updatedAt: null, observations,
        latestEvaluation: outcomeEvaluation(last?.measures ?? [], last?.observationHash ?? null), proposals: [], events: [] };
      await this.#write(client, context, outcome, 'CustomerOutcomeImported', input, true);
      await this.#recordCommand(client, context, 'import', input, payloadHash, outcome);
      return { outcome, replayed: false };
    });
  }
  async command(context, outcomeId, operation, input, payloadHash) {
    return this.persistence.transaction(async (client) => {
      const membership = await this.#authorize(client, context, operation);
      const key = `${operation}:${outcomeId}`;
      const replay = await this.#replay(client, context, key, input, payloadHash);
      if (replay) return this.#result(client, context, replay, input.proposalHash, true);
      const outcome = await this.#read(client, context, outcomeId, true);
      if (!outcome) throw outcomeFailure('OUTCOME_NOT_FOUND', 'The outcome was not found in this project.', 404);
      if (outcome.version !== input.expectedVersion) throw outcomeFailure('OUTCOME_VERSION_CONFLICT', 'The outcome changed. Reload before reviewing or updating it.');
      if (outcome.events.length >= 500) throw outcomeFailure('OUTCOME_HISTORY_LIMIT', 'This outcome reached its 500-event history limit. Its evidence remains retained.');
      let type;
      if (operation === 'observe') {
        const core = { id: `observation-${randomUUID()}`, window: input.window, measures: input.measures,
          reportedBy: context.principal, evidenceKind: 'HUMAN_REPORTED', recordedAt: new Date().toISOString(),
          sourceBindingHash: outcome.source.bindingHash };
        const observation = { ...core, observationHash: digest(core) };
        outcome.observations.push(observation);
        outcome.latestEvaluation = outcomeEvaluation(observation.measures, observation.observationHash);
        type = 'CustomerOutcomeObserved';
      } else if (operation === 'propose') {
        if (!outcome.latestEvaluation.observationHash || input.observationHash !== outcome.latestEvaluation.observationHash) {
          throw outcomeFailure('OUTCOME_OBSERVATION_STALE', 'Review the current observation before proposing a follow-up.');
        }
        outcome.proposals.push(learningProposal(input, input.observationHash, context.principal,
          `learning-proposal-${randomUUID()}`, new Date().toISOString()));
        type = 'CustomerLearningProposed';
      } else if (operation === 'assign') {
        await this.#owner(client, context, input.ownerPrincipal);
        outcome.ownerPrincipal = input.ownerPrincipal; type = 'CustomerOutcomeAssigned';
      } else if (operation === 'status') {
        if (outcome.ownerPrincipal !== context.principal && membership.access !== 'owner') {
          throw outcomeFailure('OUTCOME_OWNER_REQUIRED', 'Only the current item owner or project owner can change its status.', 403);
        }
        if (!OUTCOME_STATUSES.includes(input.status)) throw outcomeFailure('INVALID_OUTCOME_STATUS', 'Choose an available inbox status.', 400);
        outcome.status = input.status; type = 'CustomerOutcomeStatusChanged';
      } else {
        const proposal = outcome.proposals.find((item) => item.proposalHash === input.proposalHash);
        if (!proposal) throw outcomeFailure('OUTCOME_PROPOSAL_NOT_FOUND', 'The exact learning proposal was not found.', 404);
        const { proposalHash, status, review, followUpCaseId, followUpSourceSelectionHash, ...core } = proposal;
        if (digest(core) !== proposalHash) throw persistenceIntegrity('The learning proposal failed its immutable content hash check.');
        if (proposal.observationHash !== outcome.latestEvaluation.observationHash) {
          throw outcomeFailure('OUTCOME_REVIEW_STALE', 'New observations require a new reviewed learning proposal.');
        }
        if (operation === 'review') {
          if (proposal.status !== 'PROPOSED') throw outcomeFailure('OUTCOME_PROPOSAL_ALREADY_REVIEWED', 'This proposal already has a saved review.');
          const reviewCore = { id: `learning-review-${randomUUID()}`, proposalHash: proposal.proposalHash,
            observationHash: proposal.observationHash, decision: input.decision, reason: input.reason,
            principal: context.principal, authorityGeneration: context.authzGeneration, reviewedAt: new Date().toISOString() };
          proposal.review = { ...reviewCore, reviewHash: digest(reviewCore) };
          proposal.status = input.decision === 'accept' ? 'ACCEPTED' : 'REJECTED'; type = 'CustomerLearningReviewed';
        } else if (operation === 'follow-up') {
          if (proposal.status !== 'ACCEPTED' || proposal.review?.decision !== 'accept') {
            throw outcomeFailure('OUTCOME_REVIEW_REQUIRED', 'A human project owner must accept the current exact proposal before creating follow-up work.');
          }
          const { reviewHash, ...reviewCore } = proposal.review;
          if (digest(reviewCore) !== reviewHash) throw persistenceIntegrity('The saved learning review failed its hash check.');
          const selection = { expectedProjectVersion: input.expectedProjectVersion, expectedBlueprintId: input.expectedBlueprintId,
            expectedBlueprintVersion: input.expectedBlueprintVersion, sourceObjectId: input.sourceObjectId };
          const selectionHash = digest(selection);
          if (proposal.followUpCaseId) {
            if (selectionHash !== proposal.followUpSourceSelectionHash) throw outcomeFailure('OUTCOME_FOLLOW_UP_ALREADY_LINKED', 'This proposal already links to a follow-up case with its reviewed saved-design source.');
            await this.#recordCommand(client, context, key, input, payloadHash, outcome);
            return this.#result(client, context, outcome, input.proposalHash, true);
          }
          try { await this.#owner(client, context, outcome.ownerPrincipal); }
          catch (error) {
            if (error.code !== 'OUTCOME_OWNER_UNAVAILABLE') throw error;
            throw outcomeFailure('OUTCOME_OWNER_REASSIGN_REQUIRED', 'The item owner no longer has current project write access. Reassign responsibility before creating follow-up work.');
          }
          const project = await this.#project(client, context);
          const sourceBinding = pinProjectSourceObject(project, selection);
          const targets = outcome.latestEvaluation.measures.filter((measure) => measure.target !== null).map((measure) => ({
            id: measure.id, name: measure.name, target: measure.target, unit: measure.unit, comparison: measure.comparison }));
          const changeCase = createChangeCase({ mode: 'custom', tenantId: context.tenantId, projectId: context.projectId,
            title: proposal.title, rawIntent: proposal.recommendation, problem: proposal.rationale,
            motivation: 'Follow up on the reviewed recorded customer outcome.', targetPopulation: sourceBinding.snapshot.name,
            desiredOutcomes: [proposal.recommendation], successMeasures: targets,
            createdBy: context.principal, accountableOwner: outcome.ownerPrincipal }, { sourceBinding });
          changeCase.outcomeLineage = { outcomeId: outcome.id, sourceBindingHash: outcome.source.bindingHash,
            proposalId: proposal.id, proposalHash: proposal.proposalHash, observationHash: proposal.observationHash,
            reviewId: proposal.review.id, reviewHash: proposal.review.reviewHash, category: outcome.category };
          await this.changeCaseStore.saveInTransaction(client, changeCase, { principal: context.principal,
            requiredPrincipalRoles: ['workspace-write'], authzGeneration: context.authzGeneration });
          proposal.followUpCaseId = changeCase.id; proposal.followUpSourceSelectionHash = selectionHash;
          type = 'CustomerFollowUpCaseCreated';
        } else throw outcomeFailure('INVALID_OUTCOME_COMMAND', 'This outcome action is unavailable.', 400);
      }
      if (input.reason) outcome.events.push({ id: `event-${randomUUID()}`, type: 'CustomerOutcomeReasonRecorded',
        actor: context.principal, at: new Date().toISOString(), data: { operation, reason: input.reason } });
      await this.#write(client, context, outcome, type, input);
      await this.#recordCommand(client, context, key, input, payloadHash, outcome);
      return this.#result(client, context, outcome, input.proposalHash, false);
    });
  }
  async #result(client, context, outcome, proposalHash, replayed) {
    const caseId = outcome.proposals.find((proposal) => proposal.proposalHash === proposalHash)?.followUpCaseId;
    if (!caseId) return { outcome, replayed };
    const found = await client.query(`select * from orgward.aggregates
      where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [context.tenantId, caseId]);
    if (!found.rowCount) throw persistenceIntegrity('The outcome links to a missing follow-up case.');
    const changeCase = verifyAggregateRow(found.rows[0]);
    if (changeCase.projectId !== context.projectId) throw persistenceIntegrity('The outcome follow-up case is outside its saved project.');
    return { outcome, replayed, case: changeCase, caseHref: `/sdlc.html?case=${encodeURIComponent(caseId)}` };
  }
}
