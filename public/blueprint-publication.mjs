export function renderBlueprintPublicationWatermark(publication, element) {
  const available = publication?.publicationSchemaVersion === 2
    && Number.isSafeInteger(publication.publishedProjectVersion)
    && typeof publication.blueprintId === 'string'
    && Number.isSafeInteger(publication.blueprintVersion)
    && /^[a-f0-9]{64}$/.test(publication.sourceSnapshotHash ?? '')
    && /^[a-f0-9]{64}$/.test(publication.publicationHash ?? '');
  const text = available
    ? `Publication watermark · project aggregate v${publication.publishedProjectVersion} · source blueprint ${publication.blueprintId} v${publication.blueprintVersion} · snapshot SHA-256 ${publication.sourceSnapshotHash}`
    : 'Publication watermark unavailable for this historical baseline.';
  return element('p', { className: 'publication-watermark', attrs: { 'data-publication-watermark': available ? 'available' : 'unavailable' }, text });
}
