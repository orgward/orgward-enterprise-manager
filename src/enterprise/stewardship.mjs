import { randomUUID } from 'node:crypto';
import { latestBlueprint } from '../model.mjs';
import { digest } from '../sdlc/contracts.mjs';
import { blueprintObjects, enterpriseFailure, enterpriseText } from './types.mjs';

export const ENTERPRISE_STEWARDSHIP_KINDS = new Set(['assign-information-steward', 'record-information-stewardship-review']);
const LIMIT = Object.freeze({ entries: 4000, textBytes: 512 * 1024 });
const fail = (code, message, status = 400) => { throw enterpriseFailure(code, message, status); };
const safeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);
const validSource = (value) => value && /^blueprint-[0-9a-f-]{36}$/.test(value.blueprintId ?? '')
  && Number.isSafeInteger(value.blueprintVersion) && value.blueprintVersion > 0 && /^[a-f0-9]{64}$/.test(value.snapshotHash ?? '');
const sameSource = (left, right) => Boolean(left && right && left.blueprintId === right.blueprintId
  && left.blueprintVersion === right.blueprintVersion && left.snapshotHash === right.snapshotHash);

export function normalizeEnterpriseStewardshipCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ENTERPRISE_STEWARDSHIP_KINDS.has(input.kind)
    || !/^blueprint-[0-9a-f-]{36}$/.test(input.blueprintId ?? '') || !Number.isSafeInteger(input.blueprintVersion)
    || input.blueprintVersion < 1 || !/^[a-f0-9]{64}$/.test(input.snapshotHash ?? '') || !safeId(input.objectId)) {
    fail('INVALID_STEWARDSHIP_COMMAND', 'Bind this information stewardship action to an exact saved blueprint and information record.');
  }
  const command = { kind: input.kind, blueprintId: input.blueprintId, blueprintVersion: input.blueprintVersion,
    snapshotHash: input.snapshotHash, objectId: input.objectId };
  const allowed = ['kind', 'blueprintId', 'blueprintVersion', 'snapshotHash', 'objectId'];
  if (input.kind === 'assign-information-steward') {
    if (!safeId(input.roleId)) fail('INVALID_STEWARDSHIP_COMMAND', 'Choose a saved project role to steward this information record.');
    command.roleId = input.roleId; command.reason = enterpriseText(input.reason, 'Steward assignment reason', 500);
    allowed.push('roleId', 'reason');
  } else {
    if (!Number.isSafeInteger(input.assignmentRevision) || input.assignmentRevision < 1
      || !['CONFIRMED', 'NEEDS_ATTENTION', 'UNKNOWN'].includes(input.outcome)) {
      fail('INVALID_STEWARDSHIP_COMMAND', 'Choose the current steward assignment revision and a supported review outcome.');
    }
    command.assignmentRevision = input.assignmentRevision; command.outcome = input.outcome;
    command.reason = enterpriseText(input.reason, 'Stewardship review note', 1000);
    allowed.push('assignmentRevision', 'outcome', 'reason');
  }
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail('INVALID_STEWARDSHIP_COMMAND', 'The stewardship command contains unsupported fields.');
  return command;
}

export function projectEnterpriseStewardship(project, blueprint = null, current = latestBlueprint(project), savedBy = () => true) {
  const entries = project.enterpriseStewardshipLedger ?? [];
  if (!Array.isArray(entries) || entries.length > LIMIT.entries || Buffer.byteLength(JSON.stringify(entries), 'utf8') > LIMIT.textBytes) {
    fail('STEWARDSHIP_LEDGER_CORRUPT', 'The saved stewardship history is unavailable or exceeds its history limit.', 409);
  }
  let prior = null; let visibleLength = entries.length; let cutoff = false;
  for (let index = 0; index < entries.length; index += 1) {
    const { hash, ...core } = entries[index]; const event = entries[index];
    if (event.sequence !== index + 1 || event.previousHash !== prior || hash !== digest(core)
      || !validSource(event.source) || !safeId(event.objectId) || !['assign-information-steward', 'record-information-stewardship-review'].includes(event.action)
      || typeof event.actor !== 'string' || !event.actor || typeof event.reason !== 'string' || !event.reason.trim()
      || !Number.isFinite(Date.parse(event.at))) fail('STEWARDSHIP_LEDGER_CORRUPT', 'The saved stewardship history failed its integrity check.', 409);
    prior = hash;
    if (!cutoff && !savedBy(event.at)) { visibleLength = index; cutoff = true; }
  }
  const all = new Map(); let visible = new Map();
  for (const event of entries) {
    let item = all.get(event.objectId);
    if (event.action === 'assign-information-steward') {
      if (!safeId(event.roleId) || event.assignmentRevision !== (item?.assignmentRevision ?? 0) + 1
        || Object.hasOwn(event, 'outcome')) fail('STEWARDSHIP_LEDGER_CORRUPT', 'A steward assignment has an invalid revision or role.', 409);
      item = item ?? { objectId: event.objectId, history: [], reviews: [] };
      Object.assign(item, { roleId: event.roleId, assignmentRevision: event.assignmentRevision,
        source: structuredClone(event.source), assignedBy: event.actor, assignedAt: event.at, assignmentReason: event.reason,
        latestReview: null });
      all.set(event.objectId, item);
    } else {
      if (!item || event.assignmentRevision !== item.assignmentRevision || !sameSource(event.source, item.source)
        || !['CONFIRMED', 'NEEDS_ATTENTION', 'UNKNOWN'].includes(event.outcome)) {
        fail('STEWARDSHIP_LEDGER_CORRUPT', 'A steward review does not match its current assignment or outcome.', 409);
      }
      const review = { outcome: event.outcome, actor: event.actor, at: event.at, reason: event.reason,
        assignmentRevision: event.assignmentRevision, sequence: event.sequence, hash: event.hash };
      item.reviews.push(review); item.latestReview = review;
    }
    item.history.push({ sequence: event.sequence, hash: event.hash, action: event.action, actor: event.actor,
      at: event.at, reason: event.reason, assignmentRevision: event.assignmentRevision,
      roleId: event.roleId ?? null, outcome: event.outcome ?? null,
      source: { blueprintId: event.source.blueprintId, blueprintVersion: event.source.blueprintVersion,
        snapshotHash: event.source.snapshotHash } });
    if (event.sequence === visibleLength) visible = new Map([...all].map(([id, value]) => [id, structuredClone(value)]));
  }
  const selected = blueprint ? { blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint) } : null;
  const currentSource = current ? { blueprintId: current.id, blueprintVersion: current.version, snapshotHash: digest(current) } : null;
  if (visibleLength === 0) visible = new Map();
  const roleNames = Object.fromEntries(blueprintObjects(blueprint ?? current ?? {}).filter((entry) => entry.type === 'role')
    .map((entry) => [entry.id, entry.name]));
  return { ledgerLength: visibleLength, ledgerHead: visibleLength ? entries[visibleLength - 1].hash : null, roleNames,
    assignments: [...visible.values()].map((item) => ({ ...item,
      appliesToContext: sameSource(item.source, selected), sourceDrift: !sameSource(item.source, currentSource) })) };
}

export function applyEnterpriseStewardshipCommand(project, command, actor, now = new Date()) {
  const blueprint = latestBlueprint(project);
  const source = blueprint ? { blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint) } : null;
  if (!blueprint || !sameSource(source, command)) fail('STEWARDSHIP_SOURCE_STALE', 'Reload the current saved blueprint before changing stewardship.', 409);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('INVALID_STEWARDSHIP_TIME', 'Use a valid stewardship timestamp.');
  const objects = blueprintObjects(blueprint); const target = objects.find((entry) => entry.id === command.objectId && entry.type === 'information');
  if (!target) fail('STEWARDSHIP_INFORMATION_NOT_FOUND', 'Choose a saved information record from this blueprint.', 404);
  const projected = projectEnterpriseStewardship(project, blueprint, blueprint);
  const latestAssignment = projected.assignments.find((entry) => entry.objectId === target.id);
  const existing = latestAssignment?.appliesToContext && !latestAssignment.sourceDrift ? latestAssignment : null;
  let assignmentRevision; let roleId = null;
  if (command.kind === 'assign-information-steward') {
    const role = objects.find((entry) => entry.id === command.roleId && entry.type === 'role');
    if (!role) fail('STEWARDSHIP_ROLE_NOT_FOUND', 'Choose a saved project role from this blueprint.', 404);
    assignmentRevision = (latestAssignment?.assignmentRevision ?? 0) + 1; roleId = role.id;
  } else {
    if (!existing || existing.assignmentRevision !== command.assignmentRevision) fail('STEWARDSHIP_ASSIGNMENT_STALE', 'The steward assignment changed. Reload before recording a review.', 409);
    assignmentRevision = existing.assignmentRevision; roleId = existing.roleId;
  }
  const entries = project.enterpriseStewardshipLedger ?? [];
  if (entries.length >= LIMIT.entries) fail('STEWARDSHIP_LEDGER_LIMIT', 'This project reached its stewardship history limit.', 409);
  const at = now.toISOString();
  const core = { sequence: entries.length + 1, previousHash: entries.at(-1)?.hash ?? null,
    action: command.kind, assignmentRevision, objectId: target.id, ...(roleId ? { roleId } : {}),
    ...(command.outcome ? { outcome: command.outcome } : {}), actor, at, source, reason: command.reason };
  const event = { ...core, hash: digest(core) };
  if (Buffer.byteLength(JSON.stringify([...entries, event]), 'utf8') > LIMIT.textBytes) fail('STEWARDSHIP_LEDGER_LIMIT', 'The stewardship history reached its storage limit.', 409);
  project.enterpriseStewardshipLedger ??= []; project.enterpriseStewardshipLedger.push(event);
  project.audit ??= []; project.audit.push({ at, action: `enterprise.${command.kind}`, actor,
    detail: `${command.kind === 'assign-information-steward' ? 'Assigned' : 'Recorded a review for'} information record ${target.id}${roleId ? ` under role ${roleId}` : ''}.` });
  return { blueprint, affectedObjectId: target.id, stewardshipRoleId: roleId,
    stewardshipRevision: assignmentRevision, stewardshipOutcome: command.outcome ?? null, recordedAt: at };
}
