import { digest } from '../sdlc/contracts.mjs';
import { parseGitHubCheckPlan } from './github-verifier-profile.mjs';

const BUILD_KEYS = new Set(['id', 'version', 'executable', 'args', 'timeoutMs', 'bubblewrapExecutable', 'requiredOutputs',
  'toolDigest', 'sandboxToolDigest', 'commandHash', 'outputMount', 'planHash']);

function validOutputPath(value) {
  return typeof value === 'string' && value.length <= 240 && !value.startsWith('/') && !value.includes('\\')
    && !value.includes('\0') && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

export function parseGitHubBuildPlan(value) {
  if (value == null || value === '') return null;
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); }
    catch { throw new Error('The GitHub build plan must be valid JSON.'); }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some((key) => !BUILD_KEYS.has(key))
    || !Array.isArray(source.requiredOutputs) || !source.requiredOutputs.length || source.requiredOutputs.length > 64
    || source.requiredOutputs.some((entry) => !validOutputPath(entry))
    || new Set(source.requiredOutputs).size !== source.requiredOutputs.length) {
    throw new Error('The GitHub build plan requires a versioned fixed command and one to 64 unique relative output paths.');
  }
  const checkPlan = parseGitHubCheckPlan({ id: source.id, version: source.version,
    requiredChecks: [{ id: source.id, version: source.version, executable: source.executable, args: source.args,
      timeoutMs: source.timeoutMs, bubblewrapExecutable: source.bubblewrapExecutable }] });
  const tool = checkPlan.requiredChecks[0];
  const normalized = { id: source.id, version: source.version, executable: tool.executable, args: [...tool.args],
    timeoutMs: tool.timeoutMs, bubblewrapExecutable: tool.bubblewrapExecutable,
    toolDigest: tool.toolDigest, sandboxToolDigest: tool.sandboxToolDigest, commandHash: tool.commandHash,
    outputMount: '/build-output', requiredOutputs: [...source.requiredOutputs] };
  if ((source.toolDigest !== undefined && source.toolDigest !== normalized.toolDigest)
    || (source.sandboxToolDigest !== undefined && source.sandboxToolDigest !== normalized.sandboxToolDigest)
    || (source.commandHash !== undefined && source.commandHash !== normalized.commandHash)
    || (source.outputMount !== undefined && source.outputMount !== '/build-output')) {
    throw new Error('The GitHub build plan command or sandbox tool changed after it was pinned.');
  }
  const planHash = digest(normalized);
  if (source.planHash !== undefined && source.planHash !== planHash) throw new Error('The GitHub build plan hash does not match its fixed command and outputs.');
  return Object.freeze({ ...normalized, args: Object.freeze(normalized.args), requiredOutputs: Object.freeze(normalized.requiredOutputs), planHash });
}
