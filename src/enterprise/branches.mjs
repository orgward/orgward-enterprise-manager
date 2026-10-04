import { randomUUID } from 'node:crypto';
import { buildRelations, editBlueprintObject, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { effectiveStatus, enterpriseInterval } from './state.mjs';
import { applyEnterpriseCommand, normalizeEnterpriseCommand } from './commands.mjs';

export const ENTERPRISE_BRANCH_KINDS = new Set(['create-branch', 'edit-branch-object', 'edit-branch-scope',
  'set-branch-validity', 'prepare-merge', 'review-merge', 'apply-reviewed-merge', 'abandon-branch']);
const referenceFields = new Set(['owner', 'metric', 'metrics', 'serves', 'enabledBy', 'realisers', 'capability',
  'inputs', 'outputs', 'resources', 'systems', 'responsibilities', 'decisionIds', 'assignedRoleIds', 'decisionMaker',
  'scope', 'supports', 'control', 'mitigates', 'reads', 'consumerLoop', 'goal', 'evidence', 'decisions', 'parentUnitId', 'processFlow', 'decisionTable']);
const reportFields = new Set(['enterpriseStates', 'provenance']);
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const same = (left, right) => digest(left ?? null) === digest(right ?? null) && (left === undefined) === (right === undefined);
const fail = (code, message, status = 409) => { throw enterpriseFailure(code, message, status); };
function blueprintRef(input) {
  if (!/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '') || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1) {
    fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'Bind this command to an exact saved blueprint ID and version.', 400);
  }
  return { blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion };
}
function branchRef(input) {
  if (!/^enterprise-branch-[0-9a-f-]{36}$/.test(input.branchId ?? '') || !Number.isSafeInteger(input.branchRevision) || input.branchRevision < 1) {
    fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'Bind this command to a saved branch and exact draft revision.', 400);
  }
  return { branchId: input.branchId, branchRevision: input.branchRevision };
}
export function normalizeEnterpriseBranchCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ENTERPRISE_BRANCH_KINDS.has(input.kind)) {
    fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'Choose an available branch command.', 400);
  }
  const command = { kind: input.kind, ...blueprintRef(input), reason: enterpriseText(input.reason, 'Change reason', 500) };
  const common = ['kind', 'blueprintId', 'blueprintVersion', 'reason'];
  let allowed = [...common];
  if (input.kind === 'create-branch') {
    allowed.push('title', 'proposalId');
    const proposalId = input.proposalId ?? null;
    if (proposalId !== null && !/^enterprise-proposal-[0-9a-f-]{36}$/.test(proposalId)) fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'Choose an exact saved future proposal.', 400);
    Object.assign(command, { title: enterpriseText(input.title, 'Branch title', 160), proposalId });
  } else {
    Object.assign(command, branchRef(input)); allowed.push('branchId', 'branchRevision');
    if (input.kind === 'edit-branch-object') {
      allowed.push('edit');
      if (!input.edit || typeof input.edit !== 'object' || Array.isArray(input.edit)) fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'Provide a typed Studio object edit.', 400);
      command.edit = clone(input.edit);
      if (typeof command.edit.objectId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(command.edit.objectId)) {
        fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'Choose one saved design object to edit.', 400);
      }
      command.edit.name = enterpriseText(command.edit.name, 'Object name', 120);
      command.edit.detail = enterpriseText(command.edit.detail, 'Object description', 700);
    } else if (input.kind === 'edit-branch-scope') {
      allowed.push('change');
      if (!input.change || !['create-scope', 'rename-scope', 'assign-object-scope'].includes(input.change.kind)
        || ['blueprintId', 'blueprintVersion', 'reason'].some((field) => Object.hasOwn(input.change, field))) {
        fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'Provide an enterprise scope change without duplicate source or reason fields.', 400);
      }
      command.change = normalizeEnterpriseCommand({ ...input.change, ...blueprintRef(input), reason: command.reason });
    } else if (input.kind === 'set-branch-validity') {
      allowed.push('effectiveFrom', 'effectiveTo'); Object.assign(command, enterpriseInterval(input.effectiveFrom, input.effectiveTo));
    } else if (input.kind === 'prepare-merge') {
      allowed.push('resolutions');
      if (!Array.isArray(input.resolutions) || input.resolutions.length > 500 || input.resolutions.some((entry) => !entry
        || Object.keys(entry).length !== 2 || !/^conflict-[a-f0-9]{64}$/.test(entry.conflictId ?? '') || !['current', 'branch'].includes(entry.choice))) {
        fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'Choose current or branch for each identified conflict.', 400);
      }
      command.resolutions = clone(input.resolutions).sort((a, b) => a.conflictId.localeCompare(b.conflictId));
    } else if (['review-merge', 'apply-reviewed-merge'].includes(input.kind)) {
      allowed.push('candidateId', 'candidateHash');
      if (!/^enterprise-merge-[0-9a-f-]{36}$/.test(input.candidateId ?? '') || !/^[a-f0-9]{64}$/.test(input.candidateHash ?? '')) {
        fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'Choose the exact saved merge candidate and digest.', 400);
      }
      Object.assign(command, { candidateId: input.candidateId, candidateHash: input.candidateHash });
      if (input.kind === 'review-merge') {
        allowed.push('decision');
        if (!['ACCEPT', 'REJECT'].includes(input.decision)) fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'Accept or reject the exact merge candidate.', 400);
        command.decision = input.decision;
      }
    }
  }
  if (Object.keys(input).some((field) => !allowed.includes(field))) fail('INVALID_ENTERPRISE_BRANCH_COMMAND', 'The branch command contains unsupported fields.', 400);
  return command;
}
function verifiedProposal(project, id) {
  const proposal = (project.enterpriseProposals ?? []).find((entry) => entry.id === id);
  if (!proposal) fail('ENTERPRISE_PROPOSAL_NOT_FOUND', 'The future proposal was not found in this project.', 404);
  const { proposalHash, ...core } = proposal;
  const base = project.blueprintVersions.find((entry) => entry.id === proposal.baseBlueprintId && entry.version === proposal.baseBlueprintVersion);
  if (!base || digest(base) !== proposal.baseSnapshotHash || digest(core) !== proposalHash || digest(proposal.snapshot) !== proposal.snapshotHash) {
    fail('ENTERPRISE_PROPOSAL_INTEGRITY', 'The saved future proposal failed its immutable source checks.');
  }
  return { proposal, base };
}
function verifiedBranch(project, id) {
  const branch = (project.enterpriseBranches ?? []).find((entry) => entry.id === id);
  if (!branch) fail('ENTERPRISE_BRANCH_NOT_FOUND', 'The branch was not found in this project.', 404);
  const base = project.blueprintVersions.find((entry) => entry.id === branch.baseBlueprintId && entry.version === branch.baseBlueprintVersion);
  if (!base || digest(base) !== branch.baseSnapshotHash || !Array.isArray(branch.revisions) || !branch.revisions.length
    || branch.revisions.some((entry, index) => entry.revision !== index + 1 || digest(entry.snapshot) !== entry.snapshotHash)) {
    fail('ENTERPRISE_BRANCH_INTEGRITY', 'The branch failed its immutable base or draft revision checks.');
  }
  for (const candidate of branch.candidates ?? []) {
    const { hash, review, appliedBlueprintId, appliedAt, ...core } = candidate;
    if (digest(core) !== hash || digest(candidate.snapshot) !== candidate.snapshotHash) fail('ENTERPRISE_MERGE_INTEGRITY', 'A saved merge candidate failed its content checks.');
  }
  return { branch, base, head: branch.revisions.at(-1) };
}
function assertActiveHead(branch, head, command, { main = null } = {}) {
  if (branch.status !== 'DRAFT') fail('ENTERPRISE_BRANCH_READ_ONLY', 'Merged or abandoned branches remain read-only.');
  if (head.revision !== command.branchRevision) fail('ENTERPRISE_BRANCH_STALE', 'The draft changed. Reload the current branch revision.');
  const source = main ?? head.snapshot;
  if (source.id !== command.blueprintId || source.version !== command.blueprintVersion) {
    fail(main ? 'ENTERPRISE_MERGE_STALE' : 'ENTERPRISE_BRANCH_STALE', 'The command source changed. Reload the current design and branch.');
  }
}
function objectEntries(blueprint) {
  return new Map(Object.entries(blueprint.areas).flatMap(([area, value]) => value.items.map((object) => [object.id, { area, object }])));
}
function meaning(entry) {
  if (!entry) return undefined;
  return { $area: entry.area, ...Object.fromEntries(Object.entries(entry.object).filter(([key]) => !reportFields.has(key))) };
}
function relationDelta(before, after) {
  const prior = new Map(before.map((edge) => [digest(edge), edge])); const next = new Map(after.map((edge) => [digest(edge), edge]));
  return { added: [...next].filter(([id]) => !prior.has(id)).map(([, edge]) => clone(edge)),
    removed: [...prior].filter(([id]) => !next.has(id)).map(([, edge]) => clone(edge)) };
}
function referenceNames(blueprint, displayedValues) {
  const objects = new Map(blueprintObjects(blueprint).map((object) => [object.id, object.name]));
  const referenced = new Set();
  const visit = (value) => {
    if (typeof value === 'string' && objects.has(value)) referenced.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(displayedValues);
  return Object.fromEntries([...referenced].sort().map((id) => [id, objects.get(id)]));
}
export function compareEnterpriseBranch(project, branch, revision = branch.revisions.at(-1), current = latestBlueprint(project)) {
  const base = project.blueprintVersions.find((entry) => entry.id === branch.baseBlueprintId && entry.version === branch.baseBlueprintVersion);
  const proposed = revision.snapshot;
  const maps = [base, current, proposed].map(objectEntries);
  const changes = [];
  function add(objectId, objectName, field, values, kind) {
    const [before, now, draft] = values; const currentChanged = !same(before, now); const branchChanged = !same(before, draft);
    if (!currentChanged && !branchChanged) return;
    const conflict = currentChanged && branchChanged && !same(now, draft);
    changes.push({ objectId, objectName, field, kind, base: clone(before) ?? null, current: clone(now) ?? null, proposed: clone(draft) ?? null,
      basePresent: before !== undefined, currentPresent: now !== undefined, proposedPresent: draft !== undefined,
      currentChanged, branchChanged, conflictId: conflict ? `conflict-${digest({ objectId, field, values: values.map((value) => ({ present: value !== undefined, value: value ?? null })) })}` : null });
  }
  for (const id of [...new Set(maps.flatMap((map) => [...map.keys()]))].sort()) {
    const entries = maps.map((map) => map.get(id)); const values = entries.map(meaning);
    const name = entries[1]?.object.name ?? entries[2]?.object.name ?? entries[0]?.object.name;
    if (entries.some((entry) => !entry)) { add(id, name, '$object', values, 'PRESENCE'); continue; }
    for (const field of [...new Set(values.flatMap((object) => Object.keys(object)))].sort()) {
      add(id, name, field, values.map((object) => object[field]), field === 'enterpriseScope' ? 'SCOPE' : referenceFields.has(field) ? 'REFERENCE' : 'CONTENT');
    }
  }
  const validity = (blueprint) => blueprint.enterpriseValidity ? { effectiveFrom: blueprint.enterpriseValidity.effectiveFrom,
    effectiveTo: blueprint.enterpriseValidity.effectiveTo } : undefined;
  add(null, 'Design validity', 'enterpriseValidity', [base, current, proposed].map(validity), 'VALIDITY');
  const currentEdges = relationDelta(base.relations, current.relations); const branchEdges = relationDelta(base.relations, proposed.relations);
  const relations = { currentAdded: currentEdges.added, currentRemoved: currentEdges.removed,
    branchAdded: branchEdges.added, branchRemoved: branchEdges.removed };
  const displayedValues = [changes, relations];
  return { mainBlueprintId: current.id, mainBlueprintVersion: current.version, mainSnapshotHash: digest(current),
    changes, conflicts: changes.filter((row) => row.conflictId),
    relations, referenceNames: { base: referenceNames(base, displayedValues), current: referenceNames(current, displayedValues),
      proposed: referenceNames(proposed, displayedValues) } };
}
function mergeSnapshot(project, branch, head, resolutions) {
  const comparison = compareEnterpriseBranch(project, branch, head);
  const resolutionMap = new Map(resolutions.map((entry) => [entry.conflictId, entry.choice]));
  if (resolutionMap.size !== resolutions.length || resolutionMap.size !== comparison.conflicts.length
    || comparison.conflicts.some((row) => !resolutionMap.has(row.conflictId))) fail('ENTERPRISE_MERGE_CONFLICTS', 'Resolve every current conflict exactly once before saving a merge candidate.');
  const base = project.blueprintVersions.find((entry) => entry.id === branch.baseBlueprintId);
  const current = latestBlueprint(project); const draft = head.snapshot;
  const maps = [base, current, draft].map(objectEntries);
  const rows = new Map(comparison.changes.map((row) => [`${row.objectId ?? '$blueprint'}:${row.field}`, row]));
  function chosen(id, field, values) {
    const row = rows.get(`${id ?? '$blueprint'}:${field}`);
    if (row?.conflictId) return values[resolutionMap.get(row.conflictId) === 'branch' ? 2 : 1];
    return row?.branchChanged ? values[2] : values[1];
  }
  const next = clone(current);
  for (const area of Object.values(next.areas)) area.items = [];
  for (const id of [...new Set(maps.flatMap((map) => [...map.keys()]))]) {
    const entries = maps.map((map) => map.get(id)); const values = entries.map(meaning);
    let merged;
    if (entries.some((entry) => !entry)) merged = clone(chosen(id, '$object', values));
    else merged = Object.fromEntries([...new Set(values.flatMap((object) => Object.keys(object)))].map((field) =>
      [field, clone(chosen(id, field, values.map((object) => object[field]))) ]).filter(([, value]) => value !== undefined));
    if (!merged) continue;
    const area = merged.$area; delete merged.$area;
    if (!next.areas[area] || merged.id !== id) fail('ENTERPRISE_MERGE_INVALID', 'The merge would change an object identity or use an unsupported area.');
    const reports = entries[1]?.object ?? entries[2]?.object;
    if (entries[1]?.object.enterpriseStates) merged.enterpriseStates = clone(entries[1].object.enterpriseStates);
    if (reports.provenance !== undefined) merged.provenance = clone(reports.provenance);
    next.areas[area].items.push(merged);
  }
  const validityValues = [base, current, draft].map((blueprint) => blueprint.enterpriseValidity
    ? { effectiveFrom: blueprint.enterpriseValidity.effectiveFrom, effectiveTo: blueprint.enterpriseValidity.effectiveTo } : undefined);
  const validity = chosen(null, 'enterpriseValidity', validityValues);
  if (validity === undefined) delete next.enterpriseValidity;
  else {
    const source = same(validity, validityValues[2]) ? draft : current;
    next.enterpriseValidity = clone(source.enterpriseValidity);
  }
  next.relations = buildRelations(next.areas); next.integrity = validateBlueprint(next);
  const roles = blueprintObjects(next).filter((object) => object.type === 'role');
  if (!next.integrity.valid || new Set(roles.map((role) => role.name.toLocaleLowerCase())).size !== roles.length) {
    fail('ENTERPRISE_MERGE_INVALID', next.integrity.errors[0]?.message ?? 'The merged design would have ambiguous role names or invalid typed references.');
  }
  next.summary = { areaCount: Object.keys(next.areas).length, objectCount: blueprintObjects(next).length,
    relationCount: next.relations.length, designedAreas: Object.values(next.areas).filter((area) => area.status === 'designed').length };
  const changed = compareResult(current, next).some((row) => row.branchChanged);
  if (!changed) fail('ENTERPRISE_NO_CHANGE', 'The chosen merge does not change the current proposed design.');
  return { snapshot: next, comparison, relations: relationDelta(current.relations, next.relations) };
}
function candidateCurrent(project, branch, head, candidate, current = latestBlueprint(project)) {
  if (!current || !head) return false;
  return candidate.branchRevision === head.revision && candidate.branchSnapshotHash === head.snapshotHash
    && candidate.mainBlueprintId === current.id && candidate.mainBlueprintVersion === current.version
    && candidate.mainSnapshotHash === digest(current);
}
function candidateFor(project, branch, head, command) {
  const candidate = (branch.candidates ?? []).find((entry) => entry.id === command.candidateId);
  if (!candidate || candidate.hash !== command.candidateHash) fail('ENTERPRISE_MERGE_STALE', 'Choose the exact saved merge candidate and digest.');
  if (!candidateCurrent(project, branch, head, candidate)) fail('ENTERPRISE_MERGE_STALE', 'Main or the draft changed. Prepare and review a new merge candidate.');
  return candidate;
}
export function enterpriseMergeEligibility(snapshot, now = new Date().toISOString()) {
  const validity = snapshot.enterpriseValidity;
  if (!validity?.effectiveFrom) return { status: 'UNKNOWN', effectiveFrom: null, effectiveTo: validity?.effectiveTo ?? null };
  const from = Date.parse(validity.effectiveFrom); const to = validity.effectiveTo ? Date.parse(validity.effectiveTo) : null;
  if (!Number.isFinite(from) || (to !== null && (!Number.isFinite(to) || to <= from))) {
    fail('ENTERPRISE_MERGE_INVALID', 'The candidate has an invalid declared validity interval.');
  }
  return { status: Date.parse(now) < from ? 'FUTURE' : to !== null && Date.parse(now) >= to ? 'EXPIRED' : 'ELIGIBLE',
    effectiveFrom: validity.effectiveFrom, effectiveTo: validity.effectiveTo };
}
export function enterpriseMergeApproval(project, command) {
  const { branch, head } = verifiedBranch(project, command.branchId);
  assertActiveHead(branch, head, command, { main: latestBlueprint(project) });
  const candidate = candidateFor(project, branch, head, command);
  if (candidate.review?.decision !== 'ACCEPT') fail('ENTERPRISE_MERGE_REVIEW_REQUIRED', 'A current human owner must accept this exact candidate before applying it.');
  return clone(candidate.review);
}
export function appendEnterpriseBranchDesign(project, command, actor, mutate) {
  const { branch, head } = verifiedBranch(project, command.branchId);
  assertActiveHead(branch, head, command);
  const at = new Date().toISOString(); const next = mutate(clone(head.snapshot), at);
  const revision = addRevision(branch, next, actor, command.reason, at);
  project.audit ??= [];
  project.audit.push({ at, action: `enterprise.${command.kind}`, actor, detail: `Updated typed enterprise design in “${branch.title}”.` });
  return { blueprint: latestBlueprint(project), affectedObjectId: command.objectId, branchId: branch.id,
    branchRevision: revision.revision, proposalId: null, recordedAt: at };
}
function addRevision(branch, snapshot, actor, reason, at) {
  if (branch.revisions.length >= 50) fail('ENTERPRISE_BRANCH_REVISION_LIMIT', 'This branch reached its 50-revision history limit.');
  snapshot.id = `blueprint-${randomUUID()}`; snapshot.createdAt = at; snapshot.epistemicStatus = 'proposed-design';
  const revision = branch.revisions.length + 1;
  branch.revisions.push({ revision, snapshot, snapshotHash: digest(snapshot), recordedAt: at, recordedBy: actor, reason });
  return branch.revisions.at(-1);
}
export function applyEnterpriseBranchCommand(project, command, actor, { authzGeneration = null, membershipGeneration = null } = {}) {
  const at = new Date().toISOString(); const current = latestBlueprint(project);
  if (!current) fail('BLUEPRINT_NOT_FOUND', 'Save the initial blueprint before creating a branch.');
  let branch; let head; let affectedObjectId = null; let candidateId = null; let candidateHash = null; let blueprint = current;
  if (command.kind === 'create-branch') {
    project.enterpriseBranches ??= [];
    if (project.enterpriseBranches.length >= 20) fail('ENTERPRISE_BRANCH_LIMIT', 'This project reached its 20-branch history limit.');
    const chosen = command.proposalId ? verifiedProposal(project, command.proposalId) : null;
    const source = chosen?.proposal.snapshot ?? project.blueprintVersions.find((entry) => entry.id === command.blueprintId && entry.version === command.blueprintVersion);
    const base = chosen?.base ?? source;
    if (!source || source.id !== command.blueprintId || source.version !== command.blueprintVersion) fail('ENTERPRISE_BLUEPRINT_STALE', 'The exact branch source was not found in this project.');
    branch = { id: `enterprise-branch-${randomUUID()}`, title: command.title, status: 'DRAFT', createdAt: at, createdBy: actor,
      baseBlueprintId: base.id, baseBlueprintVersion: base.version, baseSnapshotHash: digest(base),
      sourceKind: chosen ? 'FUTURE_PROPOSAL' : 'MAIN_DESIGN', sourceProposalId: chosen?.proposal.id ?? null,
      sourceSnapshotHash: digest(source), revisions: [], candidates: [] };
    head = addRevision(branch, clone(source), actor, command.reason, at); project.enterpriseBranches.push(branch);
  } else {
    ({ branch, head } = verifiedBranch(project, command.branchId));
    const merging = ['prepare-merge', 'review-merge', 'apply-reviewed-merge'].includes(command.kind);
    assertActiveHead(branch, head, command, { main: merging ? current : null });
    if (command.kind === 'edit-branch-object' || command.kind === 'edit-branch-scope') {
      const draftProject = { blueprintVersions: [clone(head.snapshot)], audit: [] };
      let next;
      if (command.kind === 'edit-branch-object') {
        next = editBlueprintObject(draftProject, command.edit, actor); affectedObjectId = command.edit.objectId;
      } else {
        const change = { ...command.change, blueprintId: head.snapshot.id, blueprintVersion: head.snapshot.version };
        const result = applyEnterpriseCommand(draftProject, change, actor); next = result.blueprint; affectedObjectId = result.affectedObjectId;
      }
      if (!next.integrity?.valid) fail('ENTERPRISE_MERGE_INVALID', 'The draft edit would invalidate typed design references.');
      head = addRevision(branch, next, actor, command.reason, at);
    } else if (command.kind === 'set-branch-validity') {
      const next = clone(head.snapshot);
      next.enterpriseValidity = { effectiveFrom: command.effectiveFrom, effectiveTo: command.effectiveTo,
        evidenceKind: 'HUMAN_PROPOSED', recordedBy: actor, recordedAt: at, reason: command.reason };
      if (same(next.enterpriseValidity.effectiveFrom, head.snapshot.enterpriseValidity?.effectiveFrom)
        && same(next.enterpriseValidity.effectiveTo, head.snapshot.enterpriseValidity?.effectiveTo)) fail('ENTERPRISE_NO_CHANGE', 'This does not change the draft validity dates.');
      head = addRevision(branch, next, actor, command.reason, at);
    } else if (command.kind === 'prepare-merge') {
      if (branch.candidates.length >= 20) fail('ENTERPRISE_MERGE_CANDIDATE_LIMIT', 'This branch reached its 20-candidate review history limit.');
      const merged = mergeSnapshot(project, branch, head, command.resolutions);
      const changes = compareResult(current, merged.snapshot);
      const displayedValues = [changes, merged.relations];
      const core = { id: `enterprise-merge-${randomUUID()}`, createdAt: at, createdBy: actor,
        branchId: branch.id, branchRevision: head.revision, branchSnapshotHash: head.snapshotHash,
        baseBlueprintId: branch.baseBlueprintId, baseSnapshotHash: branch.baseSnapshotHash,
        mainBlueprintId: current.id, mainBlueprintVersion: current.version, mainSnapshotHash: digest(current),
        resolutions: clone(command.resolutions), snapshot: merged.snapshot, snapshotHash: digest(merged.snapshot),
        changes, relations: merged.relations, referenceNames: { current: referenceNames(current, displayedValues),
          proposed: referenceNames(merged.snapshot, displayedValues) } };
      const candidate = { ...core, hash: digest(core), review: null };
      branch.candidates.push(candidate); candidateId = candidate.id; candidateHash = candidate.hash;
    } else if (command.kind === 'review-merge') {
      const candidate = candidateFor(project, branch, head, command);
      if (candidate.review) fail('ENTERPRISE_MERGE_ALREADY_REVIEWED', 'This candidate already has a saved human decision. Prepare a new candidate for another review.');
      candidate.review = { decision: command.decision, principal: actor, authzGeneration, membershipGeneration, recordedAt: at, reason: command.reason };
      candidateId = candidate.id; candidateHash = candidate.hash;
    } else if (command.kind === 'apply-reviewed-merge') {
      const candidate = candidateFor(project, branch, head, command);
      enterpriseMergeApproval(project, command);
      const eligibility = enterpriseMergeEligibility(candidate.snapshot, at);
      if (['FUTURE', 'EXPIRED'].includes(eligibility.status)) fail('ENTERPRISE_MERGE_NOT_EFFECTIVE', 'This candidate is outside its declared validity interval. Keep the design in its branch or prepare an explicitly reviewed interval change.');
      const next = clone(candidate.snapshot);
      next.id = `blueprint-${randomUUID()}`; next.version = Math.max(...project.blueprintVersions.map((entry) => entry.version)) + 1;
      next.createdAt = at; next.epistemicStatus = 'proposed-design';
      next.merge = { branchId: branch.id, branchRevision: head.revision, candidateId: candidate.id, candidateHash: candidate.hash,
        reviewedBy: candidate.review.principal, reviewedAt: candidate.review.recordedAt, appliedBy: actor, appliedAt: at, reason: command.reason };
      const changedIds = [...new Set(candidate.changes.map((row) => row.objectId).filter(Boolean))];
      for (const object of blueprintObjects(next).filter((entry) => changedIds.includes(entry.id))) {
        object.provenance ??= [];
        object.provenance.push({ source: 'workspace:enterprise-merge', actor, at, reason: command.reason,
          branchId: branch.id, branchRevision: head.revision, candidateId: candidate.id, candidateHash: candidate.hash,
          fields: candidate.changes.filter((row) => row.objectId === object.id).map((row) => row.field),
          note: 'Applied an explicitly reviewed proposed-design merge; no work or external effect authority is granted.' });
      }
      const selectedId = changedIds.length === 1 ? changedIds[0] : null;
      next.edit = { actor, at, objectId: selectedId, objectIds: changedIds, objectType: selectedId
        ? blueprintObjects(next).find((object) => object.id === selectedId)?.type ?? 'blueprint' : 'blueprint',
        changedFields: selectedId ? candidate.changes.filter((row) => row.objectId === selectedId).map((row) => row.field) : ['enterpriseMerge'],
        before: selectedId ? clone(blueprintObjects(current).find((object) => object.id === selectedId)) ?? {} : {},
        after: selectedId ? clone(blueprintObjects(next).find((object) => object.id === selectedId)) ?? {} : {},
        relationsBefore: clone(current.relations), relationsAfter: clone(next.relations), reason: command.reason };
      project.blueprintVersions.push(next); blueprint = next; affectedObjectId = selectedId;
      branch.status = 'MERGED'; branch.mergedAt = at; branch.mergedBy = actor; branch.mergedBlueprintId = next.id;
      candidate.appliedBlueprintId = next.id; candidate.appliedAt = at; candidateId = candidate.id; candidateHash = candidate.hash;
    } else if (command.kind === 'abandon-branch') {
      branch.status = 'ABANDONED'; branch.abandonedAt = at; branch.abandonedBy = actor; branch.abandonReason = command.reason;
    }
  }
  project.audit ??= [];
  project.audit.push({ at, action: `enterprise.${command.kind}`, actor, detail: `${command.kind}: “${branch.title}”. This changes proposed design only.` });
  return { blueprint, affectedObjectId, branchId: branch.id, branchRevision: head.revision,
    candidateId, candidateHash, proposalId: null, recordedAt: at };
}
function compareResult(before, after) {
  const fake = { blueprintVersions: [before] };
  const branch = { baseBlueprintId: before.id, baseBlueprintVersion: before.version, revisions: [{ snapshot: after }] };
  return compareEnterpriseBranch(fake, branch).changes.filter((row) => row.branchChanged);
}
function branchSummary(branch, savedBy = () => true) {
  const head = branch.revisions.filter((entry) => savedBy(entry.recordedAt)).at(-1);
  const status = branch.mergedAt && savedBy(branch.mergedAt) ? 'MERGED'
    : branch.abandonedAt && savedBy(branch.abandonedAt) ? 'ABANDONED' : 'DRAFT';
  return { id: branch.id, title: branch.title, status, createdAt: branch.createdAt, createdBy: branch.createdBy,
    baseBlueprintId: branch.baseBlueprintId, baseBlueprintVersion: branch.baseBlueprintVersion, baseSnapshotHash: branch.baseSnapshotHash,
    sourceKind: branch.sourceKind, sourceProposalId: branch.sourceProposalId, headRevision: head?.revision ?? null,
    headBlueprintId: head?.snapshot.id ?? null, headSnapshotHash: head?.snapshotHash ?? null };
}
export function projectEnterpriseBranches(project, query = {}) {
  const savedBy = (at) => !query.recordedAt || Date.parse(at) <= Date.parse(query.recordedAt);
  const all = (project.enterpriseBranches ?? []).map((entry) => verifiedBranch(project, entry.id).branch);
  const branches = all.filter((entry) => savedBy(entry.createdAt)).map((branch) => branchSummary(branch, savedBy));
  if (!query.branchId) return { branches, branch: null, blueprint: null, recordedAt: null, revision: null, writable: false };
  const { branch, head } = verifiedBranch(project, query.branchId);
  if (!savedBy(branch.createdAt)) fail('ENTERPRISE_CONTEXT_NOT_RECORDED', 'This branch was not yet created at the selected cutoff.', 404);
  const recorded = branch.revisions.filter((entry) => savedBy(entry.recordedAt));
  const visibleHead = recorded.at(-1);
  const recordedMain = project.blueprintVersions.filter((entry) => savedBy(entry.createdAt));
  const comparisonMain = query.effectiveAt ? recordedMain.filter((entry) => effectiveStatus(entry, query.effectiveAt) === 'IN_RANGE').at(-1)
    : recordedMain.at(-1);
  const selected = query.branchRevision == null ? recorded.at(-1) ?? null : branch.revisions.find((entry) => entry.revision === query.branchRevision);
  if (!selected && query.branchRevision != null) fail('ENTERPRISE_BRANCH_REVISION_NOT_FOUND', 'The draft revision was not found in this branch.', 404);
  if (selected && !savedBy(selected.recordedAt)) fail('ENTERPRISE_CONTEXT_NOT_RECORDED', 'This draft revision was not yet saved at the selected cutoff.', 404);
  const writable = branch.status === 'DRAFT' && selected?.revision === head.revision && !query.recordedAt && !query.effectiveAt;
  const latestCandidate = (branch.candidates ?? []).filter((entry) => savedBy(entry.createdAt)).at(-1) ?? null;
  let candidate = null;
  if (latestCandidate) {
    const currentMain = project.blueprintVersions.filter((entry) => savedBy(entry.createdAt)).at(-1);
    const current = candidateCurrent(project, branch, visibleHead, latestCandidate, currentMain);
    const review = latestCandidate.review && savedBy(latestCandidate.review.recordedAt) ? clone(latestCandidate.review) : null;
    const applied = latestCandidate.appliedAt && savedBy(latestCandidate.appliedAt);
    const candidateMain = project.blueprintVersions.find((entry) => entry.id === latestCandidate.mainBlueprintId
      && entry.version === latestCandidate.mainBlueprintVersion && digest(entry) === latestCandidate.mainSnapshotHash);
    const candidateNames = latestCandidate.referenceNames ?? { current: referenceNames(candidateMain, [latestCandidate.changes, latestCandidate.relations]),
      proposed: referenceNames(latestCandidate.snapshot, [latestCandidate.changes, latestCandidate.relations]) };
    candidate = { id: latestCandidate.id, hash: latestCandidate.hash, status: applied ? 'APPLIED'
      : !current ? 'STALE' : review?.decision === 'ACCEPT' ? 'ACCEPTED' : review?.decision === 'REJECT' ? 'REJECTED' : 'PENDING',
      branchRevision: latestCandidate.branchRevision, mainBlueprintId: latestCandidate.mainBlueprintId, mainBlueprintVersion: latestCandidate.mainBlueprintVersion,
      createdAt: latestCandidate.createdAt, createdBy: latestCandidate.createdBy, resolutions: clone(latestCandidate.resolutions),
      changes: clone(latestCandidate.changes), relations: clone(latestCandidate.relations),
      referenceNames: clone(candidateNames), review,
      eligibility: enterpriseMergeEligibility(latestCandidate.snapshot, query.effectiveAt ?? query.recordedAt ?? new Date().toISOString()) };
  }
  return { branches, blueprint: selected ? clone(selected.snapshot) : null, recordedAt: selected?.recordedAt ?? null,
    revision: selected?.revision ?? null, writable,
    branch: { ...branchSummary(branch, savedBy), revision: selected?.revision ?? null, isHead: selected?.revision === visibleHead?.revision,
      revisions: recorded.map(({ revision, snapshot, snapshotHash, recordedAt, recordedBy }) => ({ revision, blueprintId: snapshot.id, snapshotHash, recordedAt, recordedBy })),
      comparison: selected && comparisonMain ? compareEnterpriseBranch(project, branch, selected, comparisonMain) : null, candidate } };
}
