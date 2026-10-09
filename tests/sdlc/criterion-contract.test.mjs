import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from '../../src/sdlc/contracts.mjs';
import { createRequirementCriterionContract, verifyRequirementCriterionContract } from '../../src/sdlc/criterion-contract.mjs';
import { buildProcessBehaviorTestPlan } from '../../src/sdlc/behavior-test-evidence.mjs';

function requirement() {
  const snapshotHash = digest('process snapshot');
  return { id: 'REQ-PROC-123456789abc', priority: 'SHOULD', draftRevision: 0, acceptanceCriteria: ['A saved process outcome is checked.'],
    processTrace: { source: { processSnapshotHash: snapshotHash }, process: { id: 'process-a' },
      scope: { capabilityRefs: [], systemRefs: [], resourceRefs: [] },
      risk: { refs: [{ id: 'risk-a', snapshotHash: digest('risk snapshot') }] }, outcome: { outputRefs: [], metricRefs: [] } } };
}

test('versioned criterion contracts preserve the mandatory floor and exact historical baseline', () => {
  const draft = requirement();
  const first = createRequirementCriterionContract({ requirement: draft, request: { schemaVersion: 1, version: 1,
    criteria: [{ id: 'OUTCOME-1', text: draft.acceptanceCriteria[0], type: 'BUSINESS', mandatory: true,
      sourceRefId: 'process-a', scopeRefId: 'process-a' }] } });
  draft.criterionContract = first;
  draft.criterionContractHistory = [first];
  assert.equal(verifyRequirementCriterionContract(draft), true);
  assert.throws(() => createRequirementCriterionContract({ requirement: draft, request: { schemaVersion: 1, version: 2,
    criteria: [{ id: 'OUTCOME-1', text: draft.acceptanceCriteria[0], type: 'BUSINESS', mandatory: false,
      sourceRefId: 'process-a', scopeRefId: 'process-a' }] } }), /mandatory floor/);
  assert.equal(verifyRequirementCriterionContract({ ...draft, criterionContract: { ...first, mandatoryFloor: [] } }), false,
    'changing the floor without a new authorized contract hash is invalid');
  assert.throws(() => createRequirementCriterionContract({ requirement: draft, request: { schemaVersion: 1, version: 2,
    criteria: [{ id: 'OUTCOME-1', text: draft.acceptanceCriteria[0], type: 'BUSINESS', mandatory: true,
      sourceRefId: 'process-a', scopeRefId: 'risk-a' }] } }), /scope/,
  'risk references cannot be selected as a behavior-test scope');
  const revised = createRequirementCriterionContract({ requirement: { ...draft, priority: 'MUST' }, request: { schemaVersion: 1, version: 2,
    criteria: [{ id: 'OUTCOME-1', text: draft.acceptanceCriteria[0], type: 'BUSINESS', mandatory: true,
      sourceRefId: 'process-a', scopeRefId: 'process-a' }] } });
  assert.equal(verifyRequirementCriterionContract({ ...draft, priority: 'MUST' }, first, { historical: true }), true,
    'historical criteria remain verifiable under their captured original priority');
  assert.equal(revised.priority, 'MUST');
  assert.equal(verifyRequirementCriterionContract(requirement()), false,
    'legacy text criteria remain unclassified until an owner records an explicit contract');
});

test('a mandatory guardrail cannot be omitted from a pre-run behavior plan', () => {
  const processHash = digest('process snapshot'); const blueprintHash = digest('blueprint snapshot');
  const riskHash = digest('risk snapshot'); const bindingHash = digest('binding');
  const requirement = { id: 'REQ-PROC-123456789abc', priority: 'MUST', draftRevision: 2,
    acceptanceCriteria: ['The declared outcome is produced.', 'The linked guardrail blocks unsafe output.'],
    verificationContract: {},
    processTrace: { traceHash: digest('trace'), source: { blueprintId: 'blueprint-a', blueprintVersion: 1,
      blueprintSnapshotHash: blueprintHash, processSnapshotHash: processHash, bindingHash },
    process: { id: 'process-a', inputs: [], outputs: [] },
    scope: { capabilityRefs: [], systemRefs: [], resourceRefs: [] },
    risk: { status: 'LINKED', refs: [{ id: 'risk-a', snapshotHash: riskHash }] },
    outcome: { outputRefs: [{ id: 'output-a', type: 'decision', snapshotHash: digest('output') }], metricRefs: [] } } };
  requirement.criterionContract = createRequirementCriterionContract({ requirement: { ...requirement, draftRevision: 1 },
    request: { schemaVersion: 1, version: 1, criteria: [
      { id: 'OUTCOME', text: requirement.acceptanceCriteria[0], type: 'BUSINESS', mandatory: true,
        sourceRefId: 'process-a', scopeRefId: 'process-a' },
      { id: 'GUARDRAIL', text: requirement.acceptanceCriteria[1], type: 'GUARDRAIL', mandatory: true,
        sourceRefId: 'risk-a', scopeRefId: 'process-a' },
    ] } });
  const checkPlan = { planHash: digest('checks'), requiredChecks: [{ id: 'unit-check', version: '1', commandHash: digest('command') }] };
  const repository = { kind: 'github-app', source: { snapshotId: digest('snapshot') }, treeDigest: digest('tree'),
    selectedFiles: [{ path: 'src/flow.mjs', mode: '100644', size: 1, contentHash: digest('file') }] };
  const common = { outcomeRefId: 'output-a', scopeRefId: 'process-a', riskRefId: 'risk-a', checkId: 'unit-check' };
  assert.throws(() => buildProcessBehaviorTestPlan({ request: { assertions: [{ ...common, id: 'only-outcome',
    testName: 'only outcome assertion', criterionIndex: 0, criterionId: 'OUTCOME' }],
    fileMappings: [{ path: 'src/flow.mjs', role: 'IMPLEMENTATION', criterionIds: ['OUTCOME'] }] },
  changeCase: { id: 'case-a', tenantId: 'tenant-a', projectId: 'project-a', artifacts: { requirements: { draftRevision: 2 } } },
  requirement, project: { id: 'project-a' }, plan: { id: 'process-plan-a', revision: 1, snapshotHash: digest('plan') },
  task: { id: 'task-a' }, checkPlan, repository, principal: 'oidc:owner' }), /exactly one behavior assertion/);
});
