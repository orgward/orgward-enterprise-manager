import assert from 'node:assert/strict';
import test from 'node:test';
import { connectedNodeIds, filterGraph, focusFirstMapResult, focusSelectedMapControl, graphAccessibilityAttributes, mapControlPressed, searchGraph, shouldStartMapPan, toggleType, zoomTransform } from '../public/map-state.js';

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

test('map search matches names, detail, type, and area without dangling links', () => {
  const searchable = {
    nodes: [
      { id: 'goal', type: 'goal', name: 'Café launch', detail: 'Serve neighborhood offices', area: 'purposeStrategy', areaLabel: 'Purpose and strategy' },
      { id: 'decision', type: 'decision', name: 'Operating choice', detail: 'Choose workspace regions', area: 'responsibilityAuthority', areaLabel: 'Responsibility and authority' },
    ],
    links: [{ source: 'decision', target: 'goal', type: 'governs' }],
  };

  assert.deepEqual(searchGraph(searchable, ' cafe ').nodes.map((node) => node.id), ['goal']);
  assert.deepEqual(searchGraph(searchable, 'WORKSPACE').nodes.map((node) => node.id), ['decision']);
  assert.deepEqual(searchGraph(searchable, 'goal').nodes.map((node) => node.id), ['goal']);
  assert.deepEqual(searchGraph(searchable, 'responsibility and authority').nodes.map((node) => node.id), ['decision']);
  assert.deepEqual(searchGraph(searchable, 'operating').links, []);
  assert.deepEqual(searchGraph(searchable, 'not in this design'), { nodes: [], links: [] });
  assert.deepEqual(searchGraph(searchable, '   '), searchable);
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

test('graph node clicks are not captured as background panning', () => {
  const graphNode = {};
  const nestedNodeContent = { closest: (selector) => selector === '.graph-node' ? graphNode : null };
  const canvasBackground = { closest: () => null };

  assert.equal(shouldStartMapPan(nestedNodeContent), false);
  assert.equal(shouldStartMapPan(canvasBackground), true);
});

test('graph and list selections expose pressed state and restore focus after rerender', () => {
  assert.equal(mapControlPressed('process', 'process'), 'true');
  assert.equal(mapControlPressed('role', 'process'), 'false');
  assert.equal(mapControlPressed('process', null), 'false');

  for (const [mode, expectedSelector] of [
    ['graph', '.graph-node[aria-pressed="true"]'],
    ['list', '.list-row[aria-pressed="true"]'],
  ]) {
    let queriedSelector = null;
    let focusCount = 0;
    const container = {
      querySelector(selector) {
        queriedSelector = selector;
        return { focus() { focusCount += 1; } };
      },
    };
    assert.equal(focusSelectedMapControl(container, mode, 'process'), true);
    assert.equal(queriedSelector, expectedSelector);
    assert.equal(focusCount, 1);
  }

  let queriedForClear = false;
  assert.equal(focusSelectedMapControl({ querySelector() { queriedForClear = true; } }, 'graph', null), false);
  assert.equal(queriedForClear, false);
});

test('interactive graph semantics keep SVG result controls available to keyboard and assistive technology', () => {
  assert.deepEqual(graphAccessibilityAttributes(1, 0), {
    role: 'group',
    'aria-label': 'Interactive organisational map with 1 object and 0 relationships',
  });
  assert.notEqual(graphAccessibilityAttributes(1, 0).role, 'img');
});

test('skip map controls focuses the first filtered result in the active view', () => {
  for (const [mode, selector] of [['graph', '.graph-node'], ['list', '.list-row']]) {
    let queried = null;
    let focusCount = 0;
    const container = { querySelector(value) { queried = value; return { focus() { focusCount += 1; } }; } };
    assert.equal(focusFirstMapResult(container, mode), true);
    assert.equal(queried, selector);
    assert.equal(focusCount, 1);
  }

  assert.equal(focusFirstMapResult({ querySelector() { return null; } }, 'graph'), false);
  assert.equal(focusFirstMapResult({ querySelector() { throw new Error('unexpected selector'); } }, 'unknown'), false);
});

test('map zoom is centred and bounded', () => {
  const initial = { x: 0, y: 0, k: 1 };
  assert.deepEqual(zoomTransform(initial, 2, { x: 100, y: 100 }), { x: -100, y: -100, k: 2 });
  assert.equal(zoomTransform(initial, 10).k, 2.8);
  assert.equal(zoomTransform(initial, 0.01).k, .45);
});
