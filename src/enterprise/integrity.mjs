import { randomUUID } from 'node:crypto';
import { buildRelations, latestBlueprint, validateBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { enterpriseInstant } from './state.mjs';

export const ENTERPRISE_INTEGRITY_KINDS = new Set(['run-integrity-checks', 'accept-integrity-exception']);
export const ENTERPRISE_INTEGRITY_ENGINE = 'enterprise-integrity-1.0';
export const ENTERPRISE_INTEGRITY_LIMITS = Object.freeze({ assessments: 50, findings: 2000, exceptions: 2000, bytes: 262144 });

const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };

export function normalizeEnterpriseIntegrityCommand(input) {
  if (input && typeof input === 'object' && !Array.isArray(input) && input.kind === 'accept-integrity-exception') {
    const allowed = ['kind', 'findingId', 'reportId', 'reportHash', 'blueprintId', 'blueprintVersion', 'snapshotHash', 'reason', 'expiresAt'];
    if (Object.keys(input).some((key) => !allowed.includes(key))
      || !/^finding-[a-f0-9]{32}$/.test(input.findingId ?? '')
      || !/^enterprise-integrity-[0-9a-f-]{36}$/.test(input.reportId ?? '')
      || !/^[a-f0-9]{64}$/.test(input.reportHash ?? '')
      || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '')
      || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
      || !/^[a-f0-9]{64}$/.test(input.snapshotHash ?? '')
      || !(input.expiresAt === null || typeof input.expiresAt === 'string')) {
      fail('INVALID_INTEGRITY_EXCEPTION', 'Bind an exception to one exact finding, saved report and current blueprint, with an optional UTC expiry.');
    }
    return { kind: input.kind, findingId: input.findingId, reportId: input.reportId, reportHash: input.reportHash,
      blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion, snapshotHash: input.snapshotHash,
      reason: enterpriseText(input.reason, 'Exception reason', 500), expiresAt: input.expiresAt === null ? null : enterpriseInstant(input.expiresAt, 'Exception expiry') };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.kind !== 'run-integrity-checks'
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '')
    || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
    || !/^[a-f0-9]{64}$/.test(input.snapshotHash ?? '')) {
    fail('INVALID_INTEGRITY_COMMAND', 'Bind integrity checks to an exact saved blueprint ID, version and snapshot hash.');
  }
  const allowed = ['kind', 'blueprintId', 'blueprintVersion', 'snapshotHash', 'reason'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail('INVALID_INTEGRITY_COMMAND', 'The integrity command contains unsupported fields.');
  return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    snapshotHash: input.snapshotHash, reason: enterpriseText(input.reason, 'Assessment reason', 500) };
}

function finding({ ruleId, code, path, objectId = null, severity, message, action }) {
  return { id: `finding-${digest({ ruleId, code, path, objectId, message }).slice(0, 32)}`,
    ruleId, code, path: path ?? null, objectId, severity, message, action };
}

function relationOrder(entries) {
  return [...entries].map((entry) => structuredClone(entry)).sort((left, right) =>
    `${left.id}\n${left.source}\n${left.type}\n${left.target}`.localeCompare(`${right.id}\n${right.source}\n${right.type}\n${right.target}`));
}

export function evaluateEnterpriseIntegrity(blueprint) {
  if (!blueprint || typeof blueprint !== 'object' || !blueprint.areas || typeof blueprint.areas !== 'object'
    || Array.isArray(blueprint.areas) || Object.values(blueprint.areas).some((area) => !area || typeof area !== 'object'
      || Array.isArray(area) || !Array.isArray(area.items)
      || area.items.some((item) => !item || typeof item !== 'object' || Array.isArray(item)))
    || (blueprint.relations !== undefined && (!Array.isArray(blueprint.relations)
      || blueprint.relations.some((relation) => !relation || typeof relation !== 'object' || Array.isArray(relation))))) {
    fail('INTEGRITY_BLUEPRINT_INVALID', 'A saved blueprint is required to run integrity checks.', 409);
  }
  const checkedBlueprint = structuredClone(blueprint);
  const validation = validateBlueprint(checkedBlueprint);
  const objects = blueprintObjects(checkedBlueprint);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const structuralErrors = validation.errors.filter((error) => error.code !== 'DANGLING_REFERENCE');
  const referenceErrors = validation.errors.filter((error) => error.code === 'DANGLING_REFERENCE');
  const lineageFindings = [];
  const storedRelations = relationOrder(checkedBlueprint.relations ?? []);
  const derivedRelations = relationOrder(buildRelations(checkedBlueprint.areas));
  const storedById = new Map(storedRelations.map((relation) => [relation.id, relation]));
  const derivedById = new Map(derivedRelations.map((relation) => [relation.id, relation]));
  const typedReferenceFindings = referenceErrors.map((error) => finding({ ruleId: 'lineage.typed-references', code: error.code,
    path: error.path, severity: 'high', message: error.message, action: 'Restore or remove the missing typed relationship, then rerun these checks.' }));
  for (const relation of derivedRelations) if (!storedById.has(relation.id) || digest(storedById.get(relation.id)) !== digest(relation)) {
    lineageFindings.push(finding({ ruleId: 'lineage.canonical-relations', code: 'RELATION_MISSING_OR_MISMATCHED',
      path: relation.id, objectId: relation.source, severity: 'high',
      message: `The saved relationship ${relation.type} from ${relation.source} to ${relation.target} differs from canonical design links.`,
      action: 'Rebuild saved relationships from the typed design references and rerun these checks.' }));
  }
  for (const relation of storedRelations) if (!derivedById.has(relation.id)) {
    lineageFindings.push(finding({ ruleId: 'lineage.canonical-relations', code: 'RELATION_UNEXPECTED',
      path: relation.id, objectId: relation.source, severity: 'high',
      message: `The saved relationship ${relation.type} from ${relation.source} to ${relation.target} has no matching typed design reference.`,
      action: 'Remove the unsupported relationship or add its canonical typed reference, then rerun these checks.' }));
  }
  if (storedById.size !== storedRelations.length) lineageFindings.push(finding({ ruleId: 'lineage.canonical-relations',
    code: 'RELATION_ID_DUPLICATE', path: 'relations', severity: 'high',
    message: 'The saved relationship list contains duplicate canonical relation IDs.',
    action: 'Remove duplicate relationship entries and rerun these checks.' }));
  const structuralFindings = structuralErrors.map((error) => finding({ ruleId: 'design.typed-structure', code: error.code,
    path: error.path, objectId: byId.has(error.path) ? error.path : null,
    severity: /INVALID|CYCLE|AMBIGUOUS/.test(error.code) ? 'high' : 'medium', message: error.message,
    action: 'Repair the reported typed design structure and rerun these checks.' }));
  const completenessFindings = validation.gaps.map((gap) => finding({ ruleId: 'design.completeness', code: gap.code ?? 'DESIGN_GAP',
    path: gap.path ?? gap.objectId ?? gap.area ?? null, objectId: gap.objectId ?? null,
    severity: gap.severity ?? 'medium', message: gap.action ?? gap.message ?? 'A design gap needs review.',
    action: gap.action ?? 'Review the missing design information and rerun these checks.' }));
  const findings = [...structuralFindings, ...typedReferenceFindings, ...lineageFindings, ...completenessFindings]
    .sort((left, right) => `${left.ruleId}\n${left.id}`.localeCompare(`${right.ruleId}\n${right.id}`));
  if (findings.length > ENTERPRISE_INTEGRITY_LIMITS.findings) fail('INTEGRITY_FINDING_LIMIT', 'The integrity report exceeds its 2,000 finding limit; reduce source complexity before rerunning.', 409);
  const rules = [
    { id: 'design.typed-structure', status: structuralFindings.length ? 'FAIL' : 'PASS', findingCount: structuralFindings.length,
      summary: 'Canonical blueprint structure, typed scope, process and economic definitions.' },
    { id: 'lineage.typed-references', status: typedReferenceFindings.length ? 'FAIL' : 'PASS', findingCount: typedReferenceFindings.length,
      summary: 'Saved relationship endpoints resolve to objects in this blueprint.' },
    { id: 'lineage.canonical-relations', status: lineageFindings.length ? 'FAIL' : 'PASS', findingCount: lineageFindings.length,
      summary: 'Saved relations match typed references and all relation endpoints exist.' },
    { id: 'design.completeness', status: completenessFindings.length ? 'REVIEW' : 'PASS', findingCount: completenessFindings.length,
      summary: 'Existing owner, provenance, responsibility and process-definition gaps remain visible for remediation.' },
  ];
  const status = rules.some((rule) => rule.status === 'FAIL') ? 'FAIL'
    : rules.some((rule) => rule.status === 'REVIEW') ? 'REVIEW' : 'PASS';
  const counts = { rules: rules.length, passedRules: rules.filter((rule) => rule.status === 'PASS').length,
    failedRules: rules.filter((rule) => rule.status === 'FAIL').length,
    reviewRules: rules.filter((rule) => rule.status === 'REVIEW').length,
    findings: findings.length, high: findings.filter((entry) => entry.severity === 'high').length,
    medium: findings.filter((entry) => entry.severity === 'medium').length,
    low: findings.filter((entry) => entry.severity === 'low').length };
  return { engineVersion: ENTERPRISE_INTEGRITY_ENGINE, status, counts, rules, findings };
}

export function applyEnterpriseIntegrityCommand(project, command, actor) {
  if (command.kind === 'accept-integrity-exception') return applyEnterpriseIntegrityException(project, command, actor);
  const blueprint = latestBlueprint(project);
  if (!blueprint || blueprint.id !== command.blueprintId || blueprint.version !== command.blueprintVersion
    || digest(blueprint) !== command.snapshotHash) {
    fail('INTEGRITY_SOURCE_STALE', 'The saved design changed. Reload the current blueprint before running integrity checks.', 409);
  }
  const assessments = project.enterpriseIntegrityAssessments ?? [];
  if (assessments.length >= ENTERPRISE_INTEGRITY_LIMITS.assessments) fail('INTEGRITY_ASSESSMENT_LIMIT', 'This project reached its 50-assessment history limit.', 409);
  const at = new Date().toISOString();
  const source = { projectId: project.id, blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: command.snapshotHash };
  const result = evaluateEnterpriseIntegrity(blueprint);
  const core = { source, ...result };
  const assessment = { ...core, id: `enterprise-integrity-${randomUUID()}`, createdAt: at, createdBy: actor, reason: command.reason };
  assessment.reportHash = digest(assessment);
  if (Buffer.byteLength(JSON.stringify(assessment), 'utf8') > ENTERPRISE_INTEGRITY_LIMITS.bytes) {
    fail('INTEGRITY_REPORT_TOO_LARGE', 'The integrity report exceeds its 256 KiB storage limit.', 409);
  }
  project.enterpriseIntegrityAssessments ??= []; project.enterpriseIntegrityAssessments.push(assessment);
  project.audit ??= []; project.audit.push({ at, action: 'enterprise.run-integrity-checks', actor,
    detail: `Recorded a ${assessment.status.toLowerCase()} typed integrity and lineage assessment for blueprint v${blueprint.version}; no design or operational state changed.` });
  return { blueprint, affectedObjectId: null, integrityAssessmentId: assessment.id, integrityAssessment: assessment, recordedAt: at };
}

export function applyEnterpriseIntegrityException(project, command, actor, now = new Date()) {
  const blueprint = latestBlueprint(project);
  if (!blueprint || blueprint.id !== command.blueprintId || blueprint.version !== command.blueprintVersion
    || digest(blueprint) !== command.snapshotHash) {
    fail('INTEGRITY_EXCEPTION_SOURCE_STALE', 'The saved design changed. Review a report for the exact current blueprint before accepting an exception.', 409);
  }
  const report = (project.enterpriseIntegrityAssessments ?? []).find((entry) => entry.id === command.reportId);
  if (!report || !report.source || !Array.isArray(report.findings)) {
    fail('INTEGRITY_EXCEPTION_REPORT_STALE', 'The saved integrity report changed or is unavailable; rerun checks before accepting an exception.', 409);
  }
  const { reportHash, ...reportCore } = report;
  if (reportHash !== command.reportHash || digest(reportCore) !== reportHash) {
    fail('INTEGRITY_EXCEPTION_REPORT_STALE', 'The saved integrity report changed or is unavailable; rerun checks before accepting an exception.', 409);
  }
  if (report.source.blueprintId !== blueprint.id || report.source.blueprintVersion !== blueprint.version
    || report.source.snapshotHash !== command.snapshotHash || !report.findings.some((entry) => entry.id === command.findingId)) {
    fail('INTEGRITY_EXCEPTION_FINDING_STALE', 'The selected finding is not present in a report for the exact current design.', 409);
  }
  if (command.expiresAt && Date.parse(command.expiresAt) <= now.getTime()) {
    fail('INVALID_INTEGRITY_EXCEPTION_EXPIRY', 'Choose a future expiry or leave expiry empty.', 400);
  }
  const prior = project.enterpriseIntegrityExceptions ?? [];
  if (prior.length >= ENTERPRISE_INTEGRITY_LIMITS.exceptions) fail('INTEGRITY_EXCEPTION_LIMIT', 'This project reached its 2,000-exception history limit.', 409);
  if (prior.some((entry) => entry.reportId === report.id && entry.findingId === command.findingId
    && (!entry.expiresAt || Date.parse(entry.expiresAt) > now.getTime()))) {
    fail('INTEGRITY_EXCEPTION_ALREADY_ACTIVE', 'An active exception already exists for this finding and report.', 409);
  }
  const acceptedAt = now.toISOString();
  const core = { id: `integrity-exception-${randomUUID()}`, findingId: command.findingId, reportId: report.id,
    reportHash: report.reportHash, blueprintId: blueprint.id, blueprintVersion: blueprint.version,
    snapshotHash: command.snapshotHash, actor, reason: command.reason, acceptedAt, expiresAt: command.expiresAt };
  const exception = { ...core, exceptionHash: digest(core) };
  project.enterpriseIntegrityExceptions ??= [];
  project.enterpriseIntegrityExceptions.push(exception);
  project.audit ??= [];
  project.audit.push({ at: acceptedAt, action: 'enterprise.accept-integrity-exception', actor,
    detail: `Accepted a time-bounded human exception for finding ${command.findingId} in report ${report.id}; the finding remains unresolved.` });
  return { blueprint, affectedObjectId: null, integrityExceptionId: exception.id, integrityException: exception, recordedAt: acceptedAt };
}

export function projectEnterpriseIntegrity(project, blueprint, savedBy = () => true, now = new Date()) {
  const selectedSourceHash = blueprint ? digest(blueprint) : null;
  const latest = latestBlueprint(project);
  const exceptionsByReport = new Map();
  const projectedExceptions = [];
  for (const saved of project.enterpriseIntegrityExceptions ?? []) {
    if (!savedBy(saved.acceptedAt)) continue;
    const { exceptionHash, ...core } = saved;
    if (digest(core) !== exceptionHash) fail('INTEGRITY_EXCEPTION_CORRUPT', 'A saved integrity exception failed its immutable record check.', 409);
    const report = (project.enterpriseIntegrityAssessments ?? []).find((entry) => entry.id === saved.reportId);
    if (!report || report.reportHash !== saved.reportHash || !report.source || !Array.isArray(report.findings)
      || !report.findings.some((entry) => entry.id === saved.findingId)) {
      fail('INTEGRITY_EXCEPTION_CORRUPT', 'A saved integrity exception no longer matches its report finding.', 409);
    }
    if (saved.blueprintId !== report.source.blueprintId || saved.blueprintVersion !== report.source.blueprintVersion
      || saved.snapshotHash !== report.source.snapshotHash || typeof saved.actor !== 'string'
      || typeof saved.reason !== 'string' || !saved.reason.trim()
      || !Number.isFinite(Date.parse(saved.acceptedAt))
      || (saved.expiresAt !== null && !Number.isFinite(Date.parse(saved.expiresAt)))) {
      fail('INTEGRITY_EXCEPTION_CORRUPT', 'A saved integrity exception has invalid source or human-review metadata.', 409);
    }
    const stale = !latest || saved.blueprintId !== latest.id || saved.blueprintVersion !== latest.version
      || saved.snapshotHash !== digest(latest) || report.source.blueprintId !== latest.id
      || report.source.blueprintVersion !== latest.version || report.source.snapshotHash !== digest(latest);
    const status = stale ? 'STALE' : saved.expiresAt && Date.parse(saved.expiresAt) <= now.getTime() ? 'EXPIRED' : 'ACTIVE';
    const entry = { ...structuredClone(saved), status, findingRemainsUnresolved: true };
    projectedExceptions.push(entry);
    exceptionsByReport.set(saved.reportId, [...(exceptionsByReport.get(saved.reportId) ?? []), entry]);
  }
  const assessments = (project.enterpriseIntegrityAssessments ?? []).filter((entry) => savedBy(entry.createdAt)).map((entry) => {
    const { reportHash, ...core } = entry;
    if (digest(core) !== reportHash) fail('INTEGRITY_REPORT_CORRUPT', 'A saved integrity assessment failed its immutable report hash check.', 409);
    return { ...structuredClone(entry), exceptions: exceptionsByReport.get(entry.id) ?? [], appliesToContext: Boolean(blueprint && entry.source.blueprintId === blueprint.id
      && entry.source.blueprintVersion === blueprint.version && entry.source.snapshotHash === selectedSourceHash) };
  });
  const reportWindow = assessments.slice(-10).reverse();
  const newestExceptionByFinding = new Map();
  const exceptionsByFinding = new Map();
  for (const exception of projectedExceptions) {
    const key = `${exception.reportId}\n${exception.findingId}`;
    exceptionsByFinding.set(key, [...(exceptionsByFinding.get(key) ?? []), exception]);
    const previous = newestExceptionByFinding.get(key);
    if (!previous || exception.acceptedAt > previous.acceptedAt) newestExceptionByFinding.set(key, exception);
  }
  const bySeverity = { high: 0, medium: 0, low: 0 };
  const byRule = new Map();
  const exceptionCoverage = { ACTIVE: 0, EXPIRED: 0, STALE: 0, NONE: 0 };
  let findingCount = 0; let driftedReports = 0;
  const queueItems = [];
  for (const assessment of reportWindow) {
    const latestSameSource = [...assessments].reverse().find((candidate) =>
      candidate.source.blueprintId === assessment.source.blueprintId
      && candidate.source.blueprintVersion === assessment.source.blueprintVersion
      && candidate.source.snapshotHash === assessment.source.snapshotHash) ?? assessment;
    const reportDrift = !latest || assessment.source.blueprintId !== latest.id
      || assessment.source.blueprintVersion !== latest.version || assessment.source.snapshotHash !== digest(latest);
    if (reportDrift) driftedReports += 1;
    for (const rule of assessment.rules) {
      const coverage = byRule.get(rule.id) ?? { ruleId: rule.id, reports: 0, findings: 0 };
      coverage.reports += 1; coverage.findings += rule.findingCount; byRule.set(rule.id, coverage);
    }
    for (const entry of assessment.findings) {
      findingCount += 1;
      if (Object.hasOwn(bySeverity, entry.severity)) bySeverity[entry.severity] += 1;
      const exception = newestExceptionByFinding.get(`${assessment.id}\n${entry.id}`) ?? null;
      exceptionCoverage[exception?.status ?? 'NONE'] += 1;
      queueItems.push({ reportId: assessment.id, reportHash: assessment.reportHash,
        source: structuredClone(assessment.source), reportCreatedAt: assessment.createdAt,
        reportStatus: assessment.status, reportDrift, appliesToContext: assessment.appliesToContext,
        latestSameSourceReportId: latestSameSource.id,
        notReturnedInLatest: latestSameSource.id !== assessment.id
          && !latestSameSource.findings.some((latestFinding) => latestFinding.id === entry.id),
        finding: structuredClone(entry), status: 'UNRESOLVED',
        exception: exception ? structuredClone(exception) : null,
        exceptions: (exceptionsByFinding.get(`${assessment.id}\n${entry.id}`) ?? []).map((saved) => structuredClone(saved)) });
    }
  }
  const remediationInbox = { currentSource: latest ? { blueprintId: latest.id, blueprintVersion: latest.version, snapshotHash: digest(latest) } : null,
    reportWindowCount: reportWindow.length, totalSavedReports: assessments.length, totalFindings: findingCount,
    unresolvedFindings: findingCount, visibleItems: Math.min(queueItems.length, ENTERPRISE_INTEGRITY_LIMITS.findings),
    omittedItems: Math.max(0, queueItems.length - ENTERPRISE_INTEGRITY_LIMITS.findings), driftedReports,
    bySeverity, byRule: [...byRule.values()].sort((left, right) => left.ruleId.localeCompare(right.ruleId)), exceptionCoverage,
    items: queueItems.slice(0, ENTERPRISE_INTEGRITY_LIMITS.findings) };
  return { engineVersion: ENTERPRISE_INTEGRITY_ENGINE, assessments: assessments.slice(-10),
    exceptions: projectedExceptions.slice(-ENTERPRISE_INTEGRITY_LIMITS.exceptions), latest: assessments.at(-1) ?? null,
    current: assessments.filter((entry) => entry.appliesToContext).at(-1) ?? null, remediationInbox };
}
