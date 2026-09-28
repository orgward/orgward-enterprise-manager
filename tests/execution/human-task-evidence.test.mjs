import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHumanTaskEvidence } from '../../public/human-task-evidence.mjs';

test('human checkpoint evidence parses bounded, trimmed notes and ignores blank lines', () => {
  assert.deepEqual(parseHumanTaskEvidence('  Reviewed the control.  \n\n Verified owner approval. \n'), [
    'Reviewed the control.', 'Verified owner approval.',
  ]);
  assert.deepEqual(parseHumanTaskEvidence(Array.from({ length: 20 }, (_, index) => `Note ${index + 1}`).join('\n')),
    Array.from({ length: 20 }, (_, index) => `Note ${index + 1}`));
  assert.deepEqual(parseHumanTaskEvidence(''), []);
});

test('human checkpoint evidence rejects excess notes and oversized individual notes', () => {
  assert.equal(parseHumanTaskEvidence(Array.from({ length: 21 }, (_, index) => `Note ${index + 1}`).join('\n')), null);
  assert.equal(parseHumanTaskEvidence('x'.repeat(1001)), null);
  assert.equal(parseHumanTaskEvidence(null), null);
});
