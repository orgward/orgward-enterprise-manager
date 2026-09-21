import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateClosedLoop, expandSchema, semantics, sha, candidateHash } from '../ops/check-closed-loop.mjs';
import { validateExample } from '../ops/check-work-package-drafts.mjs';

const read=async f=>JSON.parse(await readFile(new URL('../'+f,import.meta.url),'utf8'));
const c=await read('contracts/enterprise/closed-loop-obligations-19.json');
const plan=await read('docs/production/IMPLEMENTATION-BACKLOG.json');
const architecture=await read('docs/production/ENTERPRISE-ARCHITECTURE.json');
const source=await read(c.source),change=await read(c.changeRecord);
const schemas=await read(c.schemas),examples=await read('contracts/enterprise/closed-loop-examples-19.json');
const validate=(x=c,p=plan,a=architecture,s=source,r=change)=>validateClosedLoop(x,p,a,s,r);

test('closed-loop proposal maps unchanged source and original acceptance without approving work',()=>{
  assert.equal(validate(),true);assert.equal(change.status,'proposed');assert.equal(change.review,null);
  assert.ok(c.requirements.every(r=>r.status==='not_run'&&r.evidence.length===0));
  assert.equal(architecture.packages.length,0);
});
test('rejects omitted source, orphan owner, unowned acceptance, empty observations and false passes',()=>{
  const mutations=[x=>x.requirements.pop(),x=>x.requirements[0].sourceCriterion='easier replacement',x=>x.requirements[0].taskIds=['T-999'],x=>x.requirements[0].acceptanceIds=['T-99-AC1'],x=>x.requirements[0].scenario.expected={},x=>x.requirements[0].status='pass',x=>x.requirements[0].evidence=['ops/checks/../../outside'],x=>x.supportingScenarios.pop(),x=>x.requirements[0].taskEvidence={'T-999':['ops/checks/fake.md']},x=>x.supportingScenarios[0].status='pass'];
  for(const mutate of mutations){const next=structuredClone(c);mutate(next);assert.throws(()=>validate(next));}
});
test('slice dependency cycles and unknown dependencies fail',()=>{
  for(const dep of ['CL-018','CL-999']){const next=structuredClone(c);next.slices[0].dependsOn=[dep];assert.throws(()=>validate(next));}
});
test('disconnected plan or architecture and altered original intent fail',()=>{
  const p=structuredClone(plan);delete p.closed_loop_obligations;assert.throws(()=>validate(c,p));
  const a=structuredClone(architecture);delete a.closed_loop_obligations;assert.throws(()=>validate(c,plan,a));
  const p2=structuredClone(plan);p2.tasks[0].acceptance[0].scenario='Weakened acceptance';assert.throws(()=>validate(c,p2));
});
test('readiness cannot bypass proposed change review; unrelated task remains independent',()=>{
  const p=structuredClone(plan);p.tasks.find(t=>t.id==='T-01').status='in_progress';assert.throws(()=>validate(c,p));
  const unrelated=structuredClone(plan);unrelated.tasks.find(t=>t.id==='T-02').status='in_progress';
  // Only tests this overlay. Existing architecture checker still requires its approved packet.
  assert.equal(validate(c,unrelated),true);
  assert.equal(sha(JSON.stringify(semantics(plan))),sha(JSON.stringify(semantics(unrelated))));
});
test('adopted specification cannot be asserted without authentic review workflow',()=>{
  const next=structuredClone(c);next.status='approved_specification';assert.throws(()=>validate(next));
  const record=structuredClone(change);record.status='approved';assert.throws(()=>validate(c,plan,architecture,source,record));
});
test('final qualifier cannot complete with unrun closed-loop obligations',()=>{
  const p=structuredClone(plan);p.tasks.find(t=>t.id==='T-132').status='complete';assert.throws(()=>validate(c,p));
});
test('restricted schema examples reject malformed results, authority booleans and missing versions',()=>{
  for(const e of examples.valid)assert.equal(validateExample(expandSchema(schemas.$defs[e.schema],schemas.$defs),e.input),true);
  for(const e of examples.invalid){const base=examples.valid[e.base],input={...structuredClone(base.input),...e.patch};if(e.remove)delete input[e.remove];assert.throws(()=>validateExample(expandSchema(schemas.$defs[base.schema],schemas.$defs),input),undefined,e.reason);}
});
test('schema references fail closed on unresolved or recursive definitions',()=>{
  assert.throws(()=>expandSchema({$ref:'#/$defs/Absent'},schemas.$defs));
  assert.throws(()=>expandSchema({$ref:'#/$defs/Loop'},{Loop:{$ref:'#/$defs/Loop'}}));
});

test('candidate binding excludes progress but includes changed task meaning',()=>{
  const file='docs/production/IMPLEMENTATION-BACKLOG.json',p=structuredClone(plan);
  p.tasks[1].status='in_progress';p.tasks[1].receipts=['ops/checks/synthetic-not-saved.md'];
  assert.equal(candidateHash(file,JSON.stringify(plan)),candidateHash(file,JSON.stringify(p)));
  p.tasks[1].acceptance[0].scenario='weaker requirement';
  assert.notEqual(candidateHash(file,JSON.stringify(plan)),candidateHash(file,JSON.stringify(p)));
});
test('adding a packet does not stale architectural meaning; changing an invariant does',()=>{
  const file='docs/production/ENTERPRISE-ARCHITECTURE.json',a=structuredClone(architecture);
  a.packages.push({taskId:'T-02',meaning:'synthetic test only; architecture checker must independently validate it'});
  assert.equal(candidateHash(file,JSON.stringify(architecture)),candidateHash(file,JSON.stringify(a)));
  a.invariants[0].title='weaker invariant';
  assert.notEqual(candidateHash(file,JSON.stringify(architecture)),candidateHash(file,JSON.stringify(a)));
});
