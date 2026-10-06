import { randomUUID } from 'node:crypto';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';
import { digest } from '../sdlc/contracts.mjs';

export const ENTERPRISE_SENTINEL_KINDS = new Set(['run-sentinel-assessment']);
export const ENTERPRISE_SENTINEL_LIMITS = Object.freeze({ assessments: 50, findings: 500, bytes: 131072 });

// This shipped profile has one deliberately narrow, executable rule. Its digest
// commits to the rule, applicability, severity, status semantics and evaluator.
const PROFILE_CORE = Object.freeze({
  id: 'orgward-sentinel-operational-accountability',
  version: '1.0.0',
  evaluatorRevision: 'sentinel-evaluator-1',
  applicability: 'Saved blueprint objects with type=process.',
  statusSemantics: Object.freeze({
    PASS: 'At least one applicable process was evaluated and every process has a named accountable owner role.',
    FAIL: 'At least one applicable process has no named accountable owner role.',
    UNKNOWN: 'No supported process object was present, or supported input could not be evaluated.',
  }),
  rules: Object.freeze([Object.freeze({ id: 'accountability.process-owner', applicability: 'Each saved design object with type=process.',
    severity: 'high', missingStatus: 'FAIL', summary: 'Every process has a named accountable owner role.' })]),
});
export const ENTERPRISE_SENTINEL_PROFILE = Object.freeze({ ...PROFILE_CORE, hash: digest(PROFILE_CORE) });
const SENTINEL_PROFILE_HISTORY = new Map([[ENTERPRISE_SENTINEL_PROFILE.hash, ENTERPRISE_SENTINEL_PROFILE]]);

const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };

export function isValidSentinelProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  const { hash, ...core } = profile;
  const registered = SENTINEL_PROFILE_HISTORY.get(hash);
  const { hash: _registeredHash, ...registeredCore } = registered ?? {};
  return Boolean(registered && digest(core) === hash && digest(core) === digest(registeredCore));
}

export function isKnownEnterpriseSentinelProfile(profile) {
  const saved = profile && SENTINEL_PROFILE_HISTORY.get(profile.hash);
  return Boolean(saved && saved.id === profile.id && saved.version === profile.version
    && saved.evaluatorRevision === profile.evaluatorRevision);
}

export function isValidEnterpriseSentinelAssessment(report, expectedProjectId) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return false;
  const { reportHash, ...core } = report;
  const source = report.source; const profile = report.profile; const input = report.input;
  if (!/^[a-f0-9]{64}$/.test(reportHash ?? '') || digest(core) !== reportHash
    || !/^sentinel-assessment-[0-9a-f-]{36}$/.test(report.id ?? '')
    || report.schemaVersion !== 1 || !['PASS', 'FAIL', 'UNKNOWN'].includes(report.status)
    || report.projectId !== expectedProjectId || typeof report.actor !== 'string' || !report.actor
    || typeof report.reason !== 'string' || !report.reason
    || typeof report.evaluatedAt !== 'string' || !Number.isFinite(Date.parse(report.evaluatedAt))
    || !source || typeof source !== 'object' || Array.isArray(source)
    || source.projectId !== expectedProjectId || !/^blueprint-[0-9a-f-]{36}$/.test(source.blueprintId ?? '')
    || !Number.isSafeInteger(source.blueprintVersion) || source.blueprintVersion < 1
    || !Number.isSafeInteger(source.assessedAggregateVersion) || source.assessedAggregateVersion < 1
    || !/^[a-f0-9]{64}$/.test(source.snapshotHash ?? '')
    || !input || typeof input !== 'object' || Array.isArray(input)
    || input.blueprintSnapshotHash !== source.snapshotHash
    || !profile
    || typeof profile.version !== 'string' || !/^[a-f0-9]{64}$/.test(profile.hash ?? '')
    || !isValidSentinelProfile(profile)
    || !report.coverage || typeof report.coverage !== 'object'
    || !Number.isSafeInteger(report.coverage.applicable) || report.coverage.applicable < 0
    || report.coverage.evaluated !== report.coverage.applicable
    || report.coverage.profileRuleCount !== PROFILE_CORE.rules.length
    || !Array.isArray(report.findings) || report.findings.length > ENTERPRISE_SENTINEL_LIMITS.findings
    || report.findings.some((finding) => !finding || !/^sentinel-finding-[a-f0-9]{32}$/.test(finding.id ?? '')
      || finding.ruleId !== 'accountability.process-owner' || typeof finding.objectId !== 'string'
      || finding.severity !== 'high' || finding.status !== 'FAIL' || typeof finding.message !== 'string')) return false;
  if ((report.coverage.applicable === 0 && report.status !== 'UNKNOWN')
    || (report.coverage.applicable > 0 && report.findings.length && report.status !== 'FAIL')
    || (report.coverage.applicable > 0 && !report.findings.length && report.status !== 'PASS')
    || report.findings.length > report.coverage.applicable) return false;
  return true;
}

export function normalizeEnterpriseSentinelCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.kind !== 'run-sentinel-assessment'
    || Object.keys(input).some((key) => !['kind', 'blueprintId', 'blueprintVersion', 'snapshotHash', 'reason'].includes(key))
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '')
    || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
    || !/^[a-f0-9]{64}$/.test(input.snapshotHash ?? '')) {
    fail('INVALID_SENTINEL_COMMAND', 'Bind Sentinel assessment to one exact saved blueprint version and source hash.');
  }
  return { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    snapshotHash: input.snapshotHash, reason: enterpriseText(input.reason, 'Assessment reason', 500) };
}

export function evaluateEnterpriseSentinel(blueprint) {
  const processes = blueprintObjects(blueprint).filter((object) => object.type === 'process');
  if (processes.length > ENTERPRISE_SENTINEL_LIMITS.findings) fail('SENTINEL_FINDING_LIMIT', 'The saved design contains more applicable processes than this profile can assess in one report.', 409);
  const findings = processes.filter((process) => typeof process.ownerRoleName !== 'string' || !process.ownerRoleName.trim())
    .map((process) => ({ id: `sentinel-finding-${digest({ ruleId: 'accountability.process-owner', objectId: process.id }).slice(0, 32)}`,
      ruleId: 'accountability.process-owner', objectId: process.id, severity: 'high', status: 'FAIL',
      message: `Process “${process.name}” has no named accountable owner role.` }));
  return { status: processes.length === 0 ? 'UNKNOWN' : findings.length ? 'FAIL' : 'PASS',
    coverage: { profileRuleCount: PROFILE_CORE.rules.length, applicable: processes.length, evaluated: processes.length,
      unsupportedDomains: ['authority conflicts', 'control effectiveness', 'cross-project relationships'] }, findings };
}

export function applyEnterpriseSentinelCommand(project, command, actor, now = new Date()) {
  const blueprint = project.blueprintVersions?.at(-1);
  if (!blueprint || blueprint.id !== command.blueprintId || blueprint.version !== command.blueprintVersion
    || digest(blueprint) !== command.snapshotHash) {
    fail('SENTINEL_SOURCE_STALE', 'The saved design changed. Reload the current blueprint before running Sentinel.', 409);
  }
  const reports = project.enterpriseSentinelAssessments ?? [];
  if (reports.length >= ENTERPRISE_SENTINEL_LIMITS.assessments) {
    fail('SENTINEL_ASSESSMENT_LIMIT', 'This project reached its 50-report Sentinel assessment history limit.', 409);
  }
  const at = now.toISOString();
  const evaluated = evaluateEnterpriseSentinel(blueprint);
  const report = {
    schemaVersion: 1, id: `sentinel-assessment-${randomUUID()}`, projectId: project.id,
    source: { projectId: project.id, blueprintId: blueprint.id, blueprintVersion: blueprint.version,
      assessedAggregateVersion: project.version, snapshotHash: command.snapshotHash },
    input: { blueprintSnapshotHash: command.snapshotHash },
    profile: structuredClone(ENTERPRISE_SENTINEL_PROFILE),
    actor, evaluatedAt: at, reason: command.reason, ...evaluated,
  };
  report.reportHash = digest(report);
  if (!isValidEnterpriseSentinelAssessment(report, project.id)) fail('SENTINEL_REPORT_INVALID', 'The Sentinel result failed its own integrity validation.', 409);
  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > ENTERPRISE_SENTINEL_LIMITS.bytes) {
    fail('SENTINEL_REPORT_TOO_LARGE', 'The Sentinel report exceeds its 128 KiB storage limit.', 409);
  }
  project.enterpriseSentinelAssessments ??= [];
  project.enterpriseSentinelAssessments.push(report);
  project.audit ??= [];
  project.audit.push({ at, action: 'enterprise.run-sentinel-assessment', actor,
    detail: `Recorded Sentinel profile ${report.profile.id} v${report.profile.version} for blueprint v${blueprint.version}; profile coverage is limited to process accountability.` });
  return { blueprint, affectedObjectId: null, sentinelAssessmentId: report.id, sentinelAssessment: report, recordedAt: at };
}

export function projectEnterpriseSentinel(project, blueprint, savedBy = () => true) {
  const sourceHash = blueprint ? digest(blueprint) : null;
  const assessments = (project.enterpriseSentinelAssessments ?? []).filter((report) => savedBy(report.evaluatedAt)).map((report) => {
    if (!isValidEnterpriseSentinelAssessment(report, project.id)) fail('SENTINEL_REPORT_CORRUPT', 'A saved Sentinel assessment failed its report integrity check.', 409);
    return { ...structuredClone(report), appliesToContext: Boolean(blueprint && report.source.blueprintId === blueprint.id
      && report.source.blueprintVersion === blueprint.version && report.source.snapshotHash === sourceHash) };
  });
  const current = assessments.filter((report) => report.appliesToContext).sort((a, b) =>
    Date.parse(b.evaluatedAt) - Date.parse(a.evaluatedAt) || b.id.localeCompare(a.id))[0] ?? null;
  return { profile: { id: ENTERPRISE_SENTINEL_PROFILE.id, version: ENTERPRISE_SENTINEL_PROFILE.version,
    hash: ENTERPRISE_SENTINEL_PROFILE.hash, evaluatorRevision: ENTERPRISE_SENTINEL_PROFILE.evaluatorRevision,
    applicability: ENTERPRISE_SENTINEL_PROFILE.applicability }, current, assessments };
}
