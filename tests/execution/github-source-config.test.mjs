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
  const missingSlug = parseInstallConfig({ ...base, ORGWARD_GITHUB_APP_ID: '123', ORGWARD_GITHUB_APP_PRIVATE_KEY: privateKey });
  assert.ok(missingSlug.issues.some((issue) => issue.check === 'github-app-slug-required'));
  const oauth = { ORGWARD_GITHUB_APP_CLIENT_ID: 'Iv1.fixture-client',
    ORGWARD_GITHUB_APP_CLIENT_SECRET: 'fixture-client-secret-value',
    ORGWARD_GITHUB_APP_OAUTH_REDIRECT_URI: 'https://orgward.example/api/execution/github-installation/oauth-callback' };
  const configured = parseInstallConfig({ ...base, ...oauth, ORGWARD_GITHUB_APP_ID: '123', ORGWARD_GITHUB_APP_PRIVATE_KEY: privateKey, ORGWARD_GITHUB_APP_SLUG: 'orgward-fixture' });
  assert.deepEqual(configured.config.githubApp, { appId: '123', privateKey, appSlug: 'orgward-fixture',
    clientId: oauth.ORGWARD_GITHUB_APP_CLIENT_ID, clientSecret: oauth.ORGWARD_GITHUB_APP_CLIENT_SECRET,
    oauthRedirectUri: oauth.ORGWARD_GITHUB_APP_OAUTH_REDIRECT_URI });
  assert.equal(JSON.stringify(configured.issues).includes(privateKey), false);
  assert.equal(JSON.stringify(configured.issues).includes(oauth.ORGWARD_GITHUB_APP_CLIENT_SECRET), false);
  const mismatchedOAuth = parseInstallConfig({ ...base, ORGWARD_GITHUB_APP_ID: '123',
    ORGWARD_GITHUB_APP_PRIVATE_KEY: privateKey, ORGWARD_GITHUB_APP_CLIENT_ID: 'Iv1.fixture-client' });
  assert.ok(mismatchedOAuth.issues.some((issue) => issue.check === 'github-app-oauth-prerequisites'));
  assert.ok(mismatchedOAuth.issues.some((issue) => issue.check === 'github-app-oauth-redirect-required'));
  const { privateKey: rsaKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const downloadedGitHubRsaKey = rsaKey.export({ type: 'pkcs1', format: 'pem' });
  const rsaConfigured = parseInstallConfig({ ...base, ...oauth, ORGWARD_GITHUB_APP_ID: '123', ORGWARD_GITHUB_APP_PRIVATE_KEY: downloadedGitHubRsaKey, ORGWARD_GITHUB_APP_SLUG: 'orgward-fixture' });
  assert.deepEqual(rsaConfigured.config.githubApp, { appId: '123', privateKey: downloadedGitHubRsaKey, appSlug: 'orgward-fixture',
    clientId: oauth.ORGWARD_GITHUB_APP_CLIENT_ID, clientSecret: oauth.ORGWARD_GITHUB_APP_CLIENT_SECRET,
    oauthRedirectUri: oauth.ORGWARD_GITHUB_APP_OAUTH_REDIRECT_URI });
  assert.equal(rsaConfigured.issues.some((issue) => issue.check === 'github-app-private-key'), false);
  assert.ok(createSign('RSA-SHA256').update('fixture').sign(rsaConfigured.config.githubApp.privateKey).length > 0);
});
