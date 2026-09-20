import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDrafts, digest } from './build-work-package-drafts.mjs';
import { validatePacket } from './check-enterprise-architecture.mjs';

// Deliberately restricted JSON Schema subset. Unknown keywords fail closed;
// this is fixture validation, not the eventual production request validator.
export function validateExample(schema, value, location = '$') {
  const allowed = new Set(['type','properties','required','additionalProperties','items','minItems','uniqueItems','minimum','minLength','enum','const','pattern']);
  for (const key of Object.keys(schema)) assert.ok(allowed.has(key), `${location}: unsupported schema keyword ${key}`);
  if (Object.hasOwn(schema,'const')) assert.deepEqual(value, schema.const, `${location}: const`);
  if (schema.enum) assert.ok(schema.enum.some(x=>JSON.stringify(x)===JSON.stringify(value)), `${location}: enum`);
  const matches = type => type === 'null' ? value === null : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isSafeInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
  if (schema.type) assert.ok((Array.isArray(schema.type) ? schema.type : [schema.type]).some(matches), `${location}: type`);
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) assert.ok(Object.hasOwn(value,key), `${location}: missing ${key}`);
    for (const [key,child] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties || {},key)) assert.notEqual(schema.additionalProperties,false,`${location}: extra ${key}`);
      else validateExample(schema.properties[key],child,`${location}.${key}`);
    }
  }
  if (Array.isArray(value)) {
    assert.ok(value.length >= (schema.minItems || 0),`${location}: minItems`);
    if (schema.uniqueItems) assert.equal(new Set(value.map(x=>JSON.stringify(x))).size,value.length,`${location}: uniqueItems`);
    if (schema.items) value.forEach((x,i)=>validateExample(schema.items,x,`${location}[${i}]`));
  }
  if (typeof value === 'number' && schema.minimum !== undefined) assert.ok(value>=schema.minimum,`${location}: minimum`);
  if (typeof value === 'string') {
    assert.ok(value.length >= (schema.minLength || 0),`${location}: minLength`);
    if (schema.pattern) assert.match(value,new RegExp(schema.pattern),`${location}: pattern`);
  }
  return true;
}

export function validateDraft(packet, contract, task) {
  validatePacket(packet,contract,task,{draft:true});
  assert.equal(packet.format,'orgward-work-package-draft-v1');
  assert.equal(packet.implementationReady,false,'Draft claims implementation readiness');
  assert.equal(packet.sourceTaskHash,digest(task),'Draft is stale against canonical task');
  assert.deepEqual(packet.sourceRequirements,task.acceptance.map(ac=>({id:ac.id,scenario:ac.scenario,sourceKind:ac.kind || 'unspecified'})),'Acceptance text drift');
  assert.deepEqual(packet.acceptanceIds,task.acceptance.map(a=>a.id),'Missing original acceptance');
  assert.deepEqual(packet.dependencies,task.depends_on,'Dependency drift');
  assert.deepEqual(packet.dependencyReceipts,[],'Unverified dependency proof in generated draft');
  assert.equal(packet.evidence.status,'not_run');
  assert.deepEqual(packet.evidence.receipts,[]);
  const schemas = new Map(packet.schemas.map(s=>[s.id,s.definition]));
  assert.equal(schemas.size,packet.schemas.length,'Duplicate schema IDs');
  for (const op of packet.operations) {
    for (const [schemaKey,exampleKey] of [['requestSchema','requestExample'],['resultSchema','successExample'],['errorSchema','errorExample']]) {
      assert.ok(schemas.has(op[schemaKey]),`Unknown ${schemaKey}`);
      validateExample(schemas.get(op[schemaKey]),op[exampleKey]);
    }
    assert.equal(op.requestExample.payload ? schemas.get(op.requestSchema).properties.payload.additionalProperties : null,false,'Open-ended payload');
  }
  const expectedOps = task.implementation_contract?.operations || packet.operations.map(op=>op.name);
  assert.deepEqual(packet.requiredOperations,expectedOps,'Required operation omitted');
  const uncovered = expectedOps.filter(name=>!packet.operations.some(op=>op.name===name));
  assert.deepEqual(packet.uncoveredOperations,uncovered,'Operation coverage overclaimed');
  assert.ok(packet.openDecisions.some(x=>x.blocks==='implementation_start'),'Draft has no review blocker');
  for (const name of uncovered) assert.ok(packet.openDecisions.some(x=>x.decision.includes(name)),`Missing gap ${name}`);
  assert.deepEqual(packet.requiredEvents,task.implementation_contract?.events || [],'Canonical event obligation dropped');
  assert.equal(new Set(packet.fixtures.map(f=>f.id)).size,packet.fixtures.length,'Duplicate fixtures');
  for (const fixture of packet.fixtures) {
    assert.equal(fixture.status,'not_run','Invented executed fixture');
    assert.ok(['shared_boundary_only','domain_oracle_requires_review'].includes(fixture.scope),'Unqualified fixture claim');
  }
  for (const ac of task.acceptance) {
    const f=packet.fixtures.find(f=>f.id===`${ac.id}-DOMAIN`);
    assert.ok(f,`Missing domain obligation ${ac.id}`);
    assert.equal(f.input.sourceScenarioHash,digest(ac.scenario),'Stale domain scenario');
    assert.equal(f.expectedPersistedResult.cannotSubstituteBoundaryFixture,true,'Domain requirement weakened');
  }
  assert.deepEqual(packet.ui.screens,task.screens,'Missing UI surface');
  const fields=Object.keys(packet.schemas[0].definition.properties.payload.properties);
  assert.deepEqual(packet.ui.controls.map(c=>c.field),fields,'Unmapped form field');
  for (const file of packet.targetFiles) {
    assert.match(file,/^(contracts|src|tests|public|migrations)\/[a-zA-Z0-9_./-]+$/);
    assert.ok(!file.split('/').includes('..'),'Escaping target path');
  }
  const slices=new Set();
  for (const slice of packet.slices) {
    for(const dep of slice.dependsOn) assert.ok(slices.has(dep)||task.depends_on.includes(dep),'Invalid slice order');
    assert.deepEqual(slice.covers,packet.acceptanceIds,'Slice loses parent acceptance');
    assert.ok(!slices.has(slice.id)); slices.add(slice.id);
  }
  return true;
}

export function selfTestDrafts(packet, contract, task) {
  const mutations = [
    p=>p.reviewStatus='approved', p=>p.reviewer='imaginary-reviewer', p=>p.implementationReady=true,
    p=>p.sourceTaskHash='bad', p=>p.sourceRequirements[0].scenario='Changed requirement',
    p=>p.acceptanceIds.pop(), p=>p.dependencies.push('T-999'), p=>p.dependencyReceipts.push('ops/checks/invented.md'),
    p=>p.evidence.status='pass', p=>p.evidence.receipts.push('ops/checks/invented.md'),
    p=>p.schemas.push(p.schemas[0]), p=>p.operations[0].requestExample.payload.extra='authority',
    p=>p.operations[0].requestExample.payload=17, p=>delete p.operations[0].requestExample.payload[Object.keys(p.operations[0].requestExample.payload)[0]],
    p=>p.operations[0].requestSchema='unknown', p=>p.operations[0].successExample.version=-1,
    p=>p.operations[0].errorExample.retryable='true', p=>p.requiredOperations.push('InventedOperation'),
    p=>p.openDecisions=[], p=>p.requiredEvents.push('Unregistered'),
    p=>p.fixtures[0].status='pass', p=>p.fixtures.push(p.fixtures[0]),
    p=>p.fixtures=p.fixtures.filter(f=>f.scope!=='domain_oracle_requires_review'),
    p=>p.fixtures.find(f=>f.scope==='domain_oracle_requires_review').input.sourceScenarioHash='bad',
    p=>p.fixtures.find(f=>f.scope==='domain_oracle_requires_review').expectedPersistedResult.cannotSubstituteBoundaryFixture=false,
    p=>p.ui.screens=[], p=>p.ui.controls.pop(), p=>p.targetFiles.push('src/../escape.mjs'),
    p=>p.slices[0].dependsOn.push('unknown'), p=>p.slices[0].covers.pop(),
    p=>p.schemas[0].definition.unimplementedKeyword=true,
  ];
  for(const [i,mutate] of mutations.entries()) { const copy=structuredClone(packet); mutate(copy); assert.throws(()=>validateDraft(copy,contract,task),undefined,`Missed draft mutation ${i+1}`); }
  assert.throws(()=>validatePacket(packet,contract,task),undefined,'Pending draft accepted as approved packet');
  const relabeled=structuredClone(packet);
  Object.assign(relabeled,{reviewStatus:'approved',reviewer:'invented-reviewer',openDecisions:[]});
  assert.throws(()=>validatePacket(relabeled,contract,task),undefined,'Relabeled boundary draft accepted as reviewed implementation packet');
  assert.throws(()=>validateExample({type:'string',enum:['accepted']},'enabled'));
  assert.throws(()=>validateExample({type:'string',pattern:'^sha256:[a-f0-9]{64}$'},'sha256:not-a-hash'));
  assert.throws(()=>validateExample({type:'array',minItems:1,uniqueItems:true,items:{type:'string'}},['x','x']));
  assert.throws(()=>validateExample({type:'number'},Infinity));
  return mutations.length+6;
}

export async function checkDraftRegistry(root, plan, contract, { selfTest = false } = {}) {
  const index=JSON.parse(await readFile(path.join(root,'contracts/enterprise/packet-drafts.index.json'),'utf8'));
  assert.equal(index.format,'orgward-packet-drafts-index-v1');
  assert.equal(index.meaning,'Boundary drafts only; not approved, implementation-ready, or product evidence.');
  assert.deepEqual(index.packets.map(p=>p.taskId),plan.tasks.map(t=>t.id),'Incomplete draft register');
  const generated=await buildDrafts();
  const drafts=[];
  for (const [i,entry] of index.packets.entries()) {
    assert.equal(entry.path,`contracts/enterprise/wp-${entry.taskId}.json`);
    const packet=JSON.parse(await readFile(path.join(root,entry.path),'utf8'));
    assert.equal(entry.sha256,digest(packet),'Materialized draft hash mismatch');
    assert.deepEqual(packet,generated[i],'Draft differs from authored materializer; amend seeds/builder before rematerialization');
    validateDraft(packet,contract,plan.tasks[i]); drafts.push(packet);
  }
  return { packet_boundary_drafts: drafts.length, draft_acceptance_links: drafts.flatMap(d=>d.acceptanceIds).length,
    draft_schemas: drafts.flatMap(d=>d.schemas).length, draft_fixture_obligations: drafts.flatMap(d=>d.fixtures).length,
    draft_open_decisions: drafts.flatMap(d=>d.openDecisions).length,
    operations_needing_additional_slices: drafts.flatMap(d=>d.uncoveredOperations).length,
    approved_packets_added: 0, product_acceptance_executed_by_draft_check: 0,
    ...(selfTest ? { rejected_invalid_drafts_or_examples: selfTestDrafts(drafts[0],contract,plan.tasks[0]) } : {}) };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const read=async f=>JSON.parse(await readFile(path.join(root,f),'utf8'));
  console.log(JSON.stringify({status:'pass',...await checkDraftRegistry(root,await read('docs/production/IMPLEMENTATION-BACKLOG.json'),await read('contracts/enterprise/work-package.contract.json'),{selfTest:process.argv.includes('--self-test')})},null,2));
}
