export const MAX_REPOSITORY_PREVIEW_BYTES = 128 * 1024;
export const MAX_REPOSITORY_PREVIEW_LINES = 250;
export const MAX_REPOSITORY_DIFF_CELLS = 40_000;

export async function readBoundedUtf8Response(response, expectedHash, maxBytes = MAX_REPOSITORY_PREVIEW_BYTES) {
  if (!response?.ok || !response.body) throw new Error('File could not be loaded for preview.');
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('File exceeds the inline preview size limit.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('File exceeds the inline preview size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (expectedHash) {
    const actualHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((value) => value.toString(16).padStart(2, '0')).join('');
    if (actualHash !== expectedHash || response.headers.get('x-content-sha256') !== expectedHash) {
      throw new Error('Saved file hash did not match the candidate record.');
    }
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('File is not valid UTF-8 text.');
  }
  if (text.includes('\0')) throw new Error('File appears to be binary.');
  return text;
}

export function boundedLineDiff(beforeText, afterText) {
  const toLines = (value) => {
    const text = String(value);
    if (!text) return [];
    const lines = text.split('\n');
    if (text.endsWith('\n')) lines.pop();
    return lines;
  };
  const before = toLines(beforeText);
  const after = toLines(afterText);
  if (before.length > MAX_REPOSITORY_PREVIEW_LINES || after.length > MAX_REPOSITORY_PREVIEW_LINES
    || before.length * after.length > MAX_REPOSITORY_DIFF_CELLS) {
    throw new Error('File is too complex for an inline diff.');
  }
  const width = after.length + 1;
  const lengths = new Uint16Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const at = i * width + j;
      lengths[at] = before[i] === after[j]
        ? lengths[(i + 1) * width + j + 1] + 1
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      lines.push({ type: 'context', text: `  ${before[i]}` });
      i += 1;
      j += 1;
    } else if (i < before.length && (j >= after.length
      || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) {
      lines.push({ type: 'removed', text: `- ${before[i]}` });
      i += 1;
    } else {
      lines.push({ type: 'added', text: `+ ${after[j]}` });
      j += 1;
    }
  }
  return lines;
}
