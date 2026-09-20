import { connectedNodeIds, filterGraph, toggleType, zoomTransform } from './map-state.js';

const state = {
  projects: [],
  project: null,
  view: 'blueprint',
  mapMode: 'graph',
  activeTypes: new Set(),
  selectedId: null,
  transform: { x: 0, y: 0, k: 1 },
};

const typeColors = {
  goal: '#c9ff7e', strategy: '#a8d67b', customer: '#f1c278', offering: '#e99c65', economics: '#dd7e69',
  capability: '#71c6a1', process: '#65a7b7', 'actor-human': '#e6d7aa', 'actor-agent': '#a9a0df', role: '#c690cf',
  resource: '#8f9f78', information: '#6e9fc8', system: '#7c83ca', decision: '#d29e6d', risk: '#e57d70', control: '#cbb66a',
  metric: '#80c6cb', 'feedback-loop': '#81d58d', lifecycle: '#9daaa2',
};

const app = document.querySelector('#app');
const select = document.querySelector('#project-select');
const toast = document.querySelector('#toast');

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  for (const child of Array.isArray(children) ? children : [children]) if (child) node.append(child);
  return node;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function notify(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

async function refreshProjects() {
  const result = await api('/api/projects');
  state.projects = result.projects;
  select.replaceChildren(element('option', { text: state.projects.length ? 'Choose project…' : 'No projects yet', attrs: { value: '' } }));
  for (const project of state.projects) select.append(element('option', { text: project.name, attrs: { value: project.id } }));
  select.value = state.project?.id ?? '';
}

function showWelcome() {
  state.project = null;
  state.selectedId = null;
  app.replaceChildren(document.querySelector('#welcome-template').content.cloneNode(true));
  document.querySelector('#create-form').addEventListener('submit', createProject);
  select.value = '';
}

async function createProject(event) {
  event.preventDefault();
  const input = event.currentTarget.elements.name;
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    state.project = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: input.value }) });
    await refreshProjects();
    renderStudio();
    setTimeout(() => document.querySelector('#message-input')?.focus(), 0);
  } catch (error) {
    notify(error.message);
    button.disabled = false;
  }
}

async function loadProject(id) {
  if (!id) return showWelcome();
  try {
    state.project = await api(`/api/projects/${id}`);
    state.selectedId = null;
    state.activeTypes = new Set(state.project.graph.types);
    renderStudio();
  } catch (error) {
    notify(error.message);
  }
}

function renderStudio() {
  app.replaceChildren(document.querySelector('#studio-template').content.cloneNode(true));
  document.querySelector('.studio').classList.toggle('complete', state.project.phase !== 'discovery');
  document.querySelector('#project-title').textContent = state.project.name;
  renderConversation();
  document.querySelector('#message-form').addEventListener('submit', sendMessage);
  for (const button of document.querySelectorAll('.view-tabs button')) button.addEventListener('click', () => setView(button.dataset.view));

  if (state.project.latestBlueprint) {
    document.querySelector('#workspace-empty').hidden = true;
    document.querySelector('#blueprint-workspace').hidden = false;
    document.querySelector('#blueprint-title').textContent = state.project.latestBlueprint.title;
    document.querySelector('#blueprint-version').textContent = state.project.latestBlueprint.version;
    if (!state.activeTypes.size) state.activeTypes = new Set(state.project.graph.types);
    renderBlueprint();
    setView(state.view);
    setupMapControls();
  }
}

function renderConversation() {
  const project = state.project;
  const container = document.querySelector('#conversation');
  for (const message of project.conversation) {
    const author = message.role === 'assistant' ? 'OrgWard' : 'You';
    const card = element('article', { className: `message ${message.role}` }, [
      element('header', {}, [element('span'), document.createTextNode(author)]),
      element('p', { text: message.content }),
    ]);
    container.append(card);
  }
  container.scrollTop = container.scrollHeight;
  document.querySelectorAll('.discovery-progress i').forEach((bar, index) => bar.classList.toggle('complete', index < project.questionIndex));
  const form = document.querySelector('#message-form');
  if (project.phase !== 'discovery') {
    form.classList.add('complete');
    document.querySelector('#question-count').textContent = 'Discovery complete · Blueprint saved';
  } else {
    document.querySelector('#question-count').textContent = `Question ${project.questionIndex + 1} of 4`;
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const textarea = event.currentTarget.elements['message-input'];
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    state.project = await api(`/api/projects/${state.project.id}/messages`, {
      method: 'POST', body: JSON.stringify({ content: textarea.value }),
    });
    if (state.project.latestBlueprint) {
      state.activeTypes = new Set(state.project.graph.types);
      state.view = 'blueprint';
      notify('Blueprint saved with integrity checks.');
      await refreshProjects();
    }
    renderStudio();
    setTimeout(() => document.querySelector('#message-input')?.focus(), 0);
  } catch (error) {
    notify(error.message);
    button.disabled = false;
  }
}

function setView(view) {
  state.view = view;
  document.querySelector('#blueprint-view').hidden = view !== 'blueprint';
  document.querySelector('#map-view').hidden = view !== 'map';
  document.querySelectorAll('.view-tabs button').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.view === view)));
  if (view === 'map') {
    if (window.matchMedia('(max-width: 560px)').matches && state.mapMode === 'graph') state.mapMode = 'list';
    renderMap();
  }
}

function renderBlueprint() {
  const blueprint = state.project.latestBlueprint;
  const brief = state.project.brief;
  const view = document.querySelector('#blueprint-view');
  const summary = element('div', { className: 'summary-strip' });
  for (const [value, label] of [
    [blueprint.summary.areaCount, 'Design areas'], [blueprint.summary.objectCount, 'Linked objects'],
    [blueprint.summary.relationCount, 'Relationships'], [blueprint.integrity.gaps.length, 'Visible gaps'],
  ]) summary.append(element('div', {}, [element('strong', { text: value }), element('span', { text: label })]));
  view.append(summary);

  const briefCard = element('section', { className: 'brief-card' }, [
    element('div', { className: 'eyebrow', text: 'Saved business scope' }),
    element('h3', { text: brief.title }),
    element('p', { text: brief.scope }),
    element('div', { className: 'brief-columns' }, [
      element('div', {}, [element('b', { text: 'Customer value' }), element('p', { text: brief.customerValue })]),
      element('div', {}, [element('b', { text: 'Economics & constraints' }), element('p', { text: brief.economicsAndConstraints })]),
    ]),
  ]);
  view.append(briefCard);

  view.append(element('p', { className: 'integrity-line' }, [
    element('i'), document.createTextNode(`${blueprint.integrity.valid ? 'Reference and structure checks passed' : 'Integrity errors found'} · ${blueprint.epistemicStatus.replace('-', ' ')} · confidence and provenance retained`),
  ]));
  const grid = element('div', { className: 'area-grid' });
  for (const entry of Object.values(blueprint.areas)) {
    const list = element('ul');
    for (const object of entry.items) list.append(element('li', { text: object.name }));
    grid.append(element('article', { className: 'area-card' }, [
      element('header', {}, [element('h3', { text: entry.label }), element('span', { text: entry.status.replace('_', ' ') })]), list,
    ]));
  }
  view.append(grid);
  const gaps = element('section', { className: 'gaps' }, [element('h3', { text: 'Actionable gaps' })]);
  for (const gap of blueprint.integrity.gaps) gaps.append(element('div', { className: 'gap' }, [element('b', { text: gap.severity }), element('span', { text: gap.action })]));
  view.append(gaps);
}

function setupMapControls() {
  document.querySelector('#graph-mode').addEventListener('click', () => setMapMode('graph'));
  document.querySelector('#list-mode').addEventListener('click', () => setMapMode('list'));
  document.querySelector('#zoom-in').addEventListener('click', () => zoomBy(1.2));
  document.querySelector('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
  document.querySelector('#zoom-reset').addEventListener('click', () => { state.transform = { x: 0, y: 0, k: 1 }; renderGraph(); });
}

function setMapMode(mode) {
  state.mapMode = mode;
  document.querySelector('#graph-mode').setAttribute('aria-pressed', String(mode === 'graph'));
  document.querySelector('#list-mode').setAttribute('aria-pressed', String(mode === 'list'));
  document.querySelector('#graph-canvas').hidden = mode !== 'graph';
  document.querySelector('#list-canvas').hidden = mode !== 'list';
  document.querySelector('#zoom-in').hidden = mode !== 'graph';
  document.querySelector('#zoom-out').hidden = mode !== 'graph';
  document.querySelector('#zoom-reset').hidden = mode !== 'graph';
  if (mode === 'graph') renderGraph(); else renderList();
}

function renderMap() {
  const filters = document.querySelector('#type-filters');
  filters.replaceChildren();
  for (const type of state.project.graph.types) {
    const button = element('button', {
      className: `type-${type}`,
      text: type.replaceAll('-', ' '),
      attrs: { type: 'button', 'aria-pressed': String(state.activeTypes.has(type)) },
    });
    button.addEventListener('click', () => {
      state.activeTypes = toggleType(state.activeTypes, type);
      renderMap();
    });
    filters.append(button);
  }
  setMapMode(state.mapMode);
  renderDetail();
}

function visibleGraph() {
  return filterGraph(state.project.graph, state.activeTypes);
}

function nodePositions(nodes) {
  const byArea = new Map();
  for (const node of nodes) {
    if (!byArea.has(node.area)) byArea.set(node.area, []);
    byArea.get(node.area).push(node);
  }
  const allAreas = Object.keys(state.project.latestBlueprint.areas);
  const positions = new Map();
  for (const [area, areaNodes] of byArea) {
    const areaIndex = allAreas.indexOf(area);
    const angle = (areaIndex / allAreas.length) * Math.PI * 2 - Math.PI / 2;
    const cx = 600 + Math.cos(angle) * 275;
    const cy = 380 + Math.sin(angle) * 260;
    areaNodes.forEach((node, index) => {
      const localAngle = (index / areaNodes.length) * Math.PI * 2 + angle;
      const radius = areaNodes.length === 1 ? 0 : Math.min(54, 18 + areaNodes.length * 7);
      positions.set(node.id, { x: cx + Math.cos(localAngle) * radius, y: cy + Math.sin(localAngle) * radius });
    });
  }
  return positions;
}

function renderGraph() {
  const canvas = document.querySelector('#graph-canvas');
  if (!canvas) return;
  canvas.replaceChildren();
  const { nodes, links } = visibleGraph();
  const positions = nodePositions(nodes);
  const svg = svgElement('svg', { viewBox: '0 0 1200 760', role: 'img', 'aria-label': `${nodes.length} organisational objects and ${links.length} relationships` });
  const world = svgElement('g', { transform: transformValue() });
  const selected = state.selectedId;
  const neighbors = connectedNodeIds(links, selected);

  for (const link of links) {
    const source = positions.get(link.source); const target = positions.get(link.target);
    if (!source || !target) continue;
    const related = selected && (link.source === selected || link.target === selected);
    const line = svgElement('line', { x1: source.x, y1: source.y, x2: target.x, y2: target.y, class: `graph-link${related ? ' related' : ''}${selected && !related ? ' dimmed' : ''}` });
    line.append(svgElement('title'));
    line.firstChild.textContent = link.type;
    world.append(line);
  }
  for (const node of nodes) {
    const position = positions.get(node.id);
    const group = svgElement('g', { transform: `translate(${position.x} ${position.y})`, class: `graph-node${node.id === selected ? ' selected' : ''}${selected && !neighbors.has(node.id) ? ' dimmed' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${node.type}: ${node.name}` });
    group.append(svgElement('circle', { r: node.id === selected ? 12 : 9, fill: typeColors[node.type] ?? '#9daaa2' }));
    const label = svgElement('text', { x: '14', y: '4' }); label.textContent = node.name; group.append(label);
    const title = svgElement('title'); title.textContent = `${node.name} — ${node.detail}`; group.append(title);
    group.addEventListener('click', (event) => { event.stopPropagation(); selectNode(node.id); });
    group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id); } });
    world.append(group);
  }
  svg.append(world);
  enablePanZoom(svg);
  canvas.append(svg);
}

function transformValue() {
  const { x, y, k } = state.transform;
  return `translate(${x} ${y}) scale(${k})`;
}

function zoomBy(factor, point = { x: 600, y: 380 }) {
  state.transform = zoomTransform(state.transform, factor, point);
  renderGraph();
}

function enablePanZoom(svg) {
  let dragging = false; let start = null;
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const point = { x: ((event.clientX - rect.left) / rect.width) * 1200, y: ((event.clientY - rect.top) / rect.height) * 760 };
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, point);
  }, { passive: false });
  svg.addEventListener('pointerdown', (event) => { dragging = true; start = { x: event.clientX, y: event.clientY, tx: state.transform.x, ty: state.transform.y }; svg.classList.add('dragging'); svg.setPointerCapture(event.pointerId); });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    state.transform.x = start.tx + (event.clientX - start.x) * (1200 / rect.width);
    state.transform.y = start.ty + (event.clientY - start.y) * (760 / rect.height);
    svg.firstChild?.setAttribute('transform', transformValue());
  });
  const end = () => { dragging = false; svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('click', (event) => { if (event.target === svg) selectNode(null); });
}

function renderList() {
  const canvas = document.querySelector('#list-canvas');
  canvas.replaceChildren();
  const { nodes } = visibleGraph();
  const groups = new Map();
  for (const node of nodes) {
    if (!groups.has(node.areaLabel)) groups.set(node.areaLabel, []);
    groups.get(node.areaLabel).push(node);
  }
  for (const [area, areaNodes] of groups) {
    const section = element('section', { className: 'list-area' }, [element('h3', { text: area })]);
    for (const node of areaNodes) {
      const row = element('button', { className: `list-row${node.id === state.selectedId ? ' selected' : ''}`, attrs: { type: 'button' } }, [
        element('i', { className: `type-dot type-${node.type}` }), element('span', { text: node.type.replaceAll('-', ' ') }),
        element('strong', { text: node.name }), element('small', { text: node.status }),
      ]);
      row.addEventListener('click', () => selectNode(node.id)); section.append(row);
    }
    canvas.append(section);
  }
}

function selectNode(id) {
  state.selectedId = id;
  if (state.mapMode === 'graph') renderGraph(); else renderList();
  renderDetail();
}

function renderDetail() {
  const detail = document.querySelector('#object-detail');
  if (!detail) return;
  const node = state.project.graph.nodes.find((entry) => entry.id === state.selectedId);
  if (!node) {
    detail.replaceChildren(element('p', { className: 'detail-placeholder', text: 'Select an object to inspect its design status, confidence, provenance, and relationships.' }));
    return;
  }
  const type = element('span', { className: `type type-${node.type}`, text: node.type.replaceAll('-', ' ') });
  const meta = element('div', { className: 'detail-meta' }, [
    element('div', {}, [element('b', { text: 'Status' }), element('span', { text: node.status })]),
    element('div', {}, [element('b', { text: 'Confidence' }), element('span', { text: node.confidence })]),
  ]);
  const connections = element('div', { className: 'connections' }, [element('h4', { text: 'Connections' })]);
  const relatedLinks = state.project.graph.links.filter((link) => link.source === node.id || link.target === node.id);
  for (const link of relatedLinks) {
    const otherId = link.source === node.id ? link.target : link.source;
    const other = state.project.graph.nodes.find((entry) => entry.id === otherId);
    if (!other) continue;
    const button = element('button', { text: `${link.type} · ${other.name}`, attrs: { type: 'button' } });
    button.addEventListener('click', () => { state.activeTypes.add(other.type); selectNode(other.id); });
    connections.append(button);
  }
  detail.replaceChildren(type, element('h3', { text: node.name }), element('p', { text: node.detail }), meta,
    element('p', { text: `Evidence: ${node.provenance?.[0]?.note ?? 'No provenance recorded'}` }), connections);
}

select.addEventListener('change', () => loadProject(select.value));
document.querySelector('#new-project').addEventListener('click', showWelcome);

try {
  await refreshProjects();
  if (state.projects.length) await loadProject(state.projects[0].id); else showWelcome();
} catch (error) {
  showWelcome();
  notify(error.message);
}
