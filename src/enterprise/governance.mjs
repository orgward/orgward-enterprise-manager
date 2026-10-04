import { randomUUID } from 'node:crypto';
import { latestBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';

export const ENTERPRISE_GOVERNANCE_KINDS = new Set([
  'request-governance-decision', 'decide-governance-decision',
  'appeal-governance-decision', 'review-governance-appeal',
]);
export const ENTERPRISE_GOVERNANCE_LIMITS = Object.freeze({ entries: 2000, textBytes: 512 * 1024 });

const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);
const caseId = (value) => typeof value === 'string' && /^governance-decision-[0-9a-f-]{36}$/.test(value);
const validSource = (value) => value && typeof value === 'object'
  && /^blueprint-[0-9a-f-]{36}$/.test(value.blueprintId ?? '')
  && Number.isSafeInteger(value.blueprintVersion) && value.blueprintVersion > 0
  && /^[a-f0-9]{64}$/.test(value.snapshotHash ?? '');

export function normalizeEnterpriseGovernanceCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ENTERPRISE_GOVERNANCE_KINDS.has(input.kind)
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '')
    || !Number.isSafeInteger(input.blueprintVersion) || input.blueprintVersion < 1
    || !/^[a-f0-9]{64}$/.test(input.snapshotHash ?? '')) {
    fail('INVALID_GOVERNANCE_COMMAND', 'Bind the governance action to the exact saved blueprint ID, version and hash.');
  }
  const normalized = { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    snapshotHash: input.snapshotHash };
  const allowed = ['kind', 'blueprintId', 'blueprintVersion', 'snapshotHash'];
  if (input.kind === 'request-governance-decision') {
    if (!safeId(input.objectId)) fail('INVALID_GOVERNANCE_COMMAND', 'Choose a design record for this decision request.');
    Object.assign(normalized, { objectId: input.objectId, title: enterpriseText(input.title, 'Decision title', 160),
      question: enterpriseText(input.question, 'Decision question', 700),
      proposedOption: enterpriseText(input.proposedOption, 'Proposed decision', 300), reason: enterpriseText(input.reason, 'Request reason', 500) });
    allowed.push('objectId', 'title', 'question', 'proposedOption', 'reason');
  } else {
    if (!caseId(input.caseId) || !Number.isSafeInteger(input.caseRevision) || input.caseRevision < 1) {
      fail('INVALID_GOVERNANCE_COMMAND', 'Choose a saved governance decision and its current revision.');
    }
    normalized.caseId = input.caseId; normalized.caseRevision = input.caseRevision;
    allowed.push('caseId', 'caseRevision');
    if (input.kind === 'decide-governance-decision') {
      if (!['APPROVE', 'DECLINE'].includes(input.outcome)) fail('INVALID_GOVERNANCE_COMMAND', 'Choose approve or decline.');
      normalized.outcome = input.outcome; normalized.reason = enterpriseText(input.reason, 'Decision rationale', 500);
      allowed.push('outcome', 'reason');
    } else if (input.kind === 'appeal-governance-decision') {
      normalized.reason = enterpriseText(input.reason, 'Appeal reason', 500); allowed.push('reason');
    } else {
      if (!['UPHOLD', 'REOPEN'].includes(input.outcome)) fail('INVALID_GOVERNANCE_COMMAND', 'Choose uphold or reopen for review.');
      normalized.outcome = input.outcome; normalized.reason = enterpriseText(input.reason, 'Appeal review rationale', 500);
      allowed.push('outcome', 'reason');
    }
  }
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail('INVALID_GOVERNANCE_COMMAND', 'The governance command contains unsupported fields.');
  return normalized;
}

function sameSource(left, right) {
  return Boolean(left && right && left.blueprintId === right.blueprintId
    && left.blueprintVersion === right.blueprintVersion && left.snapshotHash === right.snapshotHash);
}

export function projectEnterpriseGovernance(project, blueprint = null, current = latestBlueprint(project), savedBy = () => true) {
  const entries = project.enterpriseGovernanceLedger ?? [];
  if (!Array.isArray(entries) || entries.length > ENTERPRISE_GOVERNANCE_LIMITS.entries
    || Buffer.byteLength(JSON.stringify(entries), 'utf8') > ENTERPRISE_GOVERNANCE_LIMITS.textBytes) {
    fail('GOVERNANCE_LEDGER_CORRUPT', 'The saved governance ledger is unavailable or exceeds its history limit.', 409);
  }
  let previousHash = null; let visiblePrefixLength = entries.length; let cutoffReached = false;
  for (let index = 0; index < entries.length; index += 1) {
    const { hash, ...core } = entries[index];
    if (entries[index].sequence !== index + 1 || entries[index].previousHash !== previousHash
      || hash !== digest(core) || !caseId(entries[index].caseId) || !validSource(entries[index].source)
      || typeof entries[index].actor !== 'string' || !entries[index].actor
      || typeof entries[index].reason !== 'string' || !entries[index].reason.trim() || entries[index].reason.length > 500
      || !Number.isFinite(Date.parse(entries[index].at))) {
      fail('GOVERNANCE_LEDGER_CORRUPT', 'The saved governance decision history failed its integrity check.', 409);
    }
    previousHash = hash;
    if (!cutoffReached && !savedBy(entries[index].at)) { visiblePrefixLength = index; cutoffReached = true; }
  }
  const cases = new Map();
  let visibleCases = new Map();
  if (visiblePrefixLength === 0) visibleCases = new Map();
  for (const entry of entries) {
    const event = structuredClone(entry);
    let item = cases.get(event.caseId);
    if (event.action === 'request-governance-decision') {
      if (item || event.caseRevision !== 1 || !safeId(event.objectId)
        || Object.hasOwn(event, 'outcome')
        || typeof event.title !== 'string' || !event.title.trim() || event.title.length > 160
        || typeof event.question !== 'string' || !event.question.trim() || event.question.length > 700
        || typeof event.proposedOption !== 'string' || !event.proposedOption.trim() || event.proposedOption.length > 300) {
        fail('GOVERNANCE_LEDGER_CORRUPT', 'A governance decision request has invalid identity or source data.', 409);
      }
      item = { id: event.caseId, title: event.title, question: event.question, proposedOption: event.proposedOption,
        objectId: event.objectId, source: structuredClone(event.source), requestedBy: event.actor,
        createdAt: event.at, requestReason: event.reason, status: 'REQUESTED', revision: 1,
        decisions: [], appeals: [], history: [] };
      cases.set(event.caseId, item);
    } else {
      if (!item || event.caseRevision !== item.revision + 1 || !sameSource(event.source, item.source)) {
        fail('GOVERNANCE_LEDGER_CORRUPT', 'A governance history entry has an invalid case revision or source.', 409);
      }
      if (event.action === 'decide-governance-decision' && item.status === 'REQUESTED'
        && ['APPROVE', 'DECLINE'].includes(event.outcome)) {
        item.status = 'DECIDED';
        item.decisions.push({ outcome: event.outcome, actor: event.actor, at: event.at, reason: event.reason, revision: event.caseRevision });
      } else if (event.action === 'appeal-governance-decision' && item.status === 'DECIDED'
        && event.actor === item.requestedBy && !Object.hasOwn(event, 'outcome')) {
        item.status = 'APPEALED';
        item.appeals.push({ actor: event.actor, at: event.at, reason: event.reason, revision: event.caseRevision, review: null });
      } else if (event.action === 'review-governance-appeal' && item.status === 'APPEALED'
        && ['UPHOLD', 'REOPEN'].includes(event.outcome)) {
        const appeal = item.appeals.at(-1);
        appeal.review = { outcome: event.outcome, actor: event.actor, at: event.at, reason: event.reason, revision: event.caseRevision };
        item.status = event.outcome === 'UPHOLD' ? 'DECISION_UPHELD' : 'REQUESTED';
      } else fail('GOVERNANCE_LEDGER_CORRUPT', 'The governance decision history contains an invalid transition.', 409);
      item.revision = event.caseRevision;
    }
    item.history.push({ sequence: event.sequence, hash: event.hash, action: event.action,
      actor: event.actor, at: event.at, reason: event.reason, caseRevision: event.caseRevision,
      outcome: event.outcome ?? null });
    if (event.sequence === visiblePrefixLength) {
      visibleCases = new Map([...cases].map(([id, value]) => [id, structuredClone(value)]));
    }
  }
  const selectedSource = blueprint ? { blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint) } : null;
  const currentSource = current ? { blueprintId: current.id, blueprintVersion: current.version, snapshotHash: digest(current) } : null;
  const visibleHead = visiblePrefixLength ? entries[visiblePrefixLength - 1].hash : null;
  return { ledgerLength: visiblePrefixLength, ledgerHead: visibleHead, cases: [...visibleCases.values()].map((item) => ({ ...item,
    appliesToContext: sameSource(item.source, selectedSource), sourceDrift: !sameSource(item.source, currentSource) })) };
}

export function applyEnterpriseGovernanceCommand(project, command, actor, now = new Date()) {
  const blueprint = latestBlueprint(project);
  const currentSource = blueprint ? { blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint) } : null;
  if (!blueprint || !sameSource(currentSource, { blueprintId: command.blueprintId,
    blueprintVersion: command.blueprintVersion, snapshotHash: command.snapshotHash })) {
    fail('GOVERNANCE_SOURCE_STALE', 'The saved design changed. Reload its current source before recording this governance action.', 409);
  }
  const projection = projectEnterpriseGovernance(project, blueprint, blueprint);
  const item = command.caseId ? projection.cases.find((entry) => entry.id === command.caseId) : null;
  if (command.caseId && !item) fail('GOVERNANCE_DECISION_NOT_FOUND', 'The governance decision was not found in this project.', 404);
  if (item && (!item.appliesToContext || item.sourceDrift)) fail('GOVERNANCE_SOURCE_STALE', 'This decision belongs to an older design source and is read-only.', 409);
  if (item && item.revision !== command.caseRevision) fail('GOVERNANCE_DECISION_STALE', 'The decision changed. Reload its latest revision before continuing.', 409);
  const object = command.kind === 'request-governance-decision'
    ? blueprintObjects(blueprint).find((entry) => entry.id === command.objectId) : null;
  if (command.kind === 'request-governance-decision' && !object) fail('GOVERNANCE_OBJECT_NOT_FOUND', 'The selected design record is not present in this source.', 404);
  if (command.kind === 'decide-governance-decision' && item?.status !== 'REQUESTED') fail('GOVERNANCE_DECISION_NOT_OPEN', 'Only an open request can receive a decision.', 409);
  if (command.kind === 'appeal-governance-decision' && (item?.status !== 'DECIDED' || item.requestedBy !== actor)) {
    fail('GOVERNANCE_APPEAL_NOT_ALLOWED', 'Only the requester may appeal a decision that has been recorded.', 403);
  }
  if (command.kind === 'review-governance-appeal' && item?.status !== 'APPEALED') fail('GOVERNANCE_APPEAL_NOT_OPEN', 'Only an open appeal can be reviewed.', 409);
  const entries = project.enterpriseGovernanceLedger ?? [];
  if (entries.length >= ENTERPRISE_GOVERNANCE_LIMITS.entries) fail('GOVERNANCE_LEDGER_LIMIT', 'This project reached its 2,000-entry governance history limit.', 409);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('INVALID_GOVERNANCE_TIME', 'Use a valid decision timestamp.');
  const at = now.toISOString(); const caseIdValue = item?.id ?? `governance-decision-${randomUUID()}`;
  const core = { sequence: entries.length + 1, previousHash: entries.at(-1)?.hash ?? null, caseId: caseIdValue,
    caseRevision: item ? item.revision + 1 : 1, action: command.kind, actor, at,
    source: currentSource, reason: command.reason,
    ...(object ? { objectId: object.id, title: command.title, question: command.question, proposedOption: command.proposedOption } : {}),
    ...(command.outcome ? { outcome: command.outcome } : {}) };
  const encoded = JSON.stringify([...entries, { ...core, hash: digest(core) }]);
  if (Buffer.byteLength(encoded, 'utf8') > ENTERPRISE_GOVERNANCE_LIMITS.textBytes) fail('GOVERNANCE_LEDGER_LIMIT', 'The governance decision ledger reached its 512 KiB storage limit.', 409);
  const ledgerEntry = { ...core, hash: digest(core) };
  project.enterpriseGovernanceLedger ??= []; project.enterpriseGovernanceLedger.push(ledgerEntry);
  project.audit ??= []; project.audit.push({ at, action: `enterprise.${command.kind}`, actor,
    detail: `Recorded ${command.kind.replaceAll('-', ' ')} for governance decision ${caseIdValue}; the design remains unchanged.` });
  const updated = projectEnterpriseGovernance(project, blueprint, blueprint).cases.find((entry) => entry.id === caseIdValue);
  return { blueprint, affectedObjectId: object?.id ?? item?.objectId ?? null, governanceCaseId: caseIdValue,
    governanceRevision: updated.revision, governanceStatus: updated.status, recordedAt: at };
}
