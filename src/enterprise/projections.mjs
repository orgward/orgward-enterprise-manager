import { graphForBlueprint, latestBlueprint } from '../model.mjs';
import { ENTERPRISE_LENSES, ENTERPRISE_SCOPE_TYPES, blueprintObjects, enterpriseFailure, enterpriseScopeErrors, scopeState } from './types.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { effectiveStatus, enterpriseInstant, objectStates } from './state.mjs';
import { projectEnterpriseBranches } from './branches.mjs';
import { PROCESS_MODEL } from './process-model.mjs';
import { projectEconomicPortfolio } from './economics-scenario.mjs';
import { projectRefinementTrace } from './refinement.mjs';
import { projectEnterpriseIntegrity } from './integrity.mjs';
import { projectEnterpriseSentinel } from './sentinel.mjs';
import { projectEnterpriseGovernance } from './governance.mjs';
import { projectEnterpriseStewardship } from './stewardship.mjs';
import { projectEnterpriseSourceAttestationPushStatus, projectEnterpriseSourceReconciliationCurrentness } from './source-attestation.mjs';
import { verifyEnterpriseConceptSchemas } from './concept-schemas.mjs';

export function normalizeEnterpriseQuery(input = {}) {
  const accepted = ['lensId', 'scopeId', 'blueprintVersion', 'selectedId', 'proposalId', 'effectiveAt', 'recordedAt', 'branchId', 'branchRevision', 'simulationId', 'economicEvaluationId'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !accepted.includes(key))) {
    throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'Choose a supported lens, scope, saved blueprint version and selection.');
  }
  const lensId = input.lensId || 'all';
  if (lensId !== 'all' && !ENTERPRISE_LENSES.some((lens) => lens.id === lensId)) {
    throw enterpriseFailure('ENTERPRISE_LENS_NOT_FOUND', 'Choose all objects or one of the sixteen named perspectives.');
  }
  const query = { lensId, scopeId: input.scopeId || null, selectedId: input.selectedId || null, blueprintVersion: null,
    proposalId: input.proposalId ?? null, effectiveAt: input.effectiveAt == null ? null : enterpriseInstant(input.effectiveAt, 'Effective time'),
    recordedAt: input.recordedAt == null ? null : enterpriseInstant(input.recordedAt, 'Recorded-time cutoff'),
    branchId: input.branchId ?? null, branchRevision: null, simulationId: input.simulationId ?? null,
    economicEvaluationId: input.economicEvaluationId ?? null };
  if (query.proposalId !== null && !/^enterprise-proposal-[0-9a-f-]{36}$/.test(query.proposalId)) throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'Choose a saved future proposal identifier.');
  if (query.branchId !== null && !/^enterprise-branch-[0-9a-f-]{36}$/.test(query.branchId)) throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'Choose a saved branch identifier.');
  if (query.simulationId !== null && !/^process-simulation-[0-9a-f-]{36}$/.test(query.simulationId)) throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'Choose an exact saved simulation identifier.');
  if (query.economicEvaluationId !== null && !/^economic-evaluation-[0-9a-f-]{36}$/.test(query.economicEvaluationId)) throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'Choose an exact saved economic evaluation identifier.');
  if (input.branchRevision != null) {
    if (!query.branchId || !/^[1-9][0-9]*$/.test(String(input.branchRevision)) || !Number.isSafeInteger(Number(input.branchRevision))) {
      throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'Choose a positive saved revision within the selected branch.');
    }
    query.branchRevision = Number(input.branchRevision);
  }
  for (const field of ['scopeId', 'selectedId']) {
    if (query[field] !== null && (typeof query[field] !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(query[field]))) {
      throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', `${field} must identify a saved design record.`);
    }
  }
  if (input.blueprintVersion != null && input.blueprintVersion !== '') {
    const value = String(input.blueprintVersion);
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'The saved blueprint version must be a positive integer.');
    }
    query.blueprintVersion = Number(value);
  }
  if (query.proposalId && query.blueprintVersion !== null) throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'Choose a main version or a future proposal, rather than both.');
  if (query.branchId && (query.proposalId || query.blueprintVersion !== null)) throw enterpriseFailure('INVALID_ENTERPRISE_CONTEXT', 'Choose a branch, main version or future proposal as the source context.');
  return query;
}
export function projectEnterprise(project, query = {}, authority = {}) {
  const context = normalizeEnterpriseQuery(query);
  const current = latestBlueprint(project);
  const branchContext = projectEnterpriseBranches(project, context);
  const savedBy = (at) => !context.recordedAt || (typeof at === 'string' && Number.isFinite(Date.parse(at)) && Date.parse(at) <= Date.parse(context.recordedAt));
  const recorded = project.blueprintVersions.filter((entry) => savedBy(entry.createdAt));
  const proposals = (project.enterpriseProposals ?? []).map((proposal) => {
    const { proposalHash, ...core } = proposal;
    const base = project.blueprintVersions.find((entry) => entry.id === proposal.baseBlueprintId && entry.version === proposal.baseBlueprintVersion);
    if (digest(core) !== proposalHash || digest(proposal.snapshot) !== proposal.snapshotHash || !base || digest(base) !== proposal.baseSnapshotHash) {
      throw enterpriseFailure('ENTERPRISE_PROPOSAL_INTEGRITY', 'A saved future proposal failed its immutable source or snapshot checks.', 409);
    }
    return { ...proposal, baseStale: current?.id !== proposal.baseBlueprintId || digest(current) !== proposal.baseSnapshotHash };
  });
  const proposal = context.proposalId ? proposals.find((entry) => entry.id === context.proposalId) : null;
  if (context.proposalId && !proposal) throw enterpriseFailure('ENTERPRISE_PROPOSAL_NOT_FOUND', 'The future proposal was not found in this project.', 404);
  let blueprint = context.branchId ? branchContext.blueprint : proposal?.snapshot ?? (context.blueprintVersion === null
    ? recorded.at(-1) ?? null : project.blueprintVersions.find((entry) => entry.version === context.blueprintVersion));
  if (!blueprint && context.blueprintVersion !== null) throw enterpriseFailure('ENTERPRISE_BLUEPRINT_NOT_FOUND', 'The saved blueprint version was not found in this project.', 404);
  if (blueprint && !savedBy(context.branchId ? branchContext.recordedAt : proposal?.recordedAt ?? blueprint.createdAt)) {
    throw enterpriseFailure('ENTERPRISE_CONTEXT_NOT_RECORDED', 'This snapshot was not yet saved at the selected recorded-time cutoff.', 404);
  }
  let applicability = context.effectiveAt ? effectiveStatus(blueprint, context.effectiveAt) : 'UNKNOWN';
  if (context.effectiveAt && !proposal && !context.branchId && context.blueprintVersion === null) {
    const matching = recorded.filter((entry) => effectiveStatus(entry, context.effectiveAt) === 'IN_RANGE');
    blueprint = matching.at(-1) ?? null;
    applicability = blueprint ? 'IN_RANGE' : recorded.some((entry) => !entry.enterpriseValidity?.effectiveFrom) ? 'UNKNOWN' : 'OUT_OF_RANGE';
  }
  const objects = blueprintObjects(blueprint);
  const scopeErrors = enterpriseScopeErrors(objects);
  if (scopeErrors.length) throw enterpriseFailure('INVALID_ENTERPRISE_SCOPE', 'The saved blueprint has invalid organizational scope references. Repair its design before exploring these perspectives.', 409);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const scope = context.scopeId ? byId.get(context.scopeId) : null;
  if (blueprint && context.scopeId && !ENTERPRISE_SCOPE_TYPES.includes(scope?.type)) {
    throw enterpriseFailure('ENTERPRISE_SCOPE_NOT_FOUND', 'The selected scope is not present in this saved blueprint.', 404);
  }
  const inScope = (object) => !scope || (scope.type === 'organization' ? object.enterpriseScope?.organizationId === scope.id
    : scope.type === 'legal-entity' ? object.enterpriseScope?.legalEntityId === scope.id : object.enterpriseScope?.unitId === scope.id);
  const lens = ENTERPRISE_LENSES.find((entry) => entry.id === context.lensId);
  const inLens = (object) => !lens?.types || lens.types.includes(object.type);
  const visible = new Set(objects.filter((object) => inScope(object) && inLens(object)).map((object) => object.id));
  const canonicalGraph = graphForBlueprint(blueprint);
  const graph = { nodes: canonicalGraph.nodes.filter((node) => visible.has(node.id)).map((node) => ({ ...structuredClone(node),
    enterpriseScope: structuredClone(byId.get(node.id).enterpriseScope ?? null), scopeState: scopeState(byId.get(node.id)),
    states: objectStates(byId.get(node.id)) })),
  links: structuredClone(canonicalGraph.links.filter((relation) => visible.has(relation.source) && visible.has(relation.target))),
  types: [...new Set(objects.filter((object) => visible.has(object.id)).map((object) => object.type))].sort() };
  const selected = context.selectedId ? byId.get(context.selectedId) : null;
  if (blueprint && context.selectedId && !selected) throw enterpriseFailure('ENTERPRISE_OBJECT_NOT_FOUND', 'The selected object is not present in this saved blueprint.', 404);
  const hiddenBy = selected ? [...(!inScope(selected) ? ['scope'] : []), ...(!inLens(selected) ? ['lens'] : [])] : [];
  const isCurrent = Boolean(blueprint && current?.id === blueprint.id && !proposal && !context.branchId && !context.effectiveAt && !context.recordedAt);
  const gaps = [
    { code: 'PROPOSED_DESIGN_ONLY', message: 'These perspectives show saved organizational design. They do not establish enabled operations or verified outcomes.' },
    { code: 'PROPOSED_MERGE_ONLY', message: 'Reviewed branch merges change current proposed design. Internal publication and work or effect approvals remain separate.' },
    { code: 'PROPOSED_DESIGN_RELATIONSHIPS_ONLY', message: 'Refinement links and imported edits describe proposed-design relationships only; they do not establish execution or independent evidence.' },
  ];
  if (!blueprint) gaps.unshift({ code: current ? 'TEMPORAL_CONTEXT_UNKNOWN' : 'BLUEPRINT_REQUIRED',
    message: current ? 'No saved main snapshot has known applicability at these dates. Missing effective dates remain unknown; no current-design fallback was used.'
      : 'Save the initial blueprint to explore and define enterprise scopes.' });
  if (!blueprint && context.selectedId) gaps.push({ code: 'TEMPORAL_SELECTION_UNAVAILABLE', message: 'The retained selection is unavailable in this dated context.' });
  if (proposal?.baseStale) gaps.push({ code: 'ENTERPRISE_PROPOSAL_BASE_STALE', message: 'The current main design changed after this proposal. Its saved base and proposal remain immutable.' });
  const unknownCount = objects.filter((object) => scopeState(object) === 'UNKNOWN').length;
  if (unknownCount) gaps.push({ code: 'LEGACY_SCOPE_UNKNOWN', message: `${unknownCount} design objects have no recorded organizational scope.`, count: unknownCount });
  const runtimeLensGap = { code: 'DESIGN_EVIDENCE_ONLY', message: 'This perspective includes design records. Case, run, release and independently verified evidence are not included in its graph.' };
  const lenses = ENTERPRISE_LENSES.map((entry) => ({ ...structuredClone(entry),
    gaps: ['L-11', 'L-12', 'L-13', 'L-16'].includes(entry.id) ? [{ ...runtimeLensGap }] : [] }));
  if (lens) gaps.push(...lenses.find((entry) => entry.id === lens.id).gaps.map((gap) => ({ ...gap, lensId: lens.id })));
  const visibleSimulations = (project.enterpriseSimulations ?? []).filter((entry) => savedBy(entry.createdAt));
  const simulations = visibleSimulations.map(({ id, createdAt, createdBy, reason, source, status, meaning, simulationType = 'PROCESS_FLOW', engineVersion, scenarioHash, resultHash, trace }) =>
    ({ id, createdAt, createdBy, reason, source: structuredClone(source), status, meaning, simulationType, engineVersion, scenarioHash, resultHash, traceLength: trace?.length ?? 0 }));
  const snapshotHash = blueprint ? digest(blueprint) : null;
  let simulation = context.simulationId ? (project.enterpriseSimulations ?? []).find((entry) => entry.id === context.simulationId)
    : selected?.type === 'process' ? visibleSimulations.filter((entry) => entry.source.processId === selected.id
      && entry.source.snapshotHash === snapshotHash && entry.source.blueprintId === blueprint.id
      && entry.source.blueprintVersion === blueprint.version && entry.source.branchId === context.branchId
      && entry.source.branchRevision === branchContext.revision && entry.source.proposalId === (proposal?.id ?? null)).at(-1) ?? null : null;
  if (context.simulationId && !simulation) throw enterpriseFailure('PROCESS_SIMULATION_NOT_FOUND', 'The saved simulation was not found in this project.', 404);
  if (simulation && !savedBy(simulation.createdAt)) throw enterpriseFailure('ENTERPRISE_CONTEXT_NOT_RECORDED', 'This simulation was not yet saved at the selected recorded-time cutoff.', 404);
  if (simulation) {
    const { id, createdAt, createdBy, reason, resultHash, ...core } = simulation;
    const source = core.source;
    const sourceSnapshot = source?.branchId ? (project.enterpriseBranches ?? []).find((entry) => entry.id === source.branchId)?.revisions
      .find((entry) => entry.revision === source.branchRevision)?.snapshot
      : source?.proposalId ? (project.enterpriseProposals ?? []).find((entry) => entry.id === source.proposalId)?.snapshot
        : project.blueprintVersions.find((entry) => entry.id === source?.blueprintId && entry.version === source?.blueprintVersion);
    if (digest(core) !== resultHash || digest(core.scenario) !== core.scenarioHash || core.meaning !== 'SIMULATION_ONLY'
      || source?.projectId !== project.id || !sourceSnapshot || sourceSnapshot.id !== source.blueprintId
      || sourceSnapshot.version !== source.blueprintVersion || digest(sourceSnapshot) !== source.snapshotHash
      || !sourceSnapshot.areas || !Object.values(sourceSnapshot.areas).some((area) => (area.items ?? []).some((object) => object.id === source.processId && object.type === 'process'))) {
      throw enterpriseFailure('PROCESS_SIMULATION_INTEGRITY', 'A saved simulation failed its source, scenario or result checks.', 409);
    }
    simulation = structuredClone(simulation);
  }
  const economics = projectEconomicPortfolio(project, blueprint, { selectedId: context.selectedId, recordedAtCutoff: context.recordedAt,
    economicEvaluationId: context.economicEvaluationId, branchId: context.branchId, branchRevision: branchContext.revision,
    proposalId: proposal?.id ?? null });
  const integrity = projectEnterpriseIntegrity(project, blueprint, savedBy);
  const sentinel = projectEnterpriseSentinel(project, blueprint, savedBy);
  const governanceProjection = projectEnterpriseGovernance(project, blueprint, current, savedBy);
  const governance = { ...governanceProjection, cases: governanceProjection.cases.map((entry) => ({ ...entry,
    canAppeal: Boolean(isCurrent && authority.write && authority.human && entry.status === 'DECIDED'
      && entry.requestedBy === authority.actor) })) };
  const stewardship = projectEnterpriseStewardship(project, blueprint, current, savedBy);
  const sandboxTransactions = (project.sandboxTransactions ?? []).filter((entry) => savedBy(entry.approval?.at))
    .map((entry) => structuredClone(entry));
  const sourceProjectionProject = context.recordedAt ? { ...project,
    sourceAcceptanceReceipts: (project.sourceAcceptanceReceipts ?? []).filter((entry) => savedBy(entry.receivedAt)),
    sourceReconciliationReports: (project.sourceReconciliationReports ?? []).filter((entry) => savedBy(entry.receivedAt)),
    sourceReconciliationCurrentness: (project.sourceReconciliationCurrentness ?? []).filter((entry) => savedBy(entry.recordedAt)),
    sourceAttestationProfiles: (project.sourceAttestationProfiles ?? []).filter((entry) => savedBy(entry.recordedAt)),
    sourceAttestationMappingRevisions: (project.sourceAttestationMappingRevisions ?? []).filter((entry) => savedBy(entry.recordedAt)),
    sourceAttestationMappingRepairReceipts: (project.sourceAttestationMappingRepairReceipts ?? []).filter((entry) => savedBy(entry.recordedAt)),
    sourceAttestationManifestReceipts: (project.sourceAttestationManifestReceipts ?? []).filter((entry) => savedBy(entry.receivedAt)),
    sourceAttestationStreams: (project.sourceAttestationStreams ?? []).filter((entry) => savedBy(entry.updatedAt)),
    enterpriseSentinelAssessments: (project.enterpriseSentinelAssessments ?? []).filter((entry) => savedBy(entry.evaluatedAt)),
  } : project;
  const sourceReconciliationCurrentness = projectEnterpriseSourceReconciliationCurrentness(sourceProjectionProject,
    context.recordedAt ?? new Date().toISOString());
  const sourceProfilesRecorded = (sourceProjectionProject.sourceAttestationProfiles ?? []).filter((entry) => savedBy(entry.recordedAt));
  const conceptSchemas = verifyEnterpriseConceptSchemas(project);
  return { context: { projectVersion: project.version, blueprintId: blueprint?.id ?? null, blueprintVersion: blueprint?.version ?? null,
    isCurrent, lensId: context.lensId, scopeId: context.scopeId, branch: context.branchId ?? 'main', proposalId: proposal?.id ?? null,
    branchId: context.branchId, branchRevision: branchContext.revision,
    sourceKind: context.branchId ? 'BRANCH_DRAFT' : proposal ? 'FUTURE_PROPOSAL' : 'MAIN_DESIGN',
    snapshotHash,
    recordedAt: context.branchId ? branchContext.recordedAt : proposal?.recordedAt ?? blueprint?.createdAt ?? null,
    recordedAtCutoff: context.recordedAt, effectiveAt: context.effectiveAt, effectiveStatus: applicability,
    validity: blueprint?.enterpriseValidity ? structuredClone(blueprint.enterpriseValidity) : null,
    selectionUnavailable: !blueprint && Boolean(context.selectedId) }, graph,
    blueprint: blueprint ? structuredClone(blueprint) : null,
    selection: selected ? { object: structuredClone(selected), states: objectStates(selected), visible: visible.has(selected.id), hiddenBy } : null,
    lenses, scopes: objects.filter((object) => ENTERPRISE_SCOPE_TYPES.includes(object.type)).map((object) => ({
      id: object.id, type: object.type, name: object.name, detail: object.detail,
      organizationId: object.enterpriseScope.organizationId, legalEntityId: object.enterpriseScope.legalEntityId,
      parentUnitId: object.parentUnitId ?? null, jurisdiction: object.jurisdiction ?? null, ownerRoleId: object.owner ?? null })),
    versions: recorded.map(({ id, version, createdAt }) => ({ id, version, createdAt })),
    conceptSchemas: conceptSchemas.filter((entry) => savedBy(entry.createdAt)),
    sourceAcceptanceReceipts: (project.sourceAcceptanceReceipts ?? []).filter((entry) => savedBy(entry.receivedAt)).map((entry) => structuredClone(entry)),
    sourceReconciliationReports: (project.sourceReconciliationReports ?? []).filter((entry) => savedBy(entry.receivedAt)).map((entry) => structuredClone(entry)),
    sourceAttestationCorrectionReceipts: (project.sourceAttestationCorrectionReceipts ?? []).filter((entry) => savedBy(entry.createdAt)).map((entry) => structuredClone(entry)),
    sourceAttestationRepairReceipts: (project.sourceAttestationRepairReceipts ?? []).filter((entry) => savedBy(entry.recordedAt)).map((entry) => structuredClone(entry)),
    sourceAttestationMappingRepairReceipts: (project.sourceAttestationMappingRepairReceipts ?? []).filter((entry) => savedBy(entry.recordedAt)).map((entry) => structuredClone(entry)),
    sourceAttestationRecomputeReceipts: (project.sourceAttestationRecomputeReceipts ?? []).filter((entry) => savedBy(entry.recordedAt)).map((entry) => structuredClone(entry)),
    sourceReconciliationCurrentness,
    sourceAttestationMappingRevisions: (project.sourceAttestationMappingRevisions ?? []).filter((entry) => savedBy(entry.recordedAt)).map((entry) => structuredClone(entry)),
    sourceAttestationProfiles: sourceProfilesRecorded.map((entry) => ({
      ...Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'keys')),
      keys: (entry.keys ?? []).map(({ publicKeyPem, ...key }) => key),
      ...(entry.version === sourceProfilesRecorded.filter((profile) => profile.id === entry.id).at(-1)?.version
        ? { pushStatus: projectEnterpriseSourceAttestationPushStatus(sourceProjectionProject, entry, context.recordedAt ?? new Date().toISOString()) } : {}),
    })),
    proposals: proposals.filter((entry) => savedBy(entry.recordedAt) && (!context.effectiveAt || effectiveStatus(entry.snapshot, context.effectiveAt) === 'IN_RANGE'))
      .map(({ id, title, objectId, recordedAt, effectiveFrom, effectiveTo, baseBlueprintId, baseBlueprintVersion, baseSnapshotHash, snapshotHash, proposalHash, status, baseStale }) =>
        ({ id, title, objectId, recordedAt, effectiveFrom, effectiveTo, baseBlueprintId, baseBlueprintVersion, baseSnapshotHash, snapshotHash, proposalHash, status, baseStale })),
    proposal: proposal ? { id: proposal.id, title: proposal.title, status: proposal.status, proposalHash: proposal.proposalHash,
      baseBlueprintId: proposal.baseBlueprintId, baseBlueprintVersion: proposal.baseBlueprintVersion, baseSnapshotHash: proposal.baseSnapshotHash,
      snapshotHash: proposal.snapshotHash, baseStale: proposal.baseStale,
      diff: { before: structuredClone(proposal.snapshot.edit.before), after: structuredClone(proposal.snapshot.edit.after), changedFields: proposal.snapshot.edit.changedFields } } : null,
    branches: branchContext.branches, branch: branchContext.branch, processModel: structuredClone(PROCESS_MODEL), simulations, simulation, economics, integrity, sentinel, governance, sandboxTransactions,
    refinementTrace: projectRefinementTrace(objects, selected?.id), stewardship,
    permissions: { write: isCurrent && Boolean(authority.write), scopeAdmin: isCurrent && Boolean(authority.scopeAdmin),
      sourceAttestationAdmin: isCurrent && Boolean(authority.scopeAdmin && authority.human),
      branchCreate: Boolean(blueprint && !context.branchId && authority.write && authority.human),
      branchWrite: Boolean(branchContext.writable && authority.write && authority.human),
      branchAdmin: Boolean(branchContext.writable && authority.scopeAdmin && authority.human),
      processWrite: Boolean((isCurrent || branchContext.writable) && authority.write && authority.human),
      sandboxExecute: Boolean(isCurrent && authority.scopeAdmin && authority.human),
      simulate: Boolean(blueprint && authority.write && authority.human),
      economicWrite: Boolean((isCurrent || branchContext.writable) && authority.write && authority.human),
      economicEvaluate: Boolean(blueprint && authority.write && authority.human),
      integrityRun: Boolean(isCurrent && authority.write && authority.human),
      integrityException: Boolean(isCurrent && authority.write && authority.human),
      governanceRequest: Boolean(isCurrent && authority.write && authority.human),
      governanceDecide: Boolean(isCurrent && authority.owner && authority.human),
      governanceReviewAppeal: Boolean(isCurrent && authority.owner && authority.human),
      stewardAssign: Boolean(isCurrent && authority.owner && authority.human),
      stewardReview: Boolean(isCurrent && authority.write && authority.human) },
    exclusions: { totalObjects: objects.length, visibleObjects: visible.size,
      scopeUnknownCount: unknownCount, unscopedCount: objects.filter((object) => scopeState(object) === 'UNSCOPED').length,
      filteredByScope: objects.filter((object) => !inScope(object)).length,
      filteredByLens: objects.filter((object) => inScope(object) && !inLens(object)).length }, gaps };
}
