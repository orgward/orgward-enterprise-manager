import { accessSync, constants as fsConstants } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const caddyBinary = process.env.ORGWARD_CADDY_BIN;
if (!caddyBinary || !path.isAbsolute(caddyBinary)) {
  process.stderr.write('Set ORGWARD_CADDY_BIN to an absolute path for a Caddy v2 executable.\n');
  process.exitCode = 2;
} else {
  try { accessSync(caddyBinary, fsConstants.X_OK); }
  catch {
    process.stderr.write('ORGWARD_CADDY_BIN must point to an executable Caddy v2 binary.\n');
    process.exitCode = 2;
  }
}

if (process.exitCode !== 2) {
  const child = spawn(process.execPath, ['--test', 'tests/platform/release-bundle.test.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, ORGWARD_CADDY_BIN: caddyBinary },
  });
  child.once('error', (error) => {
    process.stderr.write(`Could not start Caddy release qualification: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
