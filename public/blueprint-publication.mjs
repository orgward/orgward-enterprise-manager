export function renderBlueprintPublicationWatermark(publication, element) {
  const available = [2, 3].includes(publication?.publicationSchemaVersion)
    && Number.isSafeInteger(publication.publishedProjectVersion)
    && typeof publication.blueprintId === 'string'
    && Number.isSafeInteger(publication.blueprintVersion)
    && /^[a-f0-9]{64}$/.test(publication.sourceSnapshotHash ?? '')
    && /^[a-f0-9]{64}$/.test(publication.publicationHash ?? '')
    && (publication.publicationSchemaVersion === 2
      || (/^[a-f0-9]{64}$/.test(publication.impactHash ?? '') && publication.impactManifest?.impactHash === publication.impactHash));
  const text = available
    ? `Publication watermark · project aggregate v${publication.publishedProjectVersion} · source blueprint ${publication.blueprintId} v${publication.blueprintVersion} · snapshot SHA-256 ${publication.sourceSnapshotHash}${publication.publicationSchemaVersion === 3 ? ` · declared flow impact SHA-256 ${publication.impactHash}` : ''}`
    : 'Publication watermark unavailable for this historical baseline.';
  return element('p', { className: 'publication-watermark', attrs: { 'data-publication-watermark': available ? 'available' : 'unavailable' }, text });
}

export function renderBlueprintPublicationStatus(status, element) {
  const value = status?.status ?? 'UNKNOWN';
  const text = value === 'CURRENT_FOR_SAVED_BLUEPRINT'
    ? `CURRENT FOR SAVED BLUEPRINT · internal baseline pins blueprint v${status.currentBlueprintVersion}. This says nothing about operational currentness or approval.`
    : value === 'STALE'
      ? `STALE · internal baseline pins blueprint v${status.publishedBlueprintVersion}; current saved blueprint is v${status.currentBlueprintVersion}. The prior publication remains historical and is not applied to the current design.`
      : value === 'NOT_PUBLISHED'
        ? 'No internal baseline has been published.'
        : 'CURRENTNESS UNKNOWN · this publication has no verified source watermark; do not treat it as current.';
  return element('p', { className: 'publication-currentness', attrs: { role: 'status', 'data-publication-currentness': value }, text });
}

export function renderBlueprintPublicationConsistency(consistency, element) {
  const value = consistency?.status ?? 'PENDING';
  const projectVersion = Number.isSafeInteger(consistency?.projectLens?.projectVersion)
    ? consistency.projectLens.projectVersion : 'unknown';
  const baselineVersion = Number.isSafeInteger(consistency?.baselineLens?.projectVersion)
    ? consistency.baselineLens.projectVersion : null;
  const text = value === 'CONSISTENT'
    ? `CONSISTENT PROJECT/BASELINE VIEW · both lenses use project v${projectVersion} and the same saved blueprint watermark. This does not establish operational currentness or approval.`
    : value === 'STALE'
      ? baselineVersion === null
        ? `STALE PROJECT/BASELINE VIEW · project v${projectVersion} does not match the baseline watermark. The baseline remains historical.`
        : `STALE PROJECT/BASELINE VIEW · project lens v${projectVersion} and baseline lens v${baselineVersion} differ. The baseline remains historical.`
      : consistency?.reason === 'BASELINE_NOT_PUBLISHED'
        ? `PENDING PROJECT/BASELINE VIEW · project v${projectVersion} has no published baseline watermark.`
        : `PENDING PROJECT/BASELINE VIEW · a matching project and baseline watermark is unavailable; do not treat the lenses as consistent.`;
  return element('p', { className: 'publication-consistency', attrs: { role: 'status', 'data-publication-consistency': value }, text });
}
