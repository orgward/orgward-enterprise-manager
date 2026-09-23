import { readFile, symlink, writeFile } from 'node:fs/promises';

const [hostCanaryPath, port] = process.argv.slice(2);
let hostCanaryReadable = false;
try { await readFile(hostCanaryPath); hostCanaryReadable = true; } catch { /* Host paths are absent from the sandbox. */ }

let networkReachable = false;
try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) }); networkReachable = true; } catch { /* Host networking is not shared. */ }

let contextWritable = true;
try { await writeFile(process.env.ORGWARD_CONTEXT_PATH, 'tampered'); } catch { contextWritable = false; }
await writeFile('sandbox-probe.json', JSON.stringify({
  hostCanaryReadable, networkReachable, contextWritable,
  leakedEnvironment: process.env.HOST_SECRET_CANARY ?? null,
}));
await symlink(hostCanaryPath, 'host-canary-link');
