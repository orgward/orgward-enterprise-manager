import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { boundedLineDiff, MAX_REPOSITORY_PREVIEW_BYTES, readBoundedUtf8Response } from '../../public/repository-text-diff.mjs';

test('bounded line diff reports readable additions, removals and context', () => {
  assert.deepEqual(boundedLineDiff('keep\nold\n', 'keep\nnew\n'), [
    { type: 'context', text: '  keep' },
    { type: 'removed', text: '- old' },
    { type: 'added', text: '+ new' },
  ]);
  assert.deepEqual(boundedLineDiff('', 'new\n'), [{ type: 'added', text: '+ new' }]);
});

test('bounded line diff falls back for too many lines and excessive comparison work', () => {
  assert.throws(() => boundedLineDiff('a\n'.repeat(251), ''), /too complex/);
  assert.throws(() => boundedLineDiff('a\n'.repeat(201), 'b\n'.repeat(201)), /too complex/);
});

test('preview reader enforces byte, UTF-8, NUL and saved-hash bounds', async () => {
  const makeResponse = (bytes, declaredLength = bytes.byteLength, hash = createHash('sha256').update(bytes).digest('hex')) => new Response(bytes, {
    headers: { 'content-length': String(declaredLength), 'x-content-sha256': hash },
  });
  const small = new TextEncoder().encode('safe text\n');
  assert.equal(await readBoundedUtf8Response(makeResponse(small), createHash('sha256').update(small).digest('hex')), 'safe text\n');
  await assert.rejects(readBoundedUtf8Response(makeResponse(new Uint8Array(MAX_REPOSITORY_PREVIEW_BYTES + 1)), '0'.repeat(64)), /size limit/);
  const invalidUtf8 = new Uint8Array([0xff]);
  await assert.rejects(readBoundedUtf8Response(makeResponse(invalidUtf8), createHash('sha256').update(invalidUtf8).digest('hex')), /UTF-8/);
  const binary = new Uint8Array([0x61, 0, 0x62]);
  await assert.rejects(readBoundedUtf8Response(makeResponse(binary), createHash('sha256').update(binary).digest('hex')), /binary/);
  await assert.rejects(readBoundedUtf8Response(makeResponse(small), '0'.repeat(64)), /hash/);
});
