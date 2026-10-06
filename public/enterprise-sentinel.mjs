export const ENTERPRISE_SENTINEL_COMMANDS = ['run-sentinel-assessment'];

export function enterpriseSentinelCommandPayload(model, reason) {
  if (!model?.blueprint || !model.context?.isCurrent || model.permissions?.integrityRun !== true
    || !/^[a-f0-9]{64}$/.test(model.context.snapshotHash ?? '')
    || typeof reason !== 'string' || !reason.trim()) return null;
  return { kind: 'run-sentinel-assessment', blueprintId: model.context.blueprintId,
    blueprintVersion: model.context.blueprintVersion, snapshotHash: model.context.snapshotHash, reason: reason.trim() };
}

export function renderEnterpriseSentinel({ model, pending = null, loading = false, el, ui, onCommand }) {
  if (!model?.blueprint) return null;
  const sentinel = model.sentinel ?? {};
  const profile = sentinel.profile;
  const panel = el('section', { className: 'enterprise-sentinel', attrs: { 'aria-label': 'Sentinel assessment', 'data-sentinel-profile': profile?.id ?? 'unavailable' } }, [
    el('h3', { text: 'Sentinel rule assessment' }),
    el('p', { text: 'This bounded profile checks accountable owner roles on saved process records. It does not assess authority conflicts, control effectiveness, cross-project relationships, or enterprise readiness.' }),
  ]);
  if (profile) panel.append(el('p', { text: `Profile ${profile.id} v${profile.version} · evaluator ${profile.evaluatorRevision} · SHA-256 ${profile.hash}` }));
  const displayed = sentinel.current ?? sentinel.assessments?.at(-1);
  if (displayed) {
    panel.append(el('p', { attrs: { role: 'status', 'data-sentinel-status': displayed.status }, text:
      `${displayed.appliesToContext ? 'CURRENT' : 'STALE'} · ${displayed.status} within the declared profile · ${displayed.coverage.applicable} applicable processes · ${displayed.findings.length} findings · evaluated ${displayed.evaluatedAt}.` }));
    panel.append(el('p', { text: `Assessment ${displayed.id} · report SHA-256 ${displayed.reportHash} · assessed project aggregate v${displayed.source.assessedAggregateVersion}; the report append advanced the project aggregate separately.` }));
    if (displayed.findings.length) panel.append(el('ul', {}, displayed.findings.map((finding) => el('li', { text: `${finding.severity}: ${finding.message}` }))));
    if (displayed.status === 'UNKNOWN') panel.append(el('p', { attrs: { role: 'status' }, text: 'No applicable process was evaluated; this is unknown coverage, not a pass.' }));
  } else panel.append(el('p', { attrs: { role: 'status' }, text: 'No exact-source Sentinel assessment is available for this saved design.' }));
  const reason = ui.field('reason', 'Reason for this assessment', { multiline: true, maximum: 500 });
  const writable = model.permissions?.integrityRun === true && model.context?.isCurrent === true;
  panel.append(ui.form('run-sentinel-assessment', 'Run Sentinel on this saved design', [reason.node], () => {
    const payload = enterpriseSentinelCommandPayload(model, reason.control.value);
    if (payload) onCommand(payload);
  }, loading || Boolean(pending) || !writable));
  if (!writable && model.context?.isCurrent) panel.append(el('p', { text: 'A human workspace writer can run an assessment on the current saved design.' }));
  if (model.context?.sourceKind !== 'MAIN_DESIGN') panel.append(el('p', { text: 'Historical, future and branch snapshots are read-only; assessments run against the current saved main design.' }));
  return panel;
}
