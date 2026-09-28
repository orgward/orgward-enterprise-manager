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
