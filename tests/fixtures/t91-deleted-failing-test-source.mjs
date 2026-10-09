export const T91_DELETED_FAILING_TEST_SOURCE = `import assert from 'node:assert/strict';
import test from 'node:test';
test('pinned criterion fails on the candidate', () => assert.equal(1, 2));
`;
