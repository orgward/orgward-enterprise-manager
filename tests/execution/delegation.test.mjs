import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleParentAgentRuns } from '../../public/execution-delegation.mjs';

test('multi-agent handoff parent selection stays inside completed exact-source runs and another binding', () => {
  const source = { processPlanId: 'plan', revision: 2, planInstanceId: 'instance', blueprintId: 'blueprint', blueprintVersion: 4 };
  const candidate = (id, overrides = {}) => ({ id, projectId: 'project', status: 'SUCCEEDED', createdAt: id,
    execution: { status: 'COMPLETED' }, processTaskRef: { ...source, actorId: 'agent-parent', roleId: 'role-parent' }, ...overrides });
  const selected = eligibleParentAgentRuns({ projectId: 'project', planId: 'plan', revision: 2, planInstanceId: 'instance',
    blueprintId: 'blueprint', blueprintVersion: 4, actorId: 'agent-child', roleId: 'role-child', runs: [
      candidate('valid'), candidate('other-project', { projectId: 'other' }),
      candidate('failed', { status: 'FAILED' }), candidate('incomplete', { execution: { status: 'FAILED' } }),
      candidate('stale-plan', { processTaskRef: { ...source, revision: 1 } }),
      candidate('same-binding', { processTaskRef: { ...source, actorId: 'agent-child', roleId: 'role-child' } }),
    ] });
  assert.deepEqual(selected.map((run) => run.id), ['valid']);
});
