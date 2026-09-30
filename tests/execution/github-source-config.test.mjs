import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { parseInstallConfig } from '../../src/platform/install-config.mjs';

test('GitHub App source configuration is optional, server-side, and requires ID plus PEM together', () => {
  const base = { HOST: '127.0.0.1', ORGWARD_AUTH_MODE: 'development', ORGWARD_ALLOW_LEGACY_JSON: 'true' };
  const disabled = parseInstallConfig(base);
  assert.equal(disabled.config.githubApp, null);
  assert.equal(disabled.issues.some((issue) => issue.check.startsWith('github-app-')), false);

  const partial = parseInstallConfig({ ...base, ORGWARD_GITHUB_APP_ID: '123' });
  assert.equal(partial.config.githubApp, null);
  assert.ok(partial.issues.some((issue) => issue.check === 'github-app-prerequisites'));

  const privateKey = '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----';
  const configured = parseInstallConfig({ ...base, ORGWARD_GITHUB_APP_ID: '123', ORGWARD_GITHUB_APP_PRIVATE_KEY: privateKey });
  assert.deepEqual(configured.config.githubApp, { appId: '123', privateKey });
  assert.equal(JSON.stringify(configured.issues).includes(privateKey), false);
  const { privateKey: rsaKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const downloadedGitHubRsaKey = rsaKey.export({ type: 'pkcs1', format: 'pem' });
  const rsaConfigured = parseInstallConfig({ ...base, ORGWARD_GITHUB_APP_ID: '123', ORGWARD_GITHUB_APP_PRIVATE_KEY: downloadedGitHubRsaKey });
  assert.deepEqual(rsaConfigured.config.githubApp, { appId: '123', privateKey: downloadedGitHubRsaKey });
  assert.equal(rsaConfigured.issues.some((issue) => issue.check === 'github-app-private-key'), false);
  assert.ok(createSign('RSA-SHA256').update('fixture').sign(rsaConfigured.config.githubApp.privateKey).length > 0);
});
