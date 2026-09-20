import assert from 'node:assert/strict';

// Abstract specification oracle only. The application must not import this as
// its authorization engine; integration/race/effect tests remain mandatory.
export function contractDecision(operation, input) {
  const required = {
    publish: ['permission','headMatches','impactComplete','constraintsPass','reviewCurrent','identityCurrent','policyCurrent'],
    dispatch: ['permission','reviewCurrent','contextCurrent','policyCurrent','identityCurrent','cellEpochCurrent','auditDurable','effectOutcomeKnown','adapterQualified'],
    project: ['permission','compileInputCurrent'],
    certify: ['permission','inventoryComplete'],
    activate: ['permission','inventoryComplete','operatingEvidence','contextCurrent','policyCurrent','identityCurrent'],
  };
  assert.ok(Object.hasOwn(required, operation), `Unknown contract operation ${operation}`);
  for (const key of required[operation]) assert.equal(typeof input[key], 'boolean', `Missing explicit ${key}`);
  if (['certify','activate'].includes(operation)) assert.equal(typeof input.criticalUnknowns, 'boolean');
  return required[operation].every(key => input[key]) && (!['certify','activate'].includes(operation) || !input.criticalUnknowns);
}

export function validatePacket(packet, contract, task, { draft = false } = {}) {
  for (const key of contract.required_text) assert.ok(typeof packet[key] === 'string' && packet[key].trim(), `${task.id}: missing packet ${key}`);
  assert.equal(packet.taskId, task.id);
  for (const key of contract.required_arrays) assert.ok(Array.isArray(packet[key]), `${task.id}: missing array ${key}`);
  for (const key of contract.nonempty_arrays) assert.ok(packet[key].length, `${task.id}: empty ${key}`);
  if (draft) {
    assert.equal(packet.reviewStatus, 'pending', `${task.id}: draft cannot claim approval`);
    assert.equal(packet.reviewer, null, `${task.id}: draft must not invent a reviewer`);
    assert.ok(packet.author, `${task.id}: missing draft author`);
  } else {
    assert.notEqual(packet.format, 'orgward-work-package-draft-v1', `${task.id}: boundary draft cannot be promoted by relabeling`);
    assert.notEqual(packet.implementationReady, false, `${task.id}: packet declares itself unready`);
    assert.equal(packet.reviewStatus, 'approved', `${task.id}: packet lacks independent review`);
    assert.ok(packet.author && packet.reviewer && packet.author !== packet.reviewer, `${task.id}: packet self-review`);
    assert.ok(!packet.openDecisions?.length, `${task.id}: unresolved packet decisions`);
    assert.ok(!packet.uncoveredOperations?.length, `${task.id}: operation contracts missing`);
    assert.ok(!packet.fixtures.some(f => f.scope === 'domain_oracle_requires_review'), `${task.id}: domain oracles unresolved`);
  }
  if (packet.sourceRequirements) for (const quoted of packet.sourceRequirements) {
    assert.equal(quoted.scenario, task.acceptance.find(ac => ac.id === quoted.id)?.scenario, `${task.id}: altered quoted requirement`);
  }
  // Quoted canonical requirements can forbid a placeholder by name. Validate
  // their fidelity separately; they are not authored implementation decisions.
  const authored = { ...packet, sourceRequirements: undefined };
  for (const placeholder of contract.forbidden_placeholders) assert.ok(!JSON.stringify(authored).toLowerCase().includes(placeholder.toLowerCase()), `${task.id}: unresolved placeholder ${placeholder}`);
  const allowed = new Set(task.acceptance.map(a => a.id));
  assert.equal(new Set(packet.acceptanceIds).size, packet.acceptanceIds.length, `${task.id}: duplicate packet acceptance`);
  for (const id of packet.acceptanceIds) assert.ok(allowed.has(id), `${task.id}: unknown acceptance ${id}`);
  for (const state of contract.required_ui_states) assert.ok(packet.uiStates.some(x => x.state === state && x.behavior?.length > 10), `${task.id}: missing actionable UI state ${state}`);
  for (const kind of contract.fixture_kinds) assert.ok(packet.fixtures.some(x => x.kind === kind), `${task.id}: missing ${kind} fixture`);
  for (const schema of packet.schemas) assert.ok(schema.id && schema.definition && typeof schema.definition === 'object' && Object.keys(schema.definition).length, `${task.id}: missing concrete schema`);
  for (const [entries, fields] of [[packet.operations,contract.operation_fields],[packet.transitions,contract.transition_fields],[packet.fixtures,contract.fixture_fields]]) {
    for (const entry of entries) for (const key of fields) assert.ok(entry[key] !== undefined && entry[key] !== null && entry[key] !== '', `${task.id}: missing packet field ${key}`);
  }
  const covered = new Set();
  for (const f of packet.fixtures) {
    assert.ok(contract.fixture_kinds.includes(f.kind), `${task.id}: unknown fixture kind`);
    assert.match(f.testPath, /^tests\/[a-zA-Z0-9_./-]+\.(test|spec)\.mjs$/);
    assert.ok(!f.testPath.split('/').includes('..'), `${task.id}: escaping fixture path`);
    assert.ok(f.input && typeof f.input === 'object' && f.expectedPersistedResult && typeof f.expectedPersistedResult === 'object', `${task.id}: fixture needs concrete input/result`);
    assert.ok(Array.isArray(f.acceptanceIds) && f.acceptanceIds.length);
    for (const id of f.acceptanceIds) { assert.ok(packet.acceptanceIds.includes(id), `${task.id}: unowned fixture criterion`); covered.add(id); }
  }
  for (const id of packet.acceptanceIds) assert.ok(covered.has(id), `${task.id}: criterion has no fixture`);
  for (const receipt of packet.dependencyReceipts) assert.ok(typeof receipt === 'string' && receipt.startsWith(contract.required_receipt_prefix) && !receipt.split('/').includes('..'));
  return true;
}

export function validateArchitecture(plan, architecture, packetContract, fixtureSet) {
  assert.equal(architecture.revision, 4);
  assert.equal(architecture.final_task, 'T-132');
  assert.equal(architecture.prior_qualifier, 'T-106');
  const tasks = new Map(plan.tasks.map(t => [t.id,t]));
  assert.deepEqual(architecture.prior_task_ids, Array.from({length:108},(_,i)=>`T-${String(i+1).padStart(2,'0')}`));
  assert.deepEqual(architecture.required_saas_task_ids, Array.from({length:24},(_,i)=>`T-${109+i}`));
  assert.deepEqual(architecture.edit_entry_points, ['conversation','form','graph','matrix','bulk','api','connector','migration','workflow_result','accepted_learning']);
  assert.deepEqual(architecture.execution_modes, ['human','internal-agent','internal-deterministic','external-system','physical-attested','unsupported']);
  assert.deepEqual(architecture.migration_phases, ['discovery','mapping','staged','validated','shadow','rehearsed','cutover_pending','cutover','hypercare','complete']);
  for (const [collection,prefix,count] of [[architecture.invariants,'AI',18],[architecture.journeys,'SQ',8]]) {
    assert.deepEqual(collection.map(x=>x.id), Array.from({length:count},(_,i)=>`${prefix}-${String(i+1).padStart(2,'0')}`));
    for (const row of collection) {
      assert.ok(row.title && row.task_ids?.length && Array.isArray(row.evidence));
      assert.ok(['not_run','pass','fail','blocked'].includes(row.status));
      for (const id of row.task_ids) assert.ok(tasks.has(id), `${row.id}: unknown owner ${id}`);
      if (row.status === 'pass') {
        assert.ok(row.evidence.length, `${row.id}: pass without evidence`);
        assert.ok(row.task_ids.every(id=>tasks.get(id).status === 'complete'), `${row.id}: incomplete owner`);
      }
    }
  }
  assert.equal(packetContract.format, 'orgward-work-package-v1');
  const slices = new Set();
  for (const packet of architecture.packages) {
    assert.ok(tasks.has(packet.taskId));
    assert.ok(!slices.has(packet.sliceId), `Duplicate slice ${packet.sliceId}`); slices.add(packet.sliceId);
    validatePacket(packet, packetContract, tasks.get(packet.taskId));
  }
  for (const task of plan.tasks.filter(t=>['in_progress','complete'].includes(t.status))) {
    const packets = architecture.packages.filter(p=>p.taskId === task.id);
    assert.ok(packets.length, `${task.id}: cannot start without implementation packet`);
    for (const id of task.depends_on) {
      assert.equal(tasks.get(id).status,'complete',`${task.id}: unmet implementation dependency ${id}`);
      for (const p of packets) assert.ok(tasks.get(id).receipts.every(r=>p.dependencyReceipts.includes(r)),`${task.id}: missing dependency receipt`);
    }
    if (task.status === 'complete') {
      const mapped = new Set(packets.flatMap(p=>p.acceptanceIds));
      for (const ac of task.acceptance) assert.ok(mapped.has(ac.id),`${task.id}: completed parent has unimplemented acceptance`);
    }
  }
  if (tasks.get('T-132').status === 'complete') assert.ok([...architecture.invariants,...architecture.journeys].every(x=>x.status==='pass'), 'Expanded release lacks architecture/SaaS acceptance');
  assert.equal(fixtureSet.revision,4);
  assert.ok(fixtureSet.cases.length >= 18);
  assert.equal(new Set(fixtureSet.cases.map(x=>x.id)).size,fixtureSet.cases.length);
  for (const c of fixtureSet.cases) assert.equal(contractDecision(c.operation,c.input),c.expected,`${c.id}: contract decision mismatch`);
  return { architecture_invariants:18, saas_qualification_journeys:8, edit_entry_points:10, abstract_protocol_cases:fixtureSet.cases.length, implementation_packets:architecture.packages.length, implementation_readiness:'planned tasks require reviewed packets before starting; specification validation is not implementation' };
}

export function selfTestArchitecture(plan, architecture, contract, fixtureSet) {
  const mutations = [
    ['missing SaaS task', (p,a)=>a.required_saas_task_ids.pop()],
    ['missing edit surface', (p,a)=>a.edit_entry_points.pop()],
    ['missing migration phase', (p,a)=>a.migration_phases.splice(5,1)],
    ['missing architecture invariant', (p,a)=>a.invariants.pop()],
    ['missing SaaS journey', (p,a)=>a.journeys.pop()],
    ['false invariant pass', (p,a)=>a.invariants[0].status='pass'],
    ['task starts without packet', p=>p.tasks[0].status='in_progress'],
    ['stale context allowed', (p,a,c,f)=>f.cases.find(x=>x.id==='CC-06').expected=true],
    ['unknown effect replay allowed', (p,a,c,f)=>f.cases.find(x=>x.id==='CC-10').expected=true],
  ];
  for (const [name, mutate] of mutations) {
    const p=structuredClone(plan),a=structuredClone(architecture),c=structuredClone(contract),f=structuredClone(fixtureSet); mutate(p,a,c,f);
    assert.throws(()=>validateArchitecture(p,a,c,f), undefined, `Missed architecture mutation: ${name}`);
  }
  const t=plan.tasks[0];
  const sample=Object.fromEntries(contract.required_text.map(k=>[k,`Concrete contract for ${k}`]));
  Object.assign(sample,{taskId:t.id,sliceId:'spec-self-test-only',reviewStatus:'approved',author:'fixture-author',reviewer:'fixture-reviewer',acceptanceIds:[t.acceptance[0].id],dependencyReceipts:[],schemas:[{id:'Change',definition:{type:'object',required:['expectedHead']}}],operations:[{name:'PreviewChange',requestExample:{expectedHead:1},successExample:{impactComplete:true},errorExample:{code:'VERSION_CONFLICT'},permission:'designer within assigned workspace'}],events:['ChangeProposed'],transitions:[{from:'draft',command:'PreviewChange',to:'previewed',precondition:'current head and authorized designer',failureRecovery:'retain draft and rebase'}],uiStates:contract.required_ui_states.map(state=>({state,behavior:`Show ${state} with explicit next action and preserved selection`})),fixtures:contract.fixture_kinds.map((kind,i)=>({id:`fixture-${i}`,kind,acceptanceIds:[t.acceptance[0].id],input:{expectedHead:1},expectedPersistedResult:{newHead:1},testPath:'tests/contract/change.test.mjs'})),sourceDecisions:['docs/production/CHANGE-PROTOCOL.md'],nonGoals:['No external effects']});
  validatePacket(sample,contract,t);
  const packetMutations=[
    p=>delete p.transactionBoundary,
    p=>p.uiStates.pop(),
    p=>p.fixtures=p.fixtures.filter(x=>x.kind!=='recovery'),
    p=>p.reviewer=p.author,
    p=>p.acceptanceIds.push('T-999-AC1'),
    p=>p.migrationRecovery='TBD',
    p=>p.operations[0].errorExample='',
    p=>p.schemas[0].definition={},
  ];
  for(const mutate of packetMutations){const p=structuredClone(sample);mutate(p);assert.throws(()=>validatePacket(p,contract,t));}
  return mutations.length+packetMutations.length;
}
