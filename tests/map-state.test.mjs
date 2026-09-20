import assert from 'node:assert/strict';
import test from 'node:test';
import { connectedNodeIds, filterGraph, toggleType, zoomTransform } from '../public/map-state.js';

const graph = {
  nodes: [
    { id: 'capability', type: 'capability', name: 'Delivery' },
    { id: 'process', type: 'process', name: 'Deliver order' },
    { id: 'role', type: 'role', name: 'Operations owner' },
  ],
  links: [
    { source: 'process', target: 'capability', type: 'realises' },
    { source: 'role', target: 'process', type: 'owns' },
  ],
};

test('map filters types while retaining a valid linked subgraph', () => {
  let active = new Set(['capability', 'process', 'role']);
  active = toggleType(active, 'role');
  const filtered = filterGraph(graph, active);
  assert.deepEqual(filtered.nodes.map((node) => node.id), ['capability', 'process']);
  assert.deepEqual(filtered.links, [{ source: 'process', target: 'capability', type: 'realises' }]);
  assert.equal(active.has('role'), false);
  assert.equal(toggleType(active, 'role').has('role'), true);
});

test('selection context resolves linked objects and remains view-independent', () => {
  const selectedId = 'process';
  const related = connectedNodeIds(graph.links, selectedId);
  assert.deepEqual(related, new Set(['process', 'capability', 'role']));
  const graphViewSelection = selectedId;
  const listViewSelection = graphViewSelection;
  assert.equal(listViewSelection, selectedId);
  assert.equal(graph.nodes.find((node) => node.id === listViewSelection).name, 'Deliver order');
});

test('map zoom is centred and bounded', () => {
  const initial = { x: 0, y: 0, k: 1 };
  assert.deepEqual(zoomTransform(initial, 2, { x: 100, y: 100 }), { x: -100, y: -100, k: 2 });
  assert.equal(zoomTransform(initial, 10).k, 2.8);
  assert.equal(zoomTransform(initial, 0.01).k, .45);
});
