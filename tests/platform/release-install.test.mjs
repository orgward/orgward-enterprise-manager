import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installReleaseArchive } from '../../ops/install-release.mjs';

function octal(value, length) { return `${value.toString(8).padStart(length - 1, '0')}\0`; }
function header({ name, type = '0', size = 0, linkName = '' }) {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, 'utf8');
  block.write(octal(0o644, 8), 100, 8, 'ascii');
  block.write(octal(0, 8), 108, 8, 'ascii');
  block.write(octal(0, 8), 116, 8, 'ascii');
  block.write(octal(size, 12), 124, 12, 'ascii');
  block.write(octal(0, 12), 136, 12, 'ascii');
  block.fill(0x20, 148, 156);
  block[156] = type.charCodeAt(0);
  block.write(linkName, 157, 100, 'utf8');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  block.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  block[154] = 0;
  block[155] = 0x20;
  return block;
}
function archiveWith(entries, { endMarker = true } = {}) {
  const blocks = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    blocks.push(header({ ...entry, size: data.length }));
    if (data.length) {
      blocks.push(data);
      const padding = (512 - data.length % 512) % 512;
      if (padding) blocks.push(Buffer.alloc(padding));
    }
  }
  if (endMarker) blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function signatureFor(bytes, privateKey) {
  const statement = Buffer.from(`OrgWard Enterprise Studio release archive v1\nsha256=${digest(bytes)}\n`);
  return `orgward-release-signature-v1:${sign(null, statement, privateKey).toString('base64')}\n`;
}

test('release installer rejects unsafe tar formats and members before publishing anything', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orgward-release-installer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destinationParent = path.join(root, 'releases');
  await mkdir(destinationParent, { mode: 0o700 });
  const releaseRoot = 'orgward-enterprise-studio-0.1.0';
  const signer = generateKeyPairSync('ed25519');
  const trustedPublicKeyPem = signer.publicKey.export({ type: 'spki', format: 'pem' });
  const cases = [
    ['path traversal', archiveWith([{ name: `${releaseRoot}/`, type: '5' }, { name: `${releaseRoot}/../escape` }])],
    ['PAX extension', archiveWith([{ name: `${releaseRoot}/`, type: '5' }, { name: 'PaxHeaders.0/member', type: 'x', data: 'path=ignored' }])],
    ['GNU long-name extension', archiveWith([{ name: `${releaseRoot}/`, type: '5' }, { name: '././@LongLink', type: 'L', data: `${releaseRoot}/file` }])],
    ['symbolic link', archiveWith([{ name: `${releaseRoot}/`, type: '5' }, { name: `${releaseRoot}/link`, type: '2', linkName: 'target' }])],
    ['hard link', archiveWith([{ name: `${releaseRoot}/`, type: '5' }, { name: `${releaseRoot}/link`, type: '1', linkName: `${releaseRoot}/target` }])],
    ['device entry', archiveWith([{ name: `${releaseRoot}/`, type: '5' }, { name: `${releaseRoot}/device`, type: '3' }])],
    ['truncated end marker', archiveWith([{ name: `${releaseRoot}/`, type: '5' }], { endMarker: false })],
    ['duplicate path', archiveWith([{ name: `${releaseRoot}/`, type: '5' }, { name: `${releaseRoot}/same` }, { name: `${releaseRoot}/same` }])],
    ['file/directory collision', archiveWith([{ name: `${releaseRoot}/`, type: '5' }, { name: `${releaseRoot}/node` }, { name: `${releaseRoot}/node/child` }])],
  ];
  for (const [label, bytes] of cases) {
    const archivePath = path.join(root, `${label.replaceAll(/[^a-z0-9]/gi, '-')}.tar.gz`);
    await writeFile(archivePath, bytes, { mode: 0o600 });
    await writeFile(`${archivePath}.sig`, signatureFor(bytes, signer.privateKey), { mode: 0o600 });
    assert.throws(() => installReleaseArchive({ archivePath, trustedPublicKeyPem, destinationParent }), undefined, label);
    assert.deepEqual(await readdir(destinationParent), [], `${label} left no partial release or temp directory`);
  }
});
