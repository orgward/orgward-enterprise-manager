import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyProviderTransportFailure, providerOutcomeDiagnosticForAttempt } from '../../src/execution/provider-transport-diagnostic.mjs';

test('Node provider transport codes map to a closed diagnostic class list', () => {
  const cases = [
    ['ENOTFOUND', 'dns_resolution_failed'],
    ['EAI_AGAIN', 'dns_resolution_failed'],
    ['ECONNREFUSED', 'connection_refused'],
    ['ECONNRESET', 'connection_reset'],
    ['ETIMEDOUT', 'transport_timeout'],
    ['ESOCKETTIMEDOUT', 'transport_timeout'],
    ['ERR_SOCKET_TIMEOUT', 'transport_timeout'],
  ];
  for (const [code, expected] of cases) {
    assert.equal(classifyProviderTransportFailure({ code, message: 'private canary' }), expected, code);
  }
  assert.equal(classifyProviderTransportFailure({ code: 'ECONNREFUSED', message: 'private canary' }, { timedOut: true }), 'transport_timeout');
  for (const error of [
    { code: 'EACCES', message: 'private canary' }, { code: 'PRIVATE-CODE', message: 'private canary' },
    { message: 'ECONNRESET private canary' }, new Error('private canary'), null,
  ]) assert.equal(classifyProviderTransportFailure(error), null);
});

test('only an unknown durable dispatch attempt exposes bounded allowlisted DeepSeek details', () => {
  const canary = 'private transport message request-id raw-body';
  assert.equal(providerOutcomeDiagnosticForAttempt('handed_off', {
    provider: 'deepseek', httpStatus: 503, parserFailureClass: 'invalid_json', transportFailureClass: 'connection_reset', message: canary,
  }), null);
  assert.deepEqual(providerOutcomeDiagnosticForAttempt('outcome_unknown', {
    provider: 'deepseek', httpStatus: 503, parserFailureClass: 'invalid_json', transportFailureClass: 'connection_reset',
    message: canary, code: 'ECONNRESET', body: canary, requestId: canary,
  }), { outcome: 'outcome_unknown', provider: 'deepseek', httpStatus: 503,
    parserFailureClass: 'invalid_json', transportFailureClass: 'connection_reset' });
  assert.deepEqual(providerOutcomeDiagnosticForAttempt('outcome_unknown', {
    provider: 'deepseek', httpStatus: 99, parserFailureClass: canary, transportFailureClass: canary,
    message: canary, code: 'PRIVATE-CODE', body: canary, requestId: canary,
  }), { outcome: 'outcome_unknown' });
  assert.deepEqual(providerOutcomeDiagnosticForAttempt('outcome_unknown', {
    provider: 'openai', httpStatus: 503, parserFailureClass: 'invalid_json', transportFailureClass: 'connection_reset', message: canary,
  }), { outcome: 'outcome_unknown' });
  assert.deepEqual(providerOutcomeDiagnosticForAttempt('outcome_unknown', {
    provider: 'deepseek', httpStatus: 599, parserFailureClass: 'incomplete_response',
    transportFailureClass: 'dns_resolution_failed',
  }), { outcome: 'outcome_unknown', provider: 'deepseek', httpStatus: 599,
    parserFailureClass: 'incomplete_response', transportFailureClass: 'dns_resolution_failed' });
  assert.deepEqual(providerOutcomeDiagnosticForAttempt('outcome_unknown', {
    provider: 'deepseek', httpStatus: 600, message: canary, body: canary,
  }), { outcome: 'outcome_unknown' });
});
