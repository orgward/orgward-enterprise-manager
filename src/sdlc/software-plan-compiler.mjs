import { digest } from './contracts.mjs';
import { verifyAcceptedG6Plan } from './engine.mjs';

export const LEGACY_SOFTWARE_PLAN_COMPILER_VERSION = 't28-g6-software-delivery-v1';
export const SOFTWARE_PLAN_COMPILER_VERSION = 't28-g6-software-delivery-v2';

const SUPPORTED_COMPILER_VERSIONS = new Set([
  LEGACY_SOFTWARE_PLAN_COMPILER_VERSION,
  SOFTWARE_PLAN_COMPILER_VERSION,
]);

function identityForBinding(binding, compilerVersion) {
  if (!SUPPORTED_COMPILER_VERSIONS.has(compilerVersion)) throw new Error('Unsupported software delivery compiler version.');
  const identity = {
    projectId: binding.projectId,
    g6PlanHash: binding.g6PlanHash,
    compilerVersion,
  };
  if (compilerVersion === SOFTWARE_PLAN_COMPILER_VERSION) {
    Object.assign(identity, {
      caseId: binding.caseId,
      sourceHash: binding.sourceHash,
      blueprintId: binding.blueprintId,
      blueprintVersion: binding.blueprintVersion,
      sourceObjectId: binding.sourceObjectId,
      sourceObjectType: binding.sourceObjectType,
    });
  }
  return identity;
}

export function softwareDeliveryIdentity(binding, g6WorkItemIds, compilerVersion = SOFTWARE_PLAN_COMPILER_VERSION) {
  const identity = identityForBinding(binding, compilerVersion);
  const taskIds = Object.fromEntries(g6WorkItemIds.map((g6WorkItemId) => [g6WorkItemId,
    `software-task-${digest({ ...identity, g6WorkItemId }).slice(0, 32)}`]));
  return {
    generationKey: digest(identity),
    planId: `software-delivery-${digest(identity).slice(0, 32)}`,
    taskIds,
  };
}

export function compileSoftwareDeliveryDraft(changeCase, { compilerVersion = SOFTWARE_PLAN_COMPILER_VERSION } = {}) {
  const integrity = verifyAcceptedG6Plan(changeCase);
  if (!integrity.valid) {
    const error = new Error(integrity.reason);
    error.statusCode = 409;
    error.code = 'G6_PLAN_INTEGRITY_INVALID';
    throw error;
  }
  const requirements = changeCase.artifacts.requirements.acceptedBaseline;
  const architecture = changeCase.artifacts.architecture.acceptedBaseline;
  const g6 = changeCase.artifacts.plan;
  const binding = {
    projectId: changeCase.sourceBinding.projectId,
    caseId: changeCase.id,
    compilerVersion,
    sourceHash: changeCase.sourceBinding.sourceHash,
    projectVersion: changeCase.sourceBinding.projectVersion,
    blueprintId: changeCase.sourceBinding.blueprintId,
    blueprintVersion: changeCase.sourceBinding.blueprintVersion,
    blueprintSchemaVersion: changeCase.sourceBinding.blueprintSchemaVersion,
    sourceObjectId: changeCase.sourceBinding.objectId,
    sourceObjectType: changeCase.sourceBinding.objectType,
    intentHash: changeCase.intent.contentHash,
    requirementsBaselineVersion: requirements.version,
    requirementsBaselineHash: requirements.contentHash,
    architectureBaselineVersion: architecture.version,
    architectureBaselineHash: architecture.draftHash,
    g6PlanHash: g6.contentHash,
  };
  const identities = softwareDeliveryIdentity(binding, g6.workItems.map((item) => item.id), compilerVersion);
  const generationKey = identities.generationKey;
  const taskIds = new Map(Object.entries(identities.taskIds));
  const tasks = g6.workItems.map((item) => ({
    id: taskIds.get(item.id),
    g6WorkItemId: item.id,
    title: item.objective,
    status: 'DRAFT',
    dependencies: item.dependencies.map((dependency) => taskIds.get(dependency)),
    requirementRefs: [...item.requirementRefs],
    decisionRefs: [...item.decisionRefs],
    contextPackageRef: item.contextPackageRef,
    architectureBaselineHash: item.architectureBaselineHash,
    g6PlanHash: g6.contentHash,
  }));
  const core = {
    schemaVersion: 1,
    kind: 'software_delivery',
    id: identities.planId,
    generationKey,
    compilerVersion,
    status: 'DRAFT',
    binding,
    tasks,
  };
  return { ...core, contentHash: digest(core) };
}

export function verifySoftwareDeliveryDraft(changeCase, draft) {
  try {
    const expected = compileSoftwareDeliveryDraft(changeCase, { compilerVersion: draft?.compilerVersion });
    return Boolean(draft && draft.contentHash === expected.contentHash
      && digest(Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'contentHash'))) === draft.contentHash);
  } catch { return false; }
}
