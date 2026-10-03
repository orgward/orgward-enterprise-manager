import path from 'node:path';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { digest } from '../sdlc/contracts.mjs';

const PROFILE_KEYS = new Set(['id', 'version', 'executable', 'args', 'timeoutMs', 'bubblewrapExecutable', 'profileHash']);
const PLAN_KEYS = new Set(['id', 'version', 'requiredChecks', 'planHash', 'legacySingleCheck']);

function executableArtifactDigest(executable) {
  let descriptor;
  try {
    descriptor = openSync(executable, 'r');
    if (!fstatSync(descriptor).isFile()) return null;
    const hasher = createHash('sha256');
    const chunk = Buffer.alloc(64 * 1024);
    let length;
    while ((length = readSync(descriptor, chunk, 0, chunk.length, null)) > 0) hasher.update(chunk.subarray(0, length));
    return hasher.digest('hex');
  } catch { return null; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

export function githubCheckToolDigestsMatch(check) {
  return executableArtifactDigest(check.executable) === (check.toolDigest ?? null)
    && executableArtifactDigest(check.bubblewrapExecutable) === (check.sandboxToolDigest ?? null);
}

export function parseGitHubVerifierProfile(value) {
  if (value == null || value === '') return null;
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); }
    catch { throw new Error('ORGWARD_GITHUB_VERIFIER must contain a JSON object with a fixed executable and argv.'); }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some((key) => !PROFILE_KEYS.has(key))
    || !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(source.id ?? '')
    || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(source.version ?? '')
    || !path.isAbsolute(source.executable ?? '') || source.executable.includes('\0')
    || !Array.isArray(source.args) || source.args.length > 32
    || source.args.some((arg) => typeof arg !== 'string' || arg.length > 500 || arg.includes('\0'))
    || (source.timeoutMs !== undefined && (!Number.isSafeInteger(source.timeoutMs) || source.timeoutMs < 100 || source.timeoutMs > 120_000))
    || (source.bubblewrapExecutable !== undefined && (!path.isAbsolute(source.bubblewrapExecutable) || source.bubblewrapExecutable.includes('\0')))) {
    throw new Error('ORGWARD_GITHUB_VERIFIER must use a versioned absolute executable, fixed argv, bounded timeout, and no extra fields.');
  }
  const executableName = path.basename(source.executable).toLowerCase();
  if (['sh', 'bash', 'dash', 'zsh', 'fish', 'csh', 'tcsh'].includes(executableName)
    || source.args.some((arg) => arg === '-c' || arg === '--command')) {
    throw new Error('ORGWARD_GITHUB_VERIFIER cannot invoke a shell command string.');
  }
  const normalized = {
    id: source.id, version: source.version, executable: source.executable,
    args: [...source.args], timeoutMs: source.timeoutMs ?? 120_000,
    bubblewrapExecutable: source.bubblewrapExecutable ?? '/usr/bin/bwrap',
  };
  const profileHash = digest(normalized);
  if (source.profileHash !== undefined && source.profileHash !== profileHash) {
    throw new Error('ORGWARD_GITHUB_VERIFIER profileHash does not match its fixed executable and argv.');
  }
  return Object.freeze({ ...normalized, args: Object.freeze(normalized.args), profileHash });
}

// The flat verifier remains accepted as an explicitly single-check legacy plan.
// New operator configuration can provide an ordered requiredChecks array.
export function parseGitHubCheckPlan(value) {
  if (value == null || value === '') return null;
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); }
    catch { throw new Error('The GitHub check plan must be valid JSON.'); }
  }
  const legacy = source?.legacySingleCheck === true || !Array.isArray(source?.requiredChecks);
  const plan = legacy
    ? { id: 'legacy-single-verifier', version: '1.0.0', requiredChecks: [source] }
    : source;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)
    || Object.keys(plan).some((key) => !PLAN_KEYS.has(key))
    || !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(plan.id ?? '')
    || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(plan.version ?? '')
    || !Array.isArray(plan.requiredChecks) || !plan.requiredChecks.length || plan.requiredChecks.length > 12) {
    throw new Error('The GitHub check plan must be a versioned operator-owned plan with at least one required check and no extra fields.');
  }
  const requiredChecks = plan.requiredChecks.map((check) => {
    if (check && typeof check === 'object' && check.commandHash !== undefined) {
      const expectedSandbox = { kind: 'bubblewrap-read-only', executable: check.bubblewrapExecutable ?? '/usr/bin/bwrap' };
      if (check.sandboxPolicy && digest(check.sandboxPolicy) !== digest(expectedSandbox)) return null;
      const { commandHash, sandboxPolicy, toolDigest, sandboxToolDigest, ...profile } = check;
      const parsed = parseGitHubVerifierProfile(profile);
      const actualToolDigest = parsed && executableArtifactDigest(parsed.executable);
      const actualSandboxToolDigest = parsed && executableArtifactDigest(parsed.bubblewrapExecutable);
      const actualCommandHash = parsed && digest({ profileHash: parsed.profileHash, toolDigest: actualToolDigest,
        sandboxToolDigest: actualSandboxToolDigest });
      return parsed && actualCommandHash === commandHash && (toolDigest ?? null) === actualToolDigest
        && (sandboxToolDigest ?? null) === actualSandboxToolDigest
        ? { ...parsed, commandHash, toolDigest: actualToolDigest, sandboxToolDigest: actualSandboxToolDigest, sandboxPolicy: expectedSandbox } : null;
    }
    return parseGitHubVerifierProfile(check);
  });
  if (requiredChecks.some((check) => !check) || new Set(requiredChecks.map((check) => check.id)).size !== requiredChecks.length) {
    throw new Error('The GitHub check plan must contain unique, valid fixed checks.');
  }
  const normalizedChecks = requiredChecks.map(({ profileHash, commandHash: providedCommandHash, ...check }) => {
    const toolDigest = executableArtifactDigest(check.executable);
    const sandboxToolDigest = executableArtifactDigest(check.bubblewrapExecutable);
    return { ...check, toolDigest, sandboxToolDigest,
      commandHash: providedCommandHash ?? digest({ profileHash, toolDigest, sandboxToolDigest }),
      sandboxPolicy: { kind: 'bubblewrap-read-only', executable: check.bubblewrapExecutable } };
  });
  const normalized = { id: plan.id, version: plan.version, requiredChecks: normalizedChecks, legacySingleCheck: legacy };
  const planHash = digest(normalized);
  if (plan.planHash !== undefined && plan.planHash !== planHash) throw new Error('The GitHub check plan hash does not match its fixed checks.');
  return Object.freeze({ ...normalized, requiredChecks: Object.freeze(normalizedChecks.map((check) => Object.freeze({
    ...check, args: Object.freeze([...check.args]), sandboxPolicy: Object.freeze(check.sandboxPolicy),
  }))), planHash });
}
