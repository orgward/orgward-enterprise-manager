import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['--test', 'tests/platform/release-bundle.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, ORGWARD_FRESH_INSTALL_QUALIFICATION: '1' },
});
child.once('error', (error) => {
  process.stderr.write(`Could not start release install qualification: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
