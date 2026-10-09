import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects } from './types.mjs';

export const DERIVED_INPUT_MANIFEST_VERSION = '1';

function referencedEconomicRecords(blueprint, economicsId) {
  const objects = blueprintObjects(blueprint);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const economics = byId.get(economicsId);
  if (economics?.type !== 'economics' || !economics.economicScenario) return null;
  const scenario = economics.economicScenario;
  const ids = new Set([economics.id, scenario.offeringId, ...scenario.processIds]);
  for (const demand of scenario.resourceDemands) {
    ids.add(demand.resourceId);
    ids.add(demand.processId);
  }
  // The evaluator also reads process resource links and every allocation in a
  // referenced resource plan. Walk that reference closure, not just the first
  // scenario layer, so allocated processes' own resource links are also pinned.
  const queue = [...ids]; const visited = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const object = byId.get(id);
    const add = (referenceId) => {
      if (typeof referenceId !== 'string') return;
      ids.add(referenceId);
      if (!visited.has(referenceId)) queue.push(referenceId);
    };
    if (object?.type === 'process') for (const resourceId of object.resources ?? []) add(resourceId);
    if (object?.type === 'resource') for (const window of object.resourcePlan?.windows ?? []) {
      for (const allocation of window.allocations ?? []) add(allocation.processId);
    }
  }
  const records = [...ids].sort().map((id) => {
    const object = byId.get(id);
    if (!object) return null;
    return { id, type: object.type, contentHash: digest(object) };
  });
  if (records.some((entry) => entry === null)) return null;
  return records;
}

export function buildEconomicInputManifest(projectId, blueprint, economicsId) {
  if (!projectId || !blueprint?.id || !Number.isSafeInteger(blueprint.version)) return null;
  const records = referencedEconomicRecords(blueprint, economicsId);
  if (!records?.length) return null;
  return {
    schemaVersion: DERIVED_INPUT_MANIFEST_VERSION,
    evaluator: 'declared-economics-1.0',
    source: { projectId, blueprintId: blueprint.id, blueprintVersion: blueprint.version,
      snapshotHash: digest(blueprint) },
    records,
  };
}

export function classifyEconomicInputProvenance(evaluation, projectId, blueprint) {
  const untracked = (reason) => ({ status: 'UNTRACKED', resultStatus: 'UNKNOWN', mandatoryEvaluationEligible: false,
    approvalEligible: false, reason });
  const provenance = evaluation?.inputProvenance;
  if (!provenance || provenance.status !== 'TRACKED' || typeof provenance.manifestHash !== 'string') {
    return untracked('No complete immutable input manifest was retained with this derived result.');
  }
  const expected = buildEconomicInputManifest(projectId, blueprint, evaluation.economicsId);
  if (!expected || digest(expected) !== provenance.manifestHash || digest(expected) !== digest(provenance.manifest)) {
    return untracked('The exact source snapshot or one of the consumed source records is unavailable or changed.');
  }
  return { status: 'TRACKED', resultStatus: 'SCENARIO_ONLY', mandatoryEvaluationEligible: false,
    approvalEligible: false, reason: 'All calculation inputs resolve to immutable records in the exact saved blueprint. This scenario result is not business truth and is not approval evidence.',
    manifestHash: provenance.manifestHash, manifest: structuredClone(expected) };
}
