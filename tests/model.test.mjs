import assert from 'node:assert/strict';
import test from 'node:test';
import { AREA_DEFINITIONS, addConversationTurn, createProject, validateBlueprint } from '../src/model.mjs';

const ANSWERS = [
  'A repair membership that keeps small restaurant equipment working and reduces emergency downtime.',
  'Independent restaurant owners receive preventive maintenance, rapid triage, and clear repair histories.',
  'Monthly membership plus parts; launch must keep travel time, inventory, and cash exposure low.',
  'A human approves safety-critical repairs and spending. Scheduling and service records can be automated in the studio.',
];

function completeDiscovery() {
  const project = createProject('Service Loop');
  for (const answer of ANSWERS) addConversationTurn(project, answer);
  return project;
}

test('guided chat saves a scoped brief with assumptions and unknowns', () => {
  const project = completeDiscovery();
  assert.equal(project.phase, 'blueprint_ready');
  assert.equal(project.questionIndex, 4);
  assert.equal(project.conversation.filter((message) => message.role === 'user').length, 4);
  assert.match(project.brief.scope, /repair membership/);
  assert.ok(project.brief.assumptions.length >= 3);
  assert.ok(project.brief.unknowns.length >= 3);
  assert.equal(project.audit.at(-1).action, 'blueprint.generated');
});

test('generated blueprint covers every contracted area and retains epistemic metadata', () => {
  const blueprint = completeDiscovery().blueprintVersions[0];
  assert.equal(blueprint.version, 1);
  assert.equal(blueprint.epistemicStatus, 'proposed-design');
  assert.equal(blueprint.summary.areaCount, AREA_DEFINITIONS.length);
  assert.ok(blueprint.summary.objectCount >= 25);
  assert.ok(blueprint.summary.relationCount >= 30);
  for (const [key] of AREA_DEFINITIONS) {
    assert.equal(blueprint.areas[key].status, 'designed');
    assert.ok(blueprint.areas[key].items.length > 0);
    for (const object of blueprint.areas[key].items) {
      assert.ok(object.provenance.length > 0, `${object.id} must have provenance`);
      assert.ok(['low', 'medium', 'high'].includes(object.confidence));
    }
  }
  assert.equal(blueprint.integrity.valid, true);
  assert.equal(blueprint.integrity.errors.length, 0);
  assert.ok(blueprint.integrity.gaps.some((gap) => gap.id === 'gap-market-evidence'));
});

test('integrity checks catch missing areas, dangling links, and incomplete ownership', () => {
  const blueprint = structuredClone(completeDiscovery().blueprintVersions[0]);
  delete blueprint.areas.lifecycle;
  blueprint.relations.push({ id: 'broken-link', source: 'missing-object', target: 'goal-customer-outcome', type: 'owns' });
  const capability = blueprint.areas.capabilitiesProcesses.items.find((object) => object.type === 'capability');
  delete capability.owner;
  const result = validateBlueprint(blueprint);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'AREA_MISSING'));
  assert.ok(result.errors.some((error) => error.code === 'DANGLING_REFERENCE'));
  assert.ok(result.gaps.some((gap) => gap.id === `gap-owner-${capability.id}`));
});
