const accessLabels = Object.freeze({ owner: 'Owner access', editor: 'Editor access', reader: 'Reader access' });

export function projectPortfolioFacts(project) {
  return {
    name: typeof project?.name === 'string' && project.name.trim() ? project.name.trim() : 'Untitled workspace',
    phase: typeof project?.phase === 'string' && project.phase.trim() ? project.phase.trim() : 'Not started',
    hasBlueprint: Number.isInteger(project?.blueprintVersion) && project.blueprintVersion > 0,
    blueprint: Number.isInteger(project?.blueprintVersion) && project.blueprintVersion > 0
      ? `Blueprint version ${project.blueprintVersion}` : 'No saved blueprint yet',
    access: accessLabels[project?.workspaceAccess] ?? 'Local workspace',
    incidents: Number.isSafeInteger(project?.openIncidentCount) && project.openIncidentCount > 0 ? project.openIncidentCount : 0,
    support: Number.isSafeInteger(project?.openSupportCount) && project.openSupportCount > 0 ? project.openSupportCount : 0,
    changeCases: Number.isSafeInteger(project?.activeChangeCaseCount) && project.activeChangeCaseCount > 0 ? project.activeChangeCaseCount : 0,
    latestChangeCaseId: typeof project?.latestActiveChangeCaseId === 'string' && /^change-case-[0-9a-f-]{36}$/.test(project.latestActiveChangeCaseId)
      ? project.latestActiveChangeCaseId : null,
    latestChangeCaseTitle: typeof project?.latestActiveChangeCaseTitle === 'string' ? project.latestActiveChangeCaseTitle : 'Governed change',
    changeCaseProjectionIncomplete: project?.changeCaseProjectionIncomplete === true,
    integrityStatus: ['NOT_RUN', 'PASS', 'REVIEW', 'FAIL'].includes(project?.integrityStatus) ? project.integrityStatus : 'UNKNOWN',
    integritySourceCurrent: project?.integritySourceCurrent === true,
    integrityReportId: typeof project?.integrityReportId === 'string' && /^enterprise-integrity-[0-9a-f-]{36}$/.test(project.integrityReportId)
      ? project.integrityReportId : null,
    integrityFindingCount: Number.isSafeInteger(project?.integrityFindingCount) && project.integrityFindingCount >= 0
      ? project.integrityFindingCount : null,
    integrityBlueprintVersion: Number.isSafeInteger(project?.integrityBlueprintVersion) ? project.integrityBlueprintVersion : null,
    integrityProjectionIncomplete: project?.integrityProjectionIncomplete === true,
    updated: typeof project?.updatedAt === 'string' && Number.isFinite(Date.parse(project.updatedAt))
      ? new Date(project.updatedAt).toLocaleString() : 'No saved activity time',
  };
}

export function portfolioDesignExportFilename(bundle) {
  const source = bundle?.source;
  if (bundle?.kind !== 'orgward-enterprise-blueprint' || !source
    || !/^blueprint-[0-9a-f-]{36}$/.test(source.blueprintId ?? '')
    || !Number.isSafeInteger(source.blueprintVersion) || source.blueprintVersion < 1
    || typeof source.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(source.snapshotHash)) {
    throw new Error('The proposed design export did not include a valid saved blueprint pin.');
  }
  return `orgward-enterprise-${source.blueprintId}-v${source.blueprintVersion}.json`;
}

export async function readPortfolioImportFile(file) {
  if (!file || typeof file.text !== 'function' || !Number.isFinite(file.size) || file.size < 0 || file.size > 1_000_000) {
    throw new Error('Choose a proposed design JSON bundle no larger than 1 MB.');
  }
  try { return { fileName: file.name || 'enterprise-design.json', bundle: JSON.parse(await file.text()), recordIds: [], sourceSelections: [], reason: '' }; }
  catch { throw new Error('The selected file is not valid JSON.'); }
}

export function portfolioImportWorkspaceRoute(blueprint) {
  const items = Object.values(blueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
  const target = items.find((item) => item.type === 'information') ?? items[0] ?? null;
  return { view: 'map', selectedId: target?.id ?? null };
}

function canonicalPortfolioJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalPortfolioJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalPortfolioJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function snapshotHash(baseline) {
  const data = new TextEncoder().encode(canonicalPortfolioJson(baseline));
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function verifyPortfolioDesignBundle(projectId, bundle) {
  const fileName = portfolioDesignExportFilename(bundle);
  const { source, baseline } = bundle;
  if (source.projectId !== projectId || !baseline || baseline.id !== source.blueprintId
    || baseline.version !== source.blueprintVersion) {
    throw new Error('The proposed design export does not match its exact workspace and saved blueprint pin.');
  }
  if (await snapshotHash(baseline) !== source.snapshotHash) {
    throw new Error('The proposed design export baseline failed its snapshot hash check.');
  }
  return { fileName, source };
}

export async function downloadPortfolioDesign(projectId, { api, el, createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url), deferRevoke = (callback) => setTimeout(callback, 1000) }) {
  const response = await api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/export`);
  const bundle = response.data;
  const { fileName, source } = await verifyPortfolioDesignBundle(projectId, bundle);
  const url = createObjectURL(new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' }));
  const anchor = el('a', { attrs: { href: url, download: fileName } });
  try { anchor.click(); }
  finally { anchor.remove(); deferRevoke(() => revokeObjectURL(url)); }
  return { fileName, source };
}

export function renderProjectPortfolio(projects, { el, onOpen, onExport, onImport }) {
  const section = el('section', { className: 'portfolio-list', attrs: { 'aria-labelledby': 'portfolio-heading' } });
  section.append(el('div', { className: 'portfolio-heading' }, [
    el('div', {}, [el('span', { className: 'eyebrow', text: 'Your portfolio' }),
      el('h2', { text: 'Workspaces' }),
      el('p', { text: 'Choose a workspace to continue. Access and saved design state are shown for each one.' })]),
    el('span', { className: 'portfolio-count', text: `${projects.length} ${projects.length === 1 ? 'workspace' : 'workspaces'}` }),
  ]));
  const list = el('div', { className: 'portfolio-cards', attrs: { role: 'list' } });
  if (!projects.length) list.append(el('p', { className: 'portfolio-empty', text: 'No workspaces are available to your account yet.' }));
  for (const project of projects) {
    const facts = projectPortfolioFacts(project);
    const card = el('article', { className: 'portfolio-card', attrs: { role: 'listitem', 'data-project-id': project.id } });
    card.append(el('div', { className: 'portfolio-card-heading' }, [
      el('div', {}, [el('h3', { text: facts.name }), el('span', { className: 'portfolio-access', text: facts.access })]),
      el('span', { className: 'portfolio-phase', text: facts.phase }),
    ]));
    card.append(el('p', { className: 'portfolio-blueprint', text: facts.blueprint }));
    card.append(el('p', { className: 'portfolio-updated', text: `Last saved ${facts.updated}` }));
    card.append(el('p', { className: 'portfolio-issues', text: `Active incidents: ${facts.incidents} · Active support: ${facts.support}` }));
    card.append(el('p', { className: 'portfolio-changes', text: facts.changeCaseProjectionIncomplete
      ? `${facts.changeCases} active governed changes · some case details are unavailable`
      : `Active governed changes: ${facts.changeCases}` }));
    if (facts.latestChangeCaseId) card.append(el('a', { className: 'button ghost', text: `Open governed change: ${facts.latestChangeCaseTitle}`,
      attrs: { href: `/sdlc.html?case=${encodeURIComponent(facts.latestChangeCaseId)}` } }));
    const integrityText = facts.integrityProjectionIncomplete ? 'Integrity report details unavailable'
      : facts.integrityStatus === 'NOT_RUN' ? 'Integrity: not yet checked'
        : facts.integrityStatus === 'UNKNOWN' ? 'Integrity status unavailable'
          : `Integrity ${facts.integrityStatus} · ${facts.integrityFindingCount ?? 'unknown'} findings · ${facts.integritySourceCurrent
            ? `current blueprint v${facts.integrityBlueprintVersion}` : `last checked blueprint v${facts.integrityBlueprintVersion ?? 'unknown'} (stale)`}`;
    card.append(el('p', { className: 'portfolio-integrity', text: integrityText }));
    if (facts.integrityReportId && !facts.integrityProjectionIncomplete) {
      const reviewIntegrity = el('button', { className: 'button ghost', text: 'Review integrity report', attrs: { type: 'button' } });
      reviewIntegrity.addEventListener('click', () => onOpen(project.id, { focusIntegrity: true }));
      card.append(reviewIntegrity);
    }
    const open = el('button', { className: 'button secondary', text: 'Open workspace', attrs: { type: 'button' } });
    open.addEventListener('click', () => onOpen(project.id));
    card.append(open);
    const hasWorkspaceAccess = ['owner', 'editor', 'reader'].includes(project.workspaceAccess);
    const exportButton = el('button', { className: 'button ghost', text: 'Export proposed design JSON', attrs: { type: 'button', ...(!facts.hasBlueprint || !hasWorkspaceAccess ? { disabled: 'disabled' } : {}) } });
    exportButton.addEventListener('click', () => onExport(project.id, exportButton));
    card.append(exportButton);
    const importFile = el('input', { attrs: { type: 'file', accept: '.json,application/json',
      'aria-label': `Import proposed design JSON for ${facts.name}`,
      ...(!facts.hasBlueprint || !hasWorkspaceAccess ? { disabled: 'disabled' } : {}) } });
    importFile.addEventListener('change', () => {
      const file = importFile.files?.[0];
      if (file) onImport?.(project.id, file);
    });
    card.append(el('label', { className: 'portfolio-import', text: 'Import proposed design JSON' }, [importFile]));
    if (facts.incidents) {
      const reviewIncidents = el('button', { className: 'button ghost', text: `Review incidents (${facts.incidents})`, attrs: { type: 'button' } });
      reviewIncidents.addEventListener('click', () => onOpen(project.id, { focusOutcomes: true, focusOutcomeCategory: 'incident' }));
      card.append(reviewIncidents);
    }
    if (facts.support) {
      const reviewSupport = el('button', { className: 'button ghost', text: `Review support (${facts.support})`, attrs: { type: 'button' } });
      reviewSupport.addEventListener('click', () => onOpen(project.id, { focusOutcomes: true, focusOutcomeCategory: 'support' }));
      card.append(reviewSupport);
    }
    list.append(card);
  }
  section.append(list);
  return section;
}
