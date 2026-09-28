const MAX_SOURCES = 8;
const MAX_PROVENANCE = 12;
const MAX_PROVENANCE_FIELDS = 12;
const MAX_SNAPSHOT_BYTES = 16 * 1024;
const HASH = /^[a-f0-9]{64}$/;

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hasExactKeys = (value, keys) => isRecord(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const validText = (value, maxBytes, { empty = true } = {}) => typeof value === 'string'
  && new TextEncoder().encode(value).byteLength <= maxBytes
  && (empty || Boolean(value.trim()));

function validProvenance(entries) {
  return Array.isArray(entries) && entries.length <= MAX_PROVENANCE && entries.every((entry) => {
    if (!isRecord(entry) || !Object.hasOwn(entry, 'source') || !Object.hasOwn(entry, 'note')
      || Object.keys(entry).some((key) => !['source', 'note', 'fields'].includes(key))) return false;
    return validText(entry.source, 256) && validText(entry.note, 1024)
      && (!Object.hasOwn(entry, 'fields') || (Array.isArray(entry.fields) && entry.fields.length <= MAX_PROVENANCE_FIELDS
        && entry.fields.every((field) => validText(field, 512))));
  });
}

function legacy(message) { return { kind: 'legacy', message }; }
function unavailable(message = 'The saved model input snapshot is malformed or does not match this run’s pinned blueprint. No partial input preview is available.') {
  return { kind: 'unavailable', message };
}

export function processTaskSourceReview(run) {
  if (!isRecord(run) || !isRecord(run.processTaskRef)
    || !['provider-openai', 'provider-deepseek'].includes(run.profile?.kind)) return null;

  const processTaskRef = run.processTaskRef;
  const context = run.workItem?.proposalContext;
  if (context === undefined || context === null) {
    return legacy('This saved model task predates pinned input snapshots; its exact provider inputs cannot be reviewed here.');
  }
  if (!hasExactKeys(context, ['sourceEnvelope', 'sourceEnvelopeHash', 'target'])
    || !HASH.test(context.sourceEnvelopeHash ?? '')
    || !hasExactKeys(context.sourceEnvelope, ['blueprintId', 'blueprintVersion', 'sources'])
    || typeof processTaskRef.blueprintId !== 'string' || !processTaskRef.blueprintId.trim()
    || !Number.isSafeInteger(processTaskRef.blueprintVersion) || processTaskRef.blueprintVersion < 1
    || context.sourceEnvelope.blueprintId !== processTaskRef.blueprintId
    || context.sourceEnvelope.blueprintVersion !== processTaskRef.blueprintVersion
    || !Array.isArray(context.sourceEnvelope.sources) || context.sourceEnvelope.sources.length < 1
    || context.sourceEnvelope.sources.length > MAX_SOURCES
    || !hasExactKeys(context.target, ['id', 'type', 'name', 'field', 'before'])
    || !validText(context.target.id, 200, { empty: false })
    || context.target.type !== 'information'
    || !validText(context.target.name, 512, { empty: false })
    || context.target.field !== 'detail'
    || !validText(context.target.before, 4096)) return unavailable();

  const sources = [];
  const sourceIds = new Set();
  for (const source of context.sourceEnvelope.sources) {
    if (!hasExactKeys(source, ['id', 'type', 'name', 'detail', 'provenance', 'hash'])
      || !validText(source.id, 200, { empty: false })
      || !validText(source.type, 80, { empty: false })
      || !validText(source.name, 512, { empty: false })
      || !validText(source.detail, 4096)
      || !HASH.test(source.hash ?? '')
      || !validProvenance(source.provenance) || sourceIds.has(source.id)) return unavailable();
    sourceIds.add(source.id);
    sources.push({
      id: source.id, type: source.type, name: source.name, detail: source.detail,
      provenance: source.provenance.map((entry) => ({
        source: entry.source, note: entry.note,
        ...(Object.hasOwn(entry, 'fields') ? { fields: [...entry.fields] } : {}),
      })),
    });
  }

  let snapshotBytes;
  try { snapshotBytes = new TextEncoder().encode(JSON.stringify(context)).byteLength; }
  catch { return unavailable(); }
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) return unavailable();

  return {
    kind: 'snapshot',
    blueprintId: context.sourceEnvelope.blueprintId,
    blueprintVersion: context.sourceEnvelope.blueprintVersion,
    sources,
    target: {
      id: context.target.id, type: context.target.type, name: context.target.name,
      field: context.target.field, before: context.target.before,
    },
  };
}
