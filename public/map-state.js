export function toggleType(activeTypes, type) {
  const next = new Set(activeTypes);
  if (next.has(type)) next.delete(type); else next.add(type);
  return next;
}

export function filterGraph(graph, activeTypes) {
  const nodes = graph.nodes.filter((node) => activeTypes.has(node.type));
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, links: graph.links.filter((link) => ids.has(link.source) && ids.has(link.target)) };
}

function normalizedSearchText(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
}

export function searchGraph(graph, query) {
  const needle = normalizedSearchText(query).trim();
  if (!needle) return graph;
  const nodes = graph.nodes.filter((node) => [node.name, node.detail, node.type, node.area, node.areaLabel]
    .some((value) => normalizedSearchText(value).includes(needle)));
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, links: graph.links.filter((link) => ids.has(link.source) && ids.has(link.target)) };
}

export function shouldStartMapPan(target) {
  return !target?.closest?.('.graph-node');
}

export function mapControlPressed(nodeId, selectedId) {
  return String(selectedId !== null && nodeId === selectedId);
}

export function graphAccessibilityAttributes(nodeCount, relationshipCount) {
  return {
    role: 'group',
    'aria-label': `Interactive organisational map with ${nodeCount} ${nodeCount === 1 ? 'object' : 'objects'} and ${relationshipCount} ${relationshipCount === 1 ? 'relationship' : 'relationships'}`,
  };
}

export function focusSelectedMapControl(container, mode, selectedId) {
  if (!container || !selectedId) return false;
  const selector = mode === 'graph' ? '.graph-node[aria-pressed="true"]'
    : mode === 'list' ? '.list-row[aria-pressed="true"]' : null;
  if (!selector) return false;
  const selected = container.querySelector(selector);
  if (!selected) return false;
  selected.focus();
  return true;
}

export function focusFirstMapResult(container, mode) {
  if (!container) return false;
  const selector = mode === 'graph' ? '.graph-node'
    : mode === 'list' ? '.list-row' : null;
  if (!selector) return false;
  const result = container.querySelector(selector);
  if (!result) return false;
  result.focus();
  return true;
}

export function connectedNodeIds(links, selectedId) {
  const connected = new Set(selectedId ? [selectedId] : []);
  for (const link of links) {
    if (link.source === selectedId || link.target === selectedId) {
      connected.add(link.source);
      connected.add(link.target);
    }
  }
  return connected;
}

export function zoomTransform(transform, factor, point = { x: 600, y: 380 }) {
  const k = Math.max(.45, Math.min(2.8, transform.k * factor));
  return {
    x: point.x - (point.x - transform.x) * (k / transform.k),
    y: point.y - (point.y - transform.y) * (k / transform.k),
    k,
  };
}
