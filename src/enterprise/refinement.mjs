import { digest } from '../sdlc/contracts.mjs';
import { enterpriseFailure } from './types.mjs';

export const REFINEMENT_LIMITS = { linksPerRecord: 12, traceDepth: 32 };
const objectId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,119}$/i.test(value);

export function normalizeRefinementTargets(targets, byId, sourceId) {
  if (!Array.isArray(targets) || targets.length > REFINEMENT_LIMITS.linksPerRecord
    || new Set(targets).size !== targets.length || targets.some((id) => !objectId(id) || id === sourceId || !byId.has(id))) {
    throw enterpriseFailure('INVALID_REFINEMENT_REFERENCE', 'Choose at most twelve distinct existing blueprint records that this record refines.', 400);
  }
  return [...targets];
}

export function refinementModelErrors(objects) {
  const errors = []; const byId = new Map(objects.map((object) => [object.id, object]));
  for (const object of objects) {
    if (!Object.hasOwn(object, 'refines')) continue;
    try { normalizeRefinementTargets(object.refines, byId, object.id); }
    catch (error) { errors.push({ code: error.code ?? 'INVALID_REFINEMENT_REFERENCE', path: object.id, message: error.message }); }
  }
  const colors = new Map(); const stack = []; let hasCycle = false;
  const visit = (id) => {
    colors.set(id, 1); stack.push(id);
    const targets = byId.get(id)?.refines;
    if (Array.isArray(targets)) for (const target of targets) {
      if (!byId.has(target)) continue;
      if (colors.get(target) === 1) {
        hasCycle = true;
        const start = stack.indexOf(target);
        errors.push({ code: 'REFINEMENT_CYCLE', path: target,
          message: `Refinement cycle: ${[...stack.slice(start), target].join(' → ')}.` });
      } else if (!colors.has(target)) visit(target);
    }
    stack.pop(); colors.set(id, 2);
  };
  for (const object of objects) if (!colors.has(object.id)) visit(object.id);
  if (!hasCycle) {
    const depths = new Map();
    const longestPath = (id) => {
      if (depths.has(id)) return depths.get(id);
      const targets = byId.get(id)?.refines;
      const depth = Array.isArray(targets) ? Math.max(0, ...targets.filter((target) => byId.has(target)).map((target) => 1 + longestPath(target))) : 0;
      depths.set(id, depth); return depth;
    };
    for (const object of objects) if (longestPath(object.id) > REFINEMENT_LIMITS.traceDepth) {
      errors.push({ code: 'REFINEMENT_DEPTH_LIMIT', path: object.id, message: `Refinement paths are limited to ${REFINEMENT_LIMITS.traceDepth} links.` });
    }
  }
  return errors;
}

export function refinementModelRelations(objects) {
  return objects.flatMap((object) => (Array.isArray(object.refines) ? object.refines : []).filter((target) => typeof target === 'string' && target !== object.id)
    .map((target) => ({ id: `${object.id}--refines--${target}`, source: object.id, target, type: 'refines' })));
}

export function projectRefinementTrace(objects, selectedId) {
  const selected = objects.find((object) => object.id === selectedId);
  if (!selected) return null;
  const byId = new Map(objects.map((object) => [object.id, object]));
  const children = new Map(objects.map((object) => [object.id, []]));
  for (const object of objects) for (const target of (Array.isArray(object.refines) ? object.refines : [])) if (children.has(target)) children.get(target).push(object.id);
  const traverse = (first, direction) => {
    const result = []; const queue = [{ id: first, path: [selectedId], depth: 0 }]; const seen = new Set([selectedId]); let truncated = false;
    while (queue.length && !truncated) {
      const current = queue.shift(); if (current.depth >= REFINEMENT_LIMITS.traceDepth) continue;
      const refs = byId.get(current.id)?.refines;
      const nextIds = direction === 'up' ? (Array.isArray(refs) ? refs : []) : (children.get(current.id) ?? []);
      for (const nextId of [...nextIds].sort()) {
        if (seen.has(nextId) || !byId.has(nextId)) continue;
        if (result.length >= 256) { truncated = true; break; }
        seen.add(nextId); const path = direction === 'up' ? [...current.path, nextId] : [...current.path, nextId];
        result.push({ id: nextId, name: byId.get(nextId).name, type: byId.get(nextId).type, depth: current.depth + 1, path });
        queue.push({ id: nextId, path, depth: current.depth + 1 });
      }
    }
    return { entries: result.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), truncated };
  };
  const ancestorTrace = traverse(selectedId, 'up'); const descendantTrace = traverse(selectedId, 'down');
  const ancestors = ancestorTrace.entries; const descendants = descendantTrace.entries;
  const truncated = { ancestors: ancestorTrace.truncated, descendants: descendantTrace.truncated };
  return { selectedId, selectedName: selected.name, ancestors, descendants, linkCount: ancestors.length + descendants.length,
    truncated, complete: !truncated.ancestors && !truncated.descendants,
    status: truncated.ancestors || truncated.descendants ? 'TRUNCATED' : ancestors.length || descendants.length ? 'LINKED' : 'UNLINKED', meaning: 'PROPOSED_DESIGN_TRACE',
    explanation: 'Refinement links show proposed design decomposition. They do not establish implementation, evidence or operating status.',
    traceHash: digest({ selectedId, ancestors, descendants }) };
}
