import path from 'node:path';
import { digest } from '../sdlc/contracts.mjs';

const PROFILE_KEYS = new Set(['id', 'version', 'executable', 'args', 'timeoutMs', 'bubblewrapExecutable', 'profileHash']);

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
