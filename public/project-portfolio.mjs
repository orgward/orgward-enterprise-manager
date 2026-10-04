const accessLabels = Object.freeze({ owner: 'Owner access', editor: 'Editor access', reader: 'Reader access' });

export function projectPortfolioFacts(project) {
  return {
    name: typeof project?.name === 'string' && project.name.trim() ? project.name.trim() : 'Untitled workspace',
    phase: typeof project?.phase === 'string' && project.phase.trim() ? project.phase.trim() : 'Not started',
    blueprint: Number.isInteger(project?.blueprintVersion) && project.blueprintVersion > 0
      ? `Blueprint version ${project.blueprintVersion}` : 'No saved blueprint yet',
    access: accessLabels[project?.workspaceAccess] ?? 'Local workspace',
    updated: typeof project?.updatedAt === 'string' && Number.isFinite(Date.parse(project.updatedAt))
      ? new Date(project.updatedAt).toLocaleString() : 'No saved activity time',
  };
}

export function renderProjectPortfolio(projects, { el, onOpen }) {
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
    const open = el('button', { className: 'button secondary', text: 'Open workspace', attrs: { type: 'button' } });
    open.addEventListener('click', () => onOpen(project.id));
    card.append(open);
    list.append(card);
  }
  section.append(list);
  return section;
}
