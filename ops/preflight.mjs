import { runInstallPreflight } from '../src/platform/install-config.mjs';

const result = await runInstallPreflight();
for (const issue of result.issues) {
  const label = issue.severity === 'notice' ? 'NOTICE' : 'ERROR';
  console.log(`${label} ${issue.check}: ${issue.message}\n  Remedy: ${issue.remedy}`);
}
if (result.database) {
  const state = result.database.uninitialized ? 'empty database; startup will apply migrations'
    : result.database.pendingMigrations ? 'compatible schema; startup has pending migrations'
      : `schema ${result.database.schemaVersion} is current`;
  console.log(`Database: PostgreSQL ${result.database.serverVersion}; ${state}.`);
}
if (!result.ok) {
  console.error('Preflight failed. Correct the listed issues and run npm run preflight again.');
  process.exitCode = 1;
} else {
  console.log('Preflight passed. No database or local application data was changed.');
}
