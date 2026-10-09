import { digest } from './contracts.mjs';
import { randomUUID } from 'node:crypto';
import { verifyRequirementCriterionContract } from './criterion-contract.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;

export function buildProcessBehaviorTestPlan({ request, changeCase, requirement, project, plan, task, checkPlan, repository, principal, now = new Date().toISOString() }) {
  if (!request || !changeCase || !requirement?.processTrace || !requirement.verificationContract
    || !project || !plan || !task || !checkPlan || !principal) throw new Error('A pinned requirement, project task and configured check plan are required.');
  const trace = requirement.processTrace;
  const evaluationContext = buildEvaluationContext({ request: request.evaluationContext, trace, project, repository, principal });
  const criterionContract = requirement.criterionContract;
  if (!verifyRequirementCriterionContract(requirement)) throw new Error('Versioned criterion obligations are required; legacy string criteria remain unclassified.');
  const criteria = criterionContract.criteria;
  if (!Array.isArray(criteria) || !criteria.length || criteria.length > 32
    || !Array.isArray(request.assertions) || request.assertions.length !== criteria.length
    || request.assertions.length > 32 || !Array.isArray(checkPlan.requiredChecks) || !checkPlan.requiredChecks.length
    || !repository || repository.kind !== 'github-app' || !repository.source?.snapshotId
    || !HASH.test(repository.treeDigest ?? '') || !Array.isArray(repository.selectedFiles) || !repository.selectedFiles.length) {
    throw new Error('Provide exactly one behavior assertion per criterion and use one fixed configured check for this evaluation.');
  }
  const scopeRefs = [
    { id: trace.process.id, type: 'process', snapshotHash: trace.source.processSnapshotHash },
    ...trace.scope.capabilityRefs, ...trace.scope.systemRefs, ...trace.scope.resourceRefs,
  ];
  const checkById = new Map((checkPlan.requiredChecks ?? []).map((entry) => [entry.id, entry]));
  const selectedCheckIds = new Set(request.assertions.map((entry) => entry?.checkId));
  if (selectedCheckIds.size !== 1) throw new Error('Every declared assertion must use the same configured check so its exact output can be evaluated.');
  const assertionIds = new Set(); const names = new Set(); const criterionIndices = new Set();
  const assertions = request.assertions.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).some((key) => !['id', 'testName', 'criterionIndex', 'criterionId', 'outcomeRefId', 'scopeRefId', 'riskRefId', 'checkId'].includes(key))) {
      throw new Error('An assertion has unsupported fields.');
    }
    const { id, testName, criterionIndex, criterionId, outcomeRefId, scopeRefId, riskRefId, checkId } = raw;
    const criterion = criteria[criterionIndex];
    if (!ID.test(id ?? '') || assertionIds.has(id) || typeof testName !== 'string' || !testName.trim()
      || testName.length > 240 || /[\r\n\x00-\x1f\x7f]/.test(testName) || names.has(testName)
      || !Number.isSafeInteger(criterionIndex) || criterionIndex < 0 || criterionIndex >= criteria.length
      || criterionIndices.has(criterionIndex) || criterionId !== criterion?.id) throw new Error('Assertion identity, test name or criterion mapping is invalid or duplicated.');
    const outcome = trace.outcome.outputRefs.find((entry) => entry.id === outcomeRefId);
    const scope = scopeRefs.find((entry) => entry.id === scopeRefId);
    const riskRef = trace.risk.refs.find((entry) => entry.id === riskRefId);
    const risk = riskRef ? { status: 'LINKED', refs: [structuredClone(riskRef)] }
      : riskRefId === 'UNKNOWN' && trace.risk.status === 'UNKNOWN' && trace.risk.refs.length === 0
        ? { status: 'UNKNOWN', refs: [] } : null;
    const check = checkById.get(checkId);
    if (!outcome || !scope || !risk || !check || scope.id !== criterion.scope.id) {
      throw new Error('Each assertion must map to its exact versioned criterion scope, declared outcome, risk state, and configured check.');
    }
    assertionIds.add(id); names.add(testName); criterionIndices.add(criterionIndex);
    return { id, testName, expected: 'PASS', criterionIndex, criterionId: criterion.id,
      criterionContractVersion: criterionContract.version, criterion: structuredClone(criterion),
      criterionHash: digest(criterion), outcome: structuredClone(outcome), scope: structuredClone(scope),
      risk, source: structuredClone(trace.source),
      check: { id: check.id, version: check.version, commandHash: check.commandHash, planHash: checkPlan.planHash } };
  });
  const fileMappings = request.fileMappings;
  const selectedPathSet = new Set(repository.selectedFiles.map((entry) => entry.path));
  const mappingPaths = new Set();
  if (!Array.isArray(fileMappings) || fileMappings.length !== selectedPathSet.size) throw new Error('Map every exact selected repository path to one or more declared criteria before execution.');
  const normalizedFileMappings = fileMappings.map((mapping) => {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)
      || Object.keys(mapping).some((key) => !['path', 'criterionIds', 'role'].includes(key))
      || typeof mapping.path !== 'string' || !selectedPathSet.has(mapping.path) || mappingPaths.has(mapping.path)
      || !['IMPLEMENTATION', 'TEST', 'CONFIGURATION', 'DOCUMENTATION'].includes(mapping.role)
      || !Array.isArray(mapping.criterionIds) || !mapping.criterionIds.length
      || new Set(mapping.criterionIds).size !== mapping.criterionIds.length
      || mapping.criterionIds.some((criterionId) => !criteria.some((entry) => entry.id === criterionId))) {
      throw new Error('Each selected path must have one unique role and exact criterion mappings.');
    }
    mappingPaths.add(mapping.path);
    return { path: mapping.path, criterionIds: [...mapping.criterionIds].sort(), role: mapping.role };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const caseDefinitions = buildEvaluationCases({ request: request.caseDefinitions, trace, criterionContract,
    principal, assertions, repository, fileMappings: normalizedFileMappings });
  const core = { schemaVersion: 4, id: `behavior-test-plan-${randomUUID()}`,
    tenantId: changeCase.tenantId, projectId: project.id, caseId: changeCase.id,
    requirementId: requirement.id, requirementHash: digest(Object.fromEntries(Object.entries(requirement)
      .filter(([key]) => !['processRunEvidenceLinks', 'processRunEvidenceReviews', 'behaviorTestPlans'].includes(key)))),
    criterionContractVersion: criterionContract.version, criterionContractHash: criterionContract.contentHash,
    draftRevision: changeCase.artifacts.requirements.draftRevision, traceHash: trace.traceHash,
    source: structuredClone(trace.source), processPlan: { id: plan.id, revision: Number(plan.revision),
      hash: plan.snapshotHash ?? digest(plan), taskId: task.id, taskHash: digest(task) },
    repository: structuredClone(repository), repositoryHash: digest(repository), fileMappings: normalizedFileMappings,
    evaluationContext, caseDefinitions,
    checkPlan: { hash: checkPlan.planHash, checks: [...new Set(assertions.map((entry) => entry.check.id))]
      .map((id) => { const check = checkById.get(id); return { id, version: check.version, commandHash: check.commandHash }; }) },
    assertions, status: 'AUTHORIZED_BEFORE_EXECUTION', createdAt: now, createdBy: principal };
  return { ...core, planHash: digest(core) };
}

function traceReferences(trace) {
  return [
    { id: trace.process.id, type: 'process', snapshotHash: trace.source.processSnapshotHash },
    ...(trace.process.inputs ?? []).map((entry) => ({ ...entry, type: 'input' })),
    ...(trace.process.outputs ?? []).map((entry) => ({ ...entry, type: 'output' })),
    ...(trace.scope.capabilityRefs ?? []), ...(trace.scope.systemRefs ?? []), ...(trace.scope.resourceRefs ?? []),
    ...(trace.risk.refs ?? []).map((entry) => ({ ...entry, type: 'risk' })),
    ...(trace.outcome.metricRefs ?? []).map((entry) => ({ ...entry, type: 'metric' })),
  ];
}

function buildEvaluationContext({ request, trace, project, repository, principal }) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).some((key) => !['effectiveAt', 'effectiveTimeSourceRefId'].includes(key))) {
    throw new Error('Enter an effective time and select its exact process input source.');
  }
  const instant = request.effectiveAt;
  if (typeof instant !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(instant)
    || !Number.isFinite(Date.parse(instant)) || new Date(instant).toISOString() !== instant) {
    throw new Error('Effective time must be a valid UTC timestamp with milliseconds.');
  }
  const timeSource = traceReferences(trace).find((entry) => entry.id === request.effectiveTimeSourceRefId && entry.type === 'input');
  const source = repository?.source;
  if (!timeSource || !source || source.type !== 'github-app' || !source.repositoryId || !source.branchRef
    || !source.commitOid || !repository.snapshotId || !repository.treeDigest) {
    throw new Error('Effective time must cite a traced process input and branch context must come from the exact saved repository snapshot.');
  }
  return { schemaVersion: 1,
    workspace: { projectId: project.id, projectVersion: project.version, blueprintId: trace.source.blueprintId,
      blueprintVersion: trace.source.blueprintVersion, processId: trace.process.id, processTraceHash: trace.traceHash },
    branch: { repositoryId: source.repositoryId, branchRef: source.branchRef,
      commitOid: source.commitOid, snapshotId: repository.snapshotId,
      treeDigest: repository.treeDigest },
    effectiveTime: { value: instant, sourceRef: { id: timeSource.id, type: timeSource.type,
      snapshotHash: timeSource.snapshotHash }, assertedBy: principal, status: 'OWNER_ASSERTED' } };
}

function buildEvaluationCases({ request, trace, criterionContract, principal, assertions, repository, fileMappings }) {
  const types = ['positive', 'negative', 'recovery'];
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).sort().join(',') !== types.slice().sort().join(',')) {
    throw new Error('Define positive, negative, and recovery cases before authorizing the behavior plan.');
  }
  const refs = traceReferences(trace);
  const criteria = criterionContract.criteria;
  return { schemaVersion: 1, status: 'OWNER_AUTHORED_NOT_EXECUTED', cases: types.map((type) => {
    const entry = request[type];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((key) => !['assertionId', 'criterionId', 'dataset', 'definition', 'expectedOutput', 'sourceRefId', 'testPath'].includes(key))
      || !['criterionId', 'definition', 'sourceRefId'].every((key) => Object.hasOwn(entry, key))) {
      throw new Error(`The ${type} case must include its definition, criterion, and exact source reference; executable mapping fields are optional but must be complete when supplied.`);
    }
    const definition = typeof entry.definition === 'string' ? entry.definition.trim() : '';
    const source = refs.find((ref) => ref.id === entry.sourceRefId);
    const criterion = criteria.find((candidate) => candidate.id === entry.criterionId);
    const assertion = assertions.find((candidate) => candidate.id === entry.assertionId);
    const selectedFile = repository.selectedFiles.find((candidate) => candidate.path === entry.testPath);
    const testPathMapping = fileMappings.find((candidate) => candidate.path === entry.testPath);
    const validJsonObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length > 0
      && Buffer.byteLength(JSON.stringify(value), 'utf8') <= 4096;
    const hasDataset = Object.hasOwn(entry, 'dataset') && entry.dataset !== null && entry.dataset !== '';
    const hasOracle = Object.hasOwn(entry, 'expectedOutput') && entry.expectedOutput !== null && entry.expectedOutput !== '';
    const hasTestPath = Object.hasOwn(entry, 'testPath') && entry.testPath !== null && entry.testPath !== '';
    const hasAssertion = Object.hasOwn(entry, 'assertionId') && entry.assertionId !== null && entry.assertionId !== '';
    if (hasDataset !== hasOracle || hasTestPath !== hasAssertion || ((hasTestPath || hasAssertion) && !(hasDataset && hasOracle))) {
      throw new Error(`The ${type} case must provide dataset and oracle together; an executable mapping must additionally provide its exact test path and assertion together.`);
    }
    const hasTypedCaseData = hasDataset && hasOracle;
    const mappingComplete = hasTypedCaseData && hasTestPath && hasAssertion;
    const allowedTypes = type === 'positive' ? ['output', 'metric']
      : type === 'negative' ? ['risk'] : ['process', 'input', 'output'];
    if (definition.length < 12 || definition.length > 600 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(definition)
      || !source || !/^[a-f0-9]{64}$/.test(source.snapshotHash ?? '') || !allowedTypes.includes(source.type)
      || !criterion || (hasTypedCaseData && (!validJsonObject(entry.dataset) || !validJsonObject(entry.expectedOutput)))
      || (mappingComplete && (!assertion || assertion.criterionId !== criterion.id || typeof entry.testPath !== 'string'
        || !selectedFile || !HASH.test(selectedFile.contentHash ?? '')
        || testPathMapping?.role !== 'TEST' || !testPathMapping.criterionIds.includes(criterion.id)))) {
      throw new Error(`The ${type} case must use a typed source and criterion from this exact process trace; a complete execution mapping must pin its dataset, oracle, selected TEST path, and matching assertion.`);
    }
    return { id: type, type: type.toUpperCase(), definition, criterionId: criterion.id,
      criterionHash: digest(criterion), sourceRef: { id: source.id, type: source.type, snapshotHash: source.snapshotHash },
      ...(hasTypedCaseData ? { dataset: structuredClone(entry.dataset), expectedOutput: structuredClone(entry.expectedOutput) } : {}),
      ...(mappingComplete ? {
        executionMapping: { status: 'OWNER_PROPOSED_UNVERIFIED', assertionId: assertion.id,
          testName: assertion.testName, testPath: selectedFile.path, testFileHash: selectedFile.contentHash,
          repositorySnapshotId: repository.source.snapshotId, repositoryTreeDigest: repository.treeDigest,
          assertionHash: digest(assertion) } } : { executionMapping: { status: 'INCOMPLETE' } }),
      status: 'NOT_EXECUTED', authoredBy: principal };
  }), mappingStatus: types.every((type) => request[type].assertionId && request[type].dataset
    && request[type].expectedOutput && request[type].testPath) ? 'OWNER_PROPOSED_UNVERIFIED' : 'INCOMPLETE' };
}

export function verifyProcessBehaviorTestPlan(plan) {
  if (!plan || typeof plan !== 'object' || ![2, 3, 4].includes(plan.schemaVersion)
    || plan.status !== 'AUTHORIZED_BEFORE_EXECUTION' || !Array.isArray(plan.assertions)
    || !HASH.test(plan.planHash ?? '')) return false;
  const { planHash, ...core } = plan;
  if (digest(core) !== planHash || !plan.assertions.length || plan.assertions.length > 32
    || !plan.checkPlan || !HASH.test(plan.checkPlan.hash ?? '')
    || !plan.repository || plan.repository.kind !== 'github-app' || !HASH.test(plan.repositoryHash ?? '')
    || digest(plan.repository) !== plan.repositoryHash || !HASH.test(plan.repository.treeDigest ?? '')
    || !Array.isArray(plan.repository.selectedFiles) || !plan.repository.selectedFiles.length
    || !Array.isArray(plan.fileMappings) || plan.fileMappings.length !== plan.repository.selectedFiles.length
    || !Number.isSafeInteger(plan.criterionContractVersion) || plan.criterionContractVersion < 1
    || !HASH.test(plan.criterionContractHash ?? '')) return false;
  const ids = new Set(); const names = new Set(); const criteria = new Set();
  const validAssertions = plan.assertions.every((entry) => {
    if (!ID.test(entry.id ?? '') || ids.has(entry.id) || typeof entry.testName !== 'string'
      || names.has(entry.testName) || entry.expected !== 'PASS' || !Number.isSafeInteger(entry.criterionIndex)
      || entry.criterionIndex < 0 || entry.criterionIndex >= plan.assertions.length
      || criteria.has(entry.criterionIndex) || !ID.test(entry.criterionId ?? '')
      || entry.criterionContractVersion !== plan.criterionContractVersion || !HASH.test(entry.criterionHash ?? '')
      || digest(entry.criterion) !== entry.criterionHash || !HASH.test(entry.source?.blueprintSnapshotHash ?? '')
      || !HASH.test(entry.source?.processSnapshotHash ?? '') || !HASH.test(entry.source?.bindingHash ?? '')
      || !entry.outcome?.id || !entry.scope?.id
      || !(['LINKED', 'UNKNOWN'].includes(entry.risk?.status)
        && (entry.risk.status === 'LINKED' ? entry.risk.refs?.length === 1 && HASH.test(entry.risk.refs[0]?.snapshotHash ?? '')
          : Array.isArray(entry.risk.refs) && entry.risk.refs.length === 0))
      || !entry.check?.id
      || digest(entry.source) !== digest(plan.source)
      || !HASH.test(entry.check.commandHash ?? '') || !HASH.test(entry.check.planHash ?? '')
      || entry.check.planHash !== plan.checkPlan?.hash) return false;
    if (entry.criterion?.id !== entry.criterionId || digest(entry.criterion) !== entry.criterionHash) return false;
    ids.add(entry.id); names.add(entry.testName); criteria.add(entry.criterionIndex); return true;
  });
  const paths = new Set();
  const validMappings = plan.fileMappings.every((entry) => {
    if (!entry || typeof entry.path !== 'string' || paths.has(entry.path)
      || !plan.repository.selectedFiles.some((file) => file.path === entry.path)
      || !['IMPLEMENTATION', 'TEST', 'CONFIGURATION', 'DOCUMENTATION'].includes(entry.role)
      || !Array.isArray(entry.criterionIds) || !entry.criterionIds.length
      || entry.criterionIds.some((id) => !plan.assertions.some((assertion) => assertion.criterionId === id))) return false;
    paths.add(entry.path); return true;
  });
  if (plan.schemaVersion >= 3) {
    const context = plan.evaluationContext;
    const cases = plan.caseDefinitions;
    const contextValid = context?.schemaVersion === 1 && context.workspace?.projectId === plan.projectId
      && context.workspace.blueprintId === plan.source.blueprintId
      && context.workspace.blueprintVersion === plan.source.blueprintVersion
      && context.workspace.processTraceHash === plan.traceHash
      && context.branch?.snapshotId === plan.repository.source?.snapshotId
      && context.branch.treeDigest === plan.repository.treeDigest
      && context.branch.repositoryId === plan.repository.source?.repositoryId
      && context.branch.branchRef === plan.repository.source?.branchRef
      && context.branch.commitOid === plan.repository.source?.commitOid
      && context.effectiveTime?.status === 'OWNER_ASSERTED'
      && context.effectiveTime.assertedBy === plan.createdBy
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(context.effectiveTime.value ?? '')
      && HASH.test(context.effectiveTime.sourceRef?.snapshotHash ?? '');
    const validCaseBase = (type, entry) => entry.type === type && entry.status === 'NOT_EXECUTED'
      && entry.authoredBy === plan.createdBy && typeof entry.definition === 'string' && entry.definition.length >= 12
      && HASH.test(entry.criterionHash ?? '') && HASH.test(entry.sourceRef?.snapshotHash ?? '')
      && typeof entry.sourceRef?.id === 'string';
    const caseShapeValid = cases?.schemaVersion === 1 && cases.status === 'OWNER_AUTHORED_NOT_EXECUTED'
      && Array.isArray(cases.cases) && cases.cases.length === 3;
    const legacyCasesValid = plan.schemaVersion === 3 && caseShapeValid
      && !Object.hasOwn(cases, 'mappingStatus')
      && ['POSITIVE', 'NEGATIVE', 'RECOVERY'].every((type) => cases.cases.some((entry) => {
        const allowedKeys = ['id', 'type', 'definition', 'criterionId', 'criterionHash', 'sourceRef', 'status', 'authoredBy'];
        return validCaseBase(type, entry) && Object.keys(entry).every((key) => allowedKeys.includes(key));
      }));
    const mappedCasesValid = plan.schemaVersion === 4 && caseShapeValid
      && ['POSITIVE', 'NEGATIVE', 'RECOVERY'].every((type) => cases.cases.some((entry) => {
        const assertion = plan.assertions.find((candidate) => candidate.id === entry.executionMapping?.assertionId);
        const selectedFile = plan.repository.selectedFiles.find((candidate) => candidate.path === entry.executionMapping?.testPath);
        const mapping = plan.fileMappings.find((candidate) => candidate.path === entry.executionMapping?.testPath);
        const jsonObject = (value) => value && typeof value === 'object' && !Array.isArray(value)
          && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length > 0
          && Buffer.byteLength(JSON.stringify(value), 'utf8') <= 4096;
        const mappingComplete = entry.executionMapping?.status === 'OWNER_PROPOSED_UNVERIFIED';
        const hasDataset = Object.hasOwn(entry, 'dataset');
        const hasOracle = Object.hasOwn(entry, 'expectedOutput');
        const mappingIncomplete = entry.executionMapping?.status === 'INCOMPLETE'
          && hasDataset === hasOracle
          && (!hasDataset || (jsonObject(entry.dataset) && jsonObject(entry.expectedOutput)))
          && !Object.hasOwn(entry.executionMapping, 'assertionId')
          && !Object.hasOwn(entry.executionMapping, 'testPath');
        const mappingPinned = mappingComplete && jsonObject(entry.dataset) && jsonObject(entry.expectedOutput)
          && assertion?.criterionId === entry.criterionId && assertion.testName === entry.executionMapping.testName
          && digest(assertion) === entry.executionMapping.assertionHash
          && selectedFile?.contentHash === entry.executionMapping.testFileHash
          && mapping?.role === 'TEST' && mapping.criterionIds.includes(entry.criterionId)
          && entry.executionMapping.repositorySnapshotId === plan.repository.source?.snapshotId
          && entry.executionMapping.repositoryTreeDigest === plan.repository.treeDigest;
        return validCaseBase(type, entry)
          && (mappingPinned || mappingIncomplete);
      }))
      && cases.mappingStatus === (cases.cases.every((entry) => entry.executionMapping?.status === 'OWNER_PROPOSED_UNVERIFIED')
        ? 'OWNER_PROPOSED_UNVERIFIED' : 'INCOMPLETE');
    if (!contextValid || !(legacyCasesValid || mappedCasesValid)) return false;
  }
  return validAssertions && criteria.size === plan.assertions.length && validMappings;
}

export function candidateChangesCoveredByPathMap(fileMappings, changes) {
  if (!Array.isArray(fileMappings) || !Array.isArray(changes)) return false;
  const byPath = new Map(fileMappings.map((entry) => [entry?.path, entry]));
  const seen = new Set();
  for (const change of changes) {
    if (!change || typeof change.path !== 'string' || seen.has(change.path)
      || !['added', 'modified', 'deleted', 'mode_changed'].includes(change.change)) return false;
    const mapping = byPath.get(change.path);
    if (!mapping || !Array.isArray(mapping.criterionIds) || !mapping.criterionIds.length
      || !['IMPLEMENTATION', 'TEST', 'CONFIGURATION', 'DOCUMENTATION'].includes(mapping.role)) return false;
    seen.add(change.path);
  }
  return true;
}

export function processBehaviorCandidateDisposition({ evaluationStatus, riskCoverage, assertions }) {
  if (evaluationStatus !== 'CHECKED_BEHAVIOR' || !Array.isArray(assertions) || assertions.length === 0) return 'NOT_EVALUATED';
  if (riskCoverage !== 'LINKED') return 'BLOCKED_INCOMPLETE';
  if (assertions.some((assertion) => assertion?.status !== 'TEST_PASS')) return 'REJECTED';
  return 'PENDING_INDEPENDENT_REVIEW';
}

export function parseNodeTestAssertions(stdout, plan, checkReceipt) {
  if (!verifyProcessBehaviorTestPlan(plan) || typeof stdout !== 'string' || stdout.length > 20_000
    || !checkReceipt || !HASH.test(checkReceipt.outputHash ?? '') || !HASH.test(checkReceipt.candidateTreeDigest ?? '')
    || checkReceipt.candidateTreeDigestAfter !== checkReceipt.candidateTreeDigest
    || !plan.assertions.every((assertion) => assertion.check.id === checkReceipt.checkId
      && assertion.check.version === checkReceipt.checkVersion && assertion.check.commandHash === checkReceipt.commandHash
      && assertion.check.planHash === checkReceipt.planHash)) return null;
  if (!checkReceipt.stdoutTruncated && !checkReceipt.stderrTruncated
    && digest({ stdout, stderr: checkReceipt.stderr ?? '' }) !== checkReceipt.outputHash) return null;
  if (checkReceipt.stdoutTruncated || checkReceipt.stderrTruncated || !['PASSED', 'FAILED'].includes(checkReceipt.status)
    || checkReceipt.executionStatus !== 'COMPLETED' || !Number.isSafeInteger(checkReceipt.exitCode)
    || (checkReceipt.status === 'PASSED' && checkReceipt.exitCode !== 0)
    || (checkReceipt.status === 'FAILED' && checkReceipt.exitCode === 0)) {
    return plan.assertions.map((assertion) => ({ id: assertion.id, testName: assertion.testName,
      status: 'UNKNOWN', reason: 'CHECK_OUTPUT_UNAVAILABLE', checkId: checkReceipt.checkId,
      checkVersion: checkReceipt.checkVersion, commandHash: checkReceipt.commandHash,
      checkPlanHash: checkReceipt.planHash, candidateTreeDigest: checkReceipt.candidateTreeDigest,
      outputHash: checkReceipt.outputHash }));
  }
  const lines = stdout.split(/\r?\n/);
  const records = new Map();
  for (const line of lines) {
    const match = line.match(/^(not )?ok\s+\d+\s+-\s+(.+?)(?:\s+#\s+(SKIP|TODO).*?)?\s*$/);
    if (!match) continue;
    const name = match[2];
    if (records.has(name)) return null;
    records.set(name, match[3] ? 'UNKNOWN' : match[1] ? 'TEST_FAIL' : 'TEST_PASS');
  }
  return plan.assertions.map((assertion) => {
    if (assertion.check.id !== checkReceipt.checkId || assertion.check.version !== checkReceipt.checkVersion
      || assertion.check.commandHash !== checkReceipt.commandHash || assertion.check.planHash !== checkReceipt.planHash) {
      return { id: assertion.id, status: 'UNKNOWN', reason: 'ASSERTION_CHECK_PIN_MISMATCH' };
    }
    const status = records.get(assertion.testName);
    return status && status !== 'UNKNOWN' ? { id: assertion.id, testName: assertion.testName, status,
      checkId: checkReceipt.checkId, checkVersion: checkReceipt.checkVersion, commandHash: checkReceipt.commandHash,
      checkPlanHash: checkReceipt.planHash, candidateTreeDigest: checkReceipt.candidateTreeDigest,
      outputHash: checkReceipt.outputHash }
      : { id: assertion.id, testName: assertion.testName, status: 'UNKNOWN', reason: status === 'UNKNOWN' ? 'ASSERTION_SKIPPED_OR_TODO' : 'ASSERTION_RESULT_NOT_FOUND',
        checkId: checkReceipt.checkId, checkVersion: checkReceipt.checkVersion, commandHash: checkReceipt.commandHash,
        checkPlanHash: checkReceipt.planHash, candidateTreeDigest: checkReceipt.candidateTreeDigest,
        outputHash: checkReceipt.outputHash };
  });
}

export function nodeTestCommandTargetsFile(check, testPath) {
  if (!check || !testPath || ![process.execPath, '/usr/bin/node'].includes(check.executable)
    || !Array.isArray(check.args)) return false;
  const args = check.args; const files = []; let testMode = false; let reporterIsTap = false;
  const valueOptions = new Set(['--test-reporter', '--test-name-pattern', '--test-skip-pattern',
    '--test-concurrency', '--test-timeout', '--test-coverage-include', '--test-coverage-exclude']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--test') { testMode = true; continue; }
    if (arg === '--test-reporter=tap') { reporterIsTap = true; continue; }
    if (valueOptions.has(arg)) {
      const value = args[index + 1];
      if (typeof value !== 'string' || !value || value.startsWith('--')) return false;
      if (arg === '--test-reporter') {
        if (value !== 'tap') return false;
        reporterIsTap = true;
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--test-reporter=')) {
      if (arg !== '--test-reporter=tap') return false;
      reporterIsTap = true;
      continue;
    }
    if (arg.startsWith('--test-name-pattern=') || arg.startsWith('--test-skip-pattern=')) continue;
    if (arg.startsWith('-') || !testMode) return false;
    files.push(arg);
  }
  return testMode && reporterIsTap && files.length === 1 && files[0] === testPath;
}

export function deriveScenarioMappingEvidence({ plan, assertionResults, candidate, checkEvidenceVerified = false }) {
  const cases = Array.isArray(plan?.caseDefinitions?.cases) ? plan.caseDefinitions.cases : [];
  return cases.map((scenario) => {
    const base = { caseId: scenario.id, type: scenario.type, caseStatus: 'NOT_EXECUTED', scope: 'ASSERTION_LINKAGE_ONLY' };
    if (scenario.executionMapping?.status !== 'OWNER_PROPOSED_UNVERIFIED') {
      return { ...base, status: 'INCOMPLETE', reason: 'OWNER_MAPPING_INCOMPLETE' };
    }
    const mapping = scenario.executionMapping;
    const assertion = plan.assertions?.find((entry) => entry.id === mapping.assertionId);
    const selectedFile = plan.repository?.selectedFiles?.find((entry) => entry.path === mapping.testPath);
    const pathMapping = plan.fileMappings?.find((entry) => entry.path === mapping.testPath);
    const check = plan.repository?.checkPlan?.requiredChecks?.find((entry) => entry.id === assertion?.check?.id);
    const result = Array.isArray(assertionResults) ? assertionResults.find((entry) => entry.id === mapping.assertionId) : null;
    let reason = null;
    if (!verifyProcessBehaviorTestPlan(plan)) reason = 'PLAN_INTEGRITY_INVALID';
    else if (!assertion || digest(assertion) !== mapping.assertionHash || assertion.criterionId !== scenario.criterionId) reason = 'ASSERTION_OR_CRITERION_MISMATCH';
    else if (!selectedFile || selectedFile.contentHash !== mapping.testFileHash
      || pathMapping?.role !== 'TEST' || !pathMapping.criterionIds.includes(scenario.criterionId)) reason = 'PINNED_TEST_FILE_MISMATCH';
    else if (mapping.repositorySnapshotId !== plan.repository.source?.snapshotId
      || mapping.repositoryTreeDigest !== plan.repository.treeDigest
      || candidate?.sourceSnapshotId !== mapping.repositorySnapshotId
      || candidate?.sourceTreeDigest !== mapping.repositoryTreeDigest) reason = 'SOURCE_TREE_MISMATCH';
    else if (!nodeTestCommandTargetsFile(check, mapping.testPath)) reason = 'CHECK_COMMAND_DOES_NOT_TARGET_MAPPED_TEST_FILE';
    else if (!Array.isArray(candidate?.changes) || candidate.changes.some((entry) => entry.path === mapping.testPath)) reason = 'MAPPED_TEST_FILE_CHANGED_IN_CANDIDATE';
    else if (!checkEvidenceVerified || !result || result.id !== assertion.id || result.testName !== assertion.testName
      || result.criterionIndex !== assertion.criterionIndex || result.checkId !== assertion.check.id
      || result.checkVersion !== assertion.check.version || result.commandHash !== assertion.check.commandHash
      || result.checkPlanHash !== assertion.check.planHash || result.candidateTreeDigest !== candidate?.treeDigest
      || !HASH.test(result.outputHash ?? '')) reason = 'PERSISTED_ASSERTION_RESULT_PIN_MISMATCH';
    else if (result.status !== 'TEST_PASS') reason = 'ASSERTION_RESULT_NOT_PASSING';
    return { ...base, status: reason ? 'UNVERIFIED' : 'VERIFIED_TO_PASSING_ASSERTION',
      ...(reason ? { reason } : {}), assertionId: mapping.assertionId, criterionId: scenario.criterionId,
      testPath: mapping.testPath, testFileHash: mapping.testFileHash,
      repositorySnapshotId: mapping.repositorySnapshotId, sourceTreeDigest: mapping.repositoryTreeDigest,
      candidateTreeDigest: candidate?.treeDigest ?? null, assertionStatus: result?.status ?? 'UNKNOWN',
      outputHash: result?.outputHash ?? null };
  });
}
