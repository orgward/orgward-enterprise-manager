import assert from 'node:assert/strict';
import test from 'node:test';
import { deepSeekOutcomeDiagnostic, deepSeekOutcomeDiagnosticCopy } from '../../public/provider-outcome-diagnostic.mjs';

test('DeepSeek outcome diagnostics project only allowlisted status and parser classes', () => {
  assert.equal(deepSeekOutcomeDiagnosticCopy({ outcome: 'outcome_unknown', httpStatus: 503, body: 'private' }),
    'Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.deepEqual(deepSeekOutcomeDiagnostic({ provider: 'deepseek', httpStatus: 503, body: 'private-body', requestId: 'private-id' }), {
    provider: 'deepseek', httpStatus: 503,
  });
  assert.equal(deepSeekOutcomeDiagnosticCopy({ provider: 'deepseek', httpStatus: 503,
    body: 'private-body', requestId: 'private-id', url: 'https://private.example' }),
  'DeepSeek returned HTTP 503. Delivery remains unverified; this run cannot be retried.');
  assert.deepEqual(deepSeekOutcomeDiagnostic({ provider: 'deepseek', httpStatus: 200, parserFailureClass: 'invalid_json', body: 'private-body' }), {
    provider: 'deepseek', httpStatus: 200, parserFailureClass: 'invalid_json',
  });
  assert.equal(deepSeekOutcomeDiagnosticCopy({ provider: 'deepseek', parserFailureClass: 'missing_output_text', body: 'private-body' }),
    'response parsing failed (missing output text). Delivery remains unverified; this run cannot be retried.');
  const canary = 'raw-provider-body-canary';
  const combinedCopy = deepSeekOutcomeDiagnosticCopy({ provider: 'deepseek', httpStatus: 200,
    parserFailureClass: 'invalid_json', body: canary, requestId: canary, parserError: canary });
  assert.equal(combinedCopy,
    'DeepSeek returned HTTP 200; response parsing failed (invalid JSON). Delivery remains unverified; this run cannot be retried.');
  assert.equal(combinedCopy.includes(canary), false);
  assert.equal(deepSeekOutcomeDiagnosticCopy({ provider: 'deepseek', httpStatus: 200,
    parserFailureClass: 'private-canary', body: canary }),
  'DeepSeek returned HTTP 200. Delivery remains unverified; this run cannot be retried.');
  for (const value of [null, '503', [], { provider: 'openai', httpStatus: 503 },
    { provider: 'deepseek', httpStatus: 99 }, { provider: 'deepseek', httpStatus: 600 },
    { provider: 'deepseek', httpStatus: 503.5 }, { provider: 'deepseek', parserFailureClass: 'secret-marker' }]) {
    assert.equal(deepSeekOutcomeDiagnostic(value), null);
    assert.equal(deepSeekOutcomeDiagnosticCopy(value), null);
  }
});

test('HTTP 401 copy directs admins to verify the saved credential without asserting its cause', () => {
  const canary = 'private-response-body-canary';
  assert.equal(deepSeekOutcomeDiagnosticCopy({ outcome: 'outcome_unknown', provider: 'deepseek', httpStatus: 401, body: canary }),
    'Outcome unknown. DeepSeek returned HTTP 401. An administrator should check and verify the saved provider credential; this status alone does not identify the cause. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  const nonUnknown = deepSeekOutcomeDiagnosticCopy({ provider: 'deepseek', httpStatus: 401, body: canary });
  assert.equal(nonUnknown,
    'DeepSeek returned HTTP 401. An administrator should check and verify the saved provider credential; this status alone does not identify the cause. Delivery remains unverified; this run cannot be retried.');
  assert.equal(nonUnknown.includes(canary), false);
  assert.equal(deepSeekOutcomeDiagnosticCopy({ outcome: 'outcome_unknown', provider: 'deepseek', httpStatus: 403 }),
    'Outcome unknown. DeepSeek returned HTTP 403. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(deepSeekOutcomeDiagnosticCopy({ provider: 'deepseek', httpStatus: 403 }),
    'DeepSeek returned HTTP 403. Delivery remains unverified; this run cannot be retried.');
});

test('DeepSeek transport diagnostics expose only fixed safe copy, including unknown outcomes', () => {
  const canary = 'private-transport-message-canary';
  assert.deepEqual(deepSeekOutcomeDiagnostic({ provider: 'deepseek', transportFailureClass: 'dns_resolution_failed', message: canary }), {
    provider: 'deepseek', transportFailureClass: 'dns_resolution_failed',
  });
  const unknown = deepSeekOutcomeDiagnosticCopy({ outcome: 'outcome_unknown', provider: 'deepseek',
    transportFailureClass: 'connection_refused', message: canary, code: 'ECONNREFUSED' });
  assert.equal(unknown, 'Outcome unknown. DeepSeek connection was refused. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(unknown.includes(canary), false);
  assert.equal(unknown.includes('ECONNREFUSED'), false);
  const timeout = deepSeekOutcomeDiagnosticCopy({ provider: 'deepseek', transportFailureClass: 'transport_timeout', message: canary });
  assert.equal(timeout, 'DeepSeek request timed out. Delivery remains unverified; this run cannot be retried.');
  assert.equal(timeout.includes(canary), false);
  assert.equal(deepSeekOutcomeDiagnosticCopy({ provider: 'deepseek', transportFailureClass: canary }), null);
  assert.match(deepSeekOutcomeDiagnosticCopy({ outcome: 'outcome_unknown', transportFailureClass: canary }), /Outcome unknown/);
  assert.equal(deepSeekOutcomeDiagnostic({ provider: 'deepseek', transportFailureClass: canary, message: canary }), null);
});

test('unknown-outcome copy includes allowlisted restart-persisted HTTP and parser details only', () => {
  const canary = 'raw-body-request-id-error-message-canary';
  const restored = JSON.parse(JSON.stringify({ outcome: 'outcome_unknown', provider: 'deepseek',
    httpStatus: 502, parserFailureClass: 'invalid_json', transportFailureClass: 'connection_reset',
    body: canary, requestId: canary, message: canary, code: canary }));
  const copy = deepSeekOutcomeDiagnosticCopy(restored);
  assert.equal(copy, 'Outcome unknown. DeepSeek returned HTTP 502; response parsing failed (invalid JSON); DeepSeek connection was reset. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(copy.includes(canary), false);
  assert.deepEqual(deepSeekOutcomeDiagnostic(restored), {
    provider: 'deepseek', httpStatus: 502, parserFailureClass: 'invalid_json', transportFailureClass: 'connection_reset',
  });
  assert.equal(deepSeekOutcomeDiagnosticCopy({ outcome: 'outcome_unknown', provider: 'deepseek',
    httpStatus: 700, parserFailureClass: canary, transportFailureClass: canary, body: canary }),
  'Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(deepSeekOutcomeDiagnosticCopy({ outcome: 'outcome_unknown', provider: 'other',
    httpStatus: 502, parserFailureClass: 'invalid_json', body: canary }),
  'Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
});
