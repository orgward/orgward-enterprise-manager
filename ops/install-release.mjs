import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { constants as fsConstants, accessSync, chmodSync, closeSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_TAR_BYTES = 512 * 1024 * 1024;
const MAX_MEMBERS = 20_000;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

const SIGNATURE_DOMAIN = 'OrgWard Enterprise Studio release archive v1\n';
const MAX_TRUST_FILE_BYTES = 16_384;

function readTrustedPublicKey(publicKeyPath) {
  let descriptor;
  try {
    if (!path.isAbsolute(publicKeyPath) || !Number.isInteger(fsConstants.O_NOFOLLOW)) fail('Trusted public-key path must be absolute and readable as a regular file.');
    descriptor = openSync(publicKeyPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_CLOEXEC ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_TRUST_FILE_BYTES) fail('Trusted public key is not a regular file within the supported size limit.');
    const data = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < data.length) {
      const count = readSync(descriptor, data, offset, data.length - offset, offset);
      if (!count) fail('Trusted public key changed while being read.');
      offset += count;
    }
    if (fstatSync(descriptor).size !== metadata.size) fail('Trusted public key changed while being read.');
    return data.toString('utf8');
  } catch (error) {
    if (error.message?.startsWith('Trusted public key')) throw error;
    fail('Trusted public key could not be opened safely as a regular file.');
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function readReleaseSignature(signaturePath) {
  let descriptor;
  try {
    if (!path.isAbsolute(signaturePath) || !Number.isInteger(fsConstants.O_NOFOLLOW)) fail('Release signature path must be absolute and readable as a regular file.');
    descriptor = openSync(signaturePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_CLOEXEC ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > 256) fail('Release signature is not a regular file within the supported size limit.');
    const data = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < data.length) {
      const count = readSync(descriptor, data, offset, data.length - offset, offset);
      if (!count) fail('Release signature changed while being read.');
      offset += count;
    }
    if (fstatSync(descriptor).size !== metadata.size) fail('Release signature changed while being read.');
    return data.toString('ascii').trim();
  } catch (error) {
    if (error.message?.startsWith('Release signature')) throw error;
    fail('Release signature could not be opened safely as a regular file.');
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function verifyArchiveSignature(archiveDigest, signatureText, trustedPublicKeyPem) {
  if (typeof trustedPublicKeyPem !== 'string' || !trustedPublicKeyPem.trimStart().startsWith('-----BEGIN PUBLIC KEY-----')) {
    fail('Trusted public key must be an Ed25519 SPKI public key.');
  }
  let publicKey;
  try { publicKey = createPublicKey(trustedPublicKeyPem); }
  catch { fail('Trusted public key is malformed.'); }
  if (publicKey.asymmetricKeyType !== 'ed25519' || publicKey.type !== 'public') fail('Trusted public key must be an Ed25519 SPKI public key.');
  const match = /^orgward-release-signature-v1:([A-Za-z0-9+/]{86}==)$/.exec(signatureText ?? '');
  if (!match) fail('Release signature is missing or malformed.');
  const signature = Buffer.from(match[1], 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== match[1]) fail('Release signature is missing or malformed.');
  const statement = Buffer.from(`${SIGNATURE_DOMAIN}sha256=${archiveDigest}\n`, 'utf8');
  if (!verify(null, statement, publicKey, signature)) fail('Release signature does not match the trusted public key and archive bytes.');
}

function fail(message) { throw new Error(message); }

function readPinnedArchive(archivePath) {
  let descriptor;
  try {
    if (!path.isAbsolute(archivePath) || !Number.isInteger(fsConstants.O_NOFOLLOW)) fail('Archive path must be absolute and readable as a regular file.');
    descriptor = openSync(archivePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_CLOEXEC ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_ARCHIVE_BYTES) fail('Archive is not a regular file within the supported size limit.');
    const buffer = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (read === 0) fail('Archive changed while being read.');
      offset += read;
    }
    if (fstatSync(descriptor).size !== metadata.size) fail('Archive changed while being read.');
    return buffer;
  } catch (error) {
    if (error.message?.startsWith('Archive ')) throw error;
    fail('Archive could not be opened safely as a regular file.');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function octal(field, label) {
  const text = field.toString('ascii').replace(/[\0 ]+$/g, '').replace(/^ +/g, '');
  if (!/^[0-7]+$/.test(text)) fail(`Archive has an invalid ${label} field.`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail(`Archive has an invalid ${label} field.`);
  return value;
}

function stringField(header, offset, length, label) {
  const field = header.subarray(offset, offset + length);
  const zero = field.indexOf(0);
  const bytes = zero < 0 ? field : field.subarray(0, zero);
  if (zero >= 0 && field.subarray(zero + 1).some((byte) => byte !== 0)) fail(`Archive has an invalid ${label} field.`);
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) fail(`Archive has an invalid ${label} encoding.`);
  return value;
}

function safeMemberPath(value, type) {
  if (!value || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) fail('Archive contains an unsafe member path.');
  let normalized = value;
  if (type === '5' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  if (!normalized || normalized.endsWith('/')) fail('Archive contains an unsafe member path.');
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) {
    fail('Archive contains an unsafe member path.');
  }
  return normalized;
}

function readTar(tar) {
  if (!tar.length || tar.length % 512 !== 0 || tar.length > MAX_TAR_BYTES) fail('Archive is not a supported bounded USTAR archive.');
  const entries = [];
  const seen = new Map();
  let offset = 0;
  let rootName = null;
  let foundEndMarker = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      const remainder = tar.subarray(offset);
      if (remainder.length < 1024 || remainder.some((byte) => byte !== 0)) fail('Archive has an invalid USTAR end marker or trailing data.');
      foundEndMarker = true;
      break;
    }
    if (entries.length >= MAX_MEMBERS) fail('Archive exceeds the supported member count.');
    const storedChecksum = octal(header.subarray(148, 156), 'checksum');
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    if (checksumHeader.reduce((sum, byte) => sum + byte, 0) !== storedChecksum) fail('Archive member checksum is invalid.');
    if (header.toString('ascii', 257, 263) !== 'ustar\0' || header.toString('ascii', 263, 265) !== '00') fail('Archive uses an unsupported tar format; only POSIX USTAR is accepted.');
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    if (type !== '0' && type !== '5') fail('Archive contains an unsupported member type; only regular files and directories are accepted.');
    const name = stringField(header, 0, 100, 'name');
    const prefix = stringField(header, 345, 155, 'prefix');
    const linkName = stringField(header, 157, 100, 'link name');
    if (linkName) fail('Archive contains a linked member.');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const memberPath = safeMemberPath(fullName, type);
    const size = octal(header.subarray(124, 136), 'size');
    if (size > MAX_TAR_BYTES || (type === '5' && size !== 0)) fail('Archive member size is invalid.');
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const paddedEnd = dataStart + Math.ceil(size / 512) * 512;
    if (dataEnd > tar.length || paddedEnd > tar.length) fail('Archive member is truncated.');
    if (!rootName) {
      if (type !== '5' || memberPath.split('/').length !== 1 || !/^orgward-enterprise-studio-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(memberPath)) {
        fail('Archive must contain exactly one versioned OrgWard release root.');
      }
      rootName = memberPath;
    } else if (memberPath !== rootName && !memberPath.startsWith(`${rootName}/`)) {
      fail('Archive contains members outside its release root.');
    }
    if (seen.has(memberPath)) fail('Archive contains duplicate member paths.');
    seen.set(memberPath, type);
    entries.push({ path: memberPath, type, data: tar.subarray(dataStart, dataEnd) });
    offset = paddedEnd;
  }
  if (!foundEndMarker) fail('Archive is truncated or missing its USTAR end marker.');
  if (!rootName || !entries.length) fail('Archive has no release root.');
  for (const entry of entries) {
    const pieces = entry.path.split('/');
    for (let length = 1; length < pieces.length; length += 1) {
      const ancestor = pieces.slice(0, length).join('/');
      if (seen.get(ancestor) === '0') fail('Archive has a file/directory path collision.');
    }
  }
  return { rootName, entries };
}

function verifyManifest(rootName, entries) {
  const manifestPath = `${rootName}/release-manifest.json`;
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const manifestEntry = entryByPath.get(manifestPath);
  if (!manifestEntry || manifestEntry.data.length > MAX_MANIFEST_BYTES) fail('Release manifest is missing or too large.');
  let manifest;
  try { manifest = JSON.parse(manifestEntry.data.toString('utf8')); }
  catch { fail('Release manifest is invalid.'); }
  const version = rootName.slice('orgward-enterprise-studio-'.length);
  if (!manifest || manifest.name !== rootName || manifest.version !== version || !manifest.files
    || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) fail('Release manifest does not match the release root.');
  const expectedPaths = Object.keys(manifest.files);
  if (expectedPaths.length > MAX_MEMBERS) fail('Release manifest exceeds the supported inventory size.');
  const actualFiles = entries.filter((entry) => entry.type === '0' && entry.path !== manifestPath);
  if (actualFiles.length !== expectedPaths.length) fail('Archive file inventory does not match its manifest.');
  const expectedSet = new Set(expectedPaths);
  if (expectedSet.size !== expectedPaths.length) fail('Release manifest contains duplicate inventory paths.');
  for (const relativePath of expectedPaths) {
    const normalized = safeMemberPath(relativePath, '0');
    if (normalized !== relativePath) fail('Release manifest contains an unsafe inventory path.');
    const entry = entryByPath.get(`${rootName}/${relativePath}`);
    const expectedHash = manifest.files[relativePath];
    if (!entry || entry.type !== '0' || typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)
      || createHash('sha256').update(entry.data).digest('hex') !== expectedHash) fail('A release file does not match its manifest hash.');
  }
  for (const entry of actualFiles) if (!expectedSet.has(entry.path.slice(rootName.length + 1))) fail('Archive file inventory does not match its manifest.');
  const requiredDirectories = new Set([rootName]);
  for (const relativePath of [...expectedPaths, 'release-manifest.json']) {
    const parts = relativePath.split('/');
    for (let length = 1; length < parts.length; length += 1) requiredDirectories.add(`${rootName}/${parts.slice(0, length).join('/')}`);
  }
  const actualDirectories = new Set(entries.filter((entry) => entry.type === '5').map((entry) => entry.path));
  if (actualDirectories.size !== requiredDirectories.size || [...requiredDirectories].some((directory) => !actualDirectories.has(directory))) {
    fail('Archive directory inventory does not match its manifest.');
  }
  return manifest;
}

function existing(pathname) {
  try { return lstatSync(pathname); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function installReleaseArchive({ archivePath, signaturePath = `${archivePath}.sig`, trustedPublicKeyPem, trustedPublicKeyPath, destinationParent }) {
  const archive = readPinnedArchive(archivePath);
  const archiveDigest = createHash('sha256').update(archive).digest('hex');
  const signatureText = readReleaseSignature(signaturePath);
  const publicKeyPem = trustedPublicKeyPem ?? (trustedPublicKeyPath ? readTrustedPublicKey(trustedPublicKeyPath) : null);
  if (typeof publicKeyPem !== 'string') fail('An independently trusted Ed25519 SPKI public key is required.');
  verifyArchiveSignature(archiveDigest, signatureText, publicKeyPem);
  let tar;
  try { tar = gunzipSync(archive, { maxOutputLength: MAX_TAR_BYTES }); }
  catch { fail('Archive is not valid bounded gzip data.'); }
  const parsed = readTar(tar);
  verifyManifest(parsed.rootName, parsed.entries);

  if (typeof destinationParent !== 'string' || !path.isAbsolute(destinationParent)) fail('Destination parent must be an absolute existing trusted directory.');
  let parent;
  try {
    const candidate = path.resolve(destinationParent);
    const metadata = lstatSync(candidate);
    parent = realpathSync(candidate);
    if (!metadata.isDirectory() || parent !== candidate) fail('Destination parent must be a real directory, not a symlink.');
    accessSync(parent, fsConstants.W_OK | fsConstants.X_OK);
  } catch (error) {
    if (error.message?.startsWith('Destination parent')) throw error;
    fail('Destination parent must be an accessible trusted directory.');
  }
  const destination = path.join(parent, parsed.rootName);
  if (existing(destination)) fail('Target release already exists; installation never overwrites a release.');
  const lockPath = path.join(parent, `.${parsed.rootName}.install-lock`);
  let lockDescriptor;
  let lockOwned = false;
  let temporary;
  try {
    try {
      lockDescriptor = openSync(lockPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
      lockOwned = true;
    }
    catch { fail('Another installation may be in progress or a stale install lock exists.'); }
    if (existing(destination)) fail('Target release already exists; installation never overwrites a release.');
    temporary = path.join(parent, `.orgward-install-${randomUUID()}`);
    mkdirSync(temporary, { mode: 0o700 });
    const stageRoot = path.join(temporary, parsed.rootName);
    for (const entry of parsed.entries) {
      const relativePath = entry.path.slice(parsed.rootName.length).replace(/^\//, '');
      const outputPath = relativePath ? path.join(stageRoot, ...relativePath.split('/')) : stageRoot;
      if (entry.type === '5') mkdirSync(outputPath, { mode: 0o700 });
      else {
        const descriptor = openSync(outputPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW | (fsConstants.O_CLOEXEC ?? 0), 0o600);
        try { writeFileSync(descriptor, entry.data); fchmodSync(descriptor, 0o644); }
        finally { closeSync(descriptor); }
      }
    }
    for (const entry of parsed.entries.filter((candidate) => candidate.type === '5').reverse()) {
      const relativePath = entry.path.slice(parsed.rootName.length).replace(/^\//, '');
      chmodSync(relativePath ? path.join(stageRoot, ...relativePath.split('/')) : stageRoot, 0o755);
    }
    if (existing(destination)) fail('Target release appeared during installation; no release was overwritten.');
    renameSync(stageRoot, destination);
    return { destination, name: parsed.rootName, version: parsed.rootName.slice('orgward-enterprise-studio-'.length) };
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    if (lockDescriptor !== undefined) closeSync(lockDescriptor);
    if (lockOwned) rmSync(lockPath, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3) fail('Usage: npm run release:install -- <archive.tar.gz> <trusted-ed25519-public.pem> <existing-destination-parent>');
    const release = installReleaseArchive({ archivePath: path.resolve(args[0]), trustedPublicKeyPath: path.resolve(args[1]), destinationParent: path.resolve(args[2]) });
    process.stdout.write(`Installed signature-verified ${release.name} at ${release.destination}\n`);
  } catch (error) {
    process.stderr.write(`Release installation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
