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
