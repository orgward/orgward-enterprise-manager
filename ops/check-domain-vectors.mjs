import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { domainVectors as vectors07 } from '../contracts/enterprise/domain-vectors-07.mjs';
import { domainVectors as vectors08 } from '../contracts/enterprise/domain-vectors-08.mjs';
import { domainVectors as vectors09 } from '../contracts/enterprise/domain-vectors-09.mjs';
import { domainVectors as vectors10 } from '../contracts/enterprise/domain-vectors-10.mjs';
import { domainVectors as vectors11 } from '../contracts/enterprise/domain-vectors-11.mjs';
import { domainVectors as vectors12 } from '../contracts/enterprise/domain-vectors-12.mjs';
import { domainVectors as vectors13 } from '../contracts/enterprise/domain-vectors-13.mjs';
import { ruleProfile, ruleFixtures } from '../contracts/enterprise/sentinel-rule-fixtures-12.mjs';
import { digest } from './build-work-package-drafts.mjs';

const batches=[vectors07,vectors08,vectors09,vectors10,vectors11,vectors12,vectors13];
export const domainVectors=batches.flat();
const registry=JSON.parse(await readFile(new URL('../contracts/enterprise/domain-vectors.index.json',import.meta.url),'utf8'));

export function validateVectorRegistry(index,plan) {
  assert.equal(index.version,1);assert.equal(index.status,'definitions_not_execution');
  assert.equal(index.batches.length,batches.length,'Missing/extra vector batch');
  index.batches.forEach((batch,i)=>{
    const vectors=batches[i];
    assert.equal(batch.id,`domain-vectors-${String(i+7).padStart(2,'0')}`);
    assert.equal(batch.path,`contracts/enterprise/${batch.id}.mjs`);
    assert.equal(batch.count,vectors.length);
    assert.equal(batch.vectorDigest,digest(vectors),'Vector changed: review expected observations and update registry deliberately');
    const sources=vectors.map(v=>{
      const ac=plan.tasks.find(t=>t.id===v.taskId)?.acceptance.find(ac=>ac.id===v.acceptanceId);
      assert.ok(ac,`Missing original scenario ${v.acceptanceId}`);
      return {acceptanceId:v.acceptanceId,scenarioDigest:digest(ac.scenario)};
    });
    assert.deepEqual(batch.sources,sources,'Original scenario changed: vector must be reconsidered, not silently reused');
  });
  return true;
}

function tokens(pointer) {
  assert.match(pointer,/^\/(?:[^~]|~[01])+$/,'Invalid observation JSON pointer');
  const keys=pointer.slice(1).split('/').map(x=>x.replace(/~1/g,'/').replace(/~0/g,'~'));
  assert.ok(keys.every(k=>k&&!['__proto__','prototype','constructor'].includes(k)),'Unsafe/empty observation path');
  return keys;
}
function at(document,pointer) {
  let value=document;
  for(const key of tokens(pointer)) {
    assert.ok(value!==null&&typeof value==='object'&&Object.hasOwn(value,key),`Missing observation ${pointer}`);
    value=value[key];
  }
  return value;
}
export function assertDomainObservation(vector,observation) {
  // Comparator only, not a runner or proof that observations came from a real
  // system. Integration adapters and independently reviewed receipts are required.
  for(const rule of vector.assertions) {
    const value=at(observation,rule.path);
    if(rule.op==='eq')assert.deepEqual(value,rule.value,`${vector.id}: ${rule.path}`);
    else if(rule.op==='lte') {
      assert.ok(typeof value==='number'&&Number.isFinite(value)&&value>=0,`${vector.id}: nonnegative measured quantity required`);
      assert.ok(value<=rule.value,`${vector.id}: ${rule.path} exceeds target`);
    }else throw Error(`Unknown comparison ${rule.op}`);
  }
  return true;
}
function assign(document,pointer,value) {
  const keys=tokens(pointer);let parent=document;
  for(const key of keys.slice(0,-1))parent=parent[key]??=(Object.create(null));
  parent[keys.at(-1)]=structuredClone(value);
}
export function validateVector(vector,plan) {
  const task=plan.tasks.find(t=>t.id===vector.taskId);
  assert.ok(task,`Unknown vector task ${vector.taskId}`);
  assert.ok(task.acceptance.some(ac=>ac.id===vector.acceptanceId),'Unknown vector acceptance');
  assert.equal(vector.id,`DV-${vector.acceptanceId}`);
  assert.equal(vector.status,'not_run','Definition may not claim observed product pass');
  assert.equal(vector.reviewStatus,'pending');assert.equal(vector.reviewer,null);
  assert.ok(vector.name.length>15&&vector.initial&&Object.keys(vector.initial).length>=2,`${vector.id}: missing concrete initial data/profile`);
  assert.ok(vector.steps.length>=2&&vector.steps.every(s=>s.length>30));
  assert.ok(vector.assertions.length>=4);
  assert.equal(new Set(vector.assertions.map(r=>r.path)).size,vector.assertions.length,'Duplicate assertion path');
  for(const rule of vector.assertions) {
    tokens(rule.path);assert.ok(['eq','lte'].includes(rule.op));assert.ok(Object.hasOwn(rule,'value'));
    if(rule.op==='lte')assert.ok(typeof rule.value==='number'&&Number.isFinite(rule.value)&&rule.value>=0);
  }
  assert.equal(vector.testPath,`tests/acceptance/${vector.taskId.toLowerCase()}.test.mjs`);
  return true;
}

export function validateSentinelRuleFixtures(profile,rows) {
  assert.equal(profile.id,'enterprise-sentinel-12');assert.equal(profile.version,1);
  assert.equal(profile.status,'specified_not_qualified');
  assert.equal(profile.scope,'explicit-global-or-typed-scope; unknown-is-not-global');
  assert.equal(profile.exceptionChangesCanonicalSeverity,false);
  assert.equal(profile.propertyExtension,'property-process-v1');
  assert.equal(profile.driftWindowSeconds,3600);assert.equal(profile.driftChangedClaimThreshold,10);
  assert.equal(profile.staleEvidenceSeconds,31536000);assert.equal(profile.heuristicR16Threshold,0.8);
  assert.equal(profile.clock,'2026-10-01T00:00:00Z');
  const severities=['CRITICAL','HIGH','HIGH','HIGH','HIGH','HIGH','WARN','HIGH','CRITICAL','WARN','WARN','HIGH','WARN','WARN','INFO','WARN','HIGH','HIGH','WARN','HIGH','WARN','WARN','WARN','CRITICAL','WARN','HIGH','WARN','HIGH'];
  assert.equal(rows.length,28);
  rows.forEach((row,i)=>{
    assert.equal(row.ruleId,`R-${String(i+1).padStart(2,'0')}`);
    assert.equal(row.severity,severities[i]);
    assert.equal(row.triggerOutcome,i===23?'compile-failure':i===15?'heuristic-finding':'finding');
    assert.equal(row.controlOutcome,'no-target-rule-finding');
    for(const input of [row.trigger,row.control])assert.ok(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length>0);
    assert.notDeepEqual(row.trigger,row.control,'Trigger/control must differ');
    assert.ok(Array.isArray(row.acceptanceIds));
    assert.equal(new Set(row.acceptanceIds).size,row.acceptanceIds.length);
    for(const id of row.acceptanceIds)assert.match(id,/^AT-(?:0[1-9]|[12][0-9]|3[0-3])$/);
  });
  return true;
}

export function checkDomainVectors(plan,{selfTest=false}={}) {
  validateVectorRegistry(registry,plan);
  validateSentinelRuleFixtures(ruleProfile,ruleFixtures);
  let rejectedRuleFixtureMutations=0;
  if(selfTest) {
    const mutations=[(p,r)=>r.pop(),(p,r)=>r[1].ruleId='R-01',(p,r)=>r[8].severity='INFO',(p,r)=>r[23].triggerOutcome='finding',(p,r)=>r[15].triggerOutcome='finding',(p,r)=>r[0].control=r[0].trigger,(p,r)=>r[0].acceptanceIds=['AT-99'],p=>p.exceptionChangesCanonicalSeverity=true,p=>p.scope='missing-is-global',p=>p.staleEvidenceSeconds=0];
    for(const mutate of mutations){const p=structuredClone(ruleProfile),r=structuredClone(ruleFixtures);mutate(p,r);assert.throws(()=>validateSentinelRuleFixtures(p,r));rejectedRuleFixtureMutations++;}
  }
  assert.equal(new Set(domainVectors.map(v=>v.acceptanceId)).size,domainVectors.length);
  let comparatorPositive=0,comparatorNegative=0;
  for(const vector of domainVectors) {
    validateVector(vector,plan);
    if(selfTest) {
      // Synthetic documents exercise the comparator only. They are deliberately
      // constructed from expected values and cannot count as acceptance evidence.
      const synthetic=Object.create(null);
      for(const r of vector.assertions)assign(synthetic,r.path,r.value);
      assertDomainObservation(vector,synthetic);comparatorPositive++;
      for(const rule of vector.assertions) {
        const bad=structuredClone(synthetic);
        const wrong=rule.op==='lte'?rule.value+1:rule.value===null?'not-null':typeof rule.value==='boolean'?!rule.value:typeof rule.value==='number'?rule.value+1:typeof rule.value==='string'?rule.value+'-wrong':null;
        assign(bad,rule.path,wrong);
        assert.throws(()=>assertDomainObservation(vector,bad));comparatorNegative++;
      }
      assert.throws(()=>assertDomainObservation(vector,{}));comparatorNegative++;
    }
  }
  const tasksCovered=new Set(domainVectors.map(v=>v.taskId));
  let rejectedDefinitions=0,rejectedRegistryMutations=0;
  if(selfTest) {
    const mutations=[v=>v.status='pass',v=>v.reviewStatus='approved',v=>v.reviewer='invented',v=>v.acceptanceId='T-999-AC1',v=>v.taskId='T-999',v=>v.initial={},v=>v.steps=['implement it'],v=>v.assertions=[],v=>v.assertions.push(v.assertions[0]),v=>v.assertions[0].path='/__proto__/polluted',v=>v.assertions[0].op='trust-pass-label',v=>delete v.assertions[0].value,v=>v.testPath='tests/../escape.test.mjs'];
    for(const mutate of mutations){const copy=structuredClone(domainVectors[0]);mutate(copy);assert.throws(()=>validateVector(copy,plan));rejectedDefinitions++;}
    const indexMutations=[r=>r.version=99,r=>r.status='verified',r=>r.batches.pop(),r=>r.batches[0].count++,r=>r.batches[0].vectorDigest='changed',r=>r.batches[0].sources.pop(),r=>r.batches[0].sources[0].scenarioDigest='changed',r=>r.batches[0].path='../other.mjs',r=>r.batches.reverse()];
    for(const mutate of indexMutations){const copy=structuredClone(registry);mutate(copy);assert.throws(()=>validateVectorRegistry(copy,plan));rejectedRegistryMutations++;}
    const changedPlan=structuredClone(plan);
    changedPlan.tasks.find(t=>t.id===domainVectors[0].taskId).acceptance[0].scenario+=' Altered obligation.';
    assert.throws(()=>validateVectorRegistry(registry,changedPlan));rejectedRegistryMutations++;
  }
  return {sentinel_rule_fixture_pairs:ruleFixtures.length,sentinel_rule_fixture_cases:ruleFixtures.length*2,rejected_sentinel_rule_fixture_mutations:rejectedRuleFixtureMutations,sentinel_rule_runtime_tests_executed:0,
    concrete_domain_vectors:domainVectors.length,domain_vector_assertions:domainVectors.flatMap(v=>v.assertions).length,
    tasks_with_domain_vectors:tasksCovered.size,tasks_without_domain_vectors:plan.tasks.length-tasksCovered.size,
    acceptance_without_domain_vectors:plan.tasks.flatMap(t=>t.acceptance).length-domainVectors.length,
    comparator_self_test_positive:comparatorPositive,comparator_self_test_negative:comparatorNegative,
    rejected_invalid_vector_definitions:rejectedDefinitions,actual_domain_acceptance_runs:0,
    rejected_vector_registry_or_source_mutations:rejectedRegistryMutations,
    domain_vector_digest:digest(domainVectors)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const plan=JSON.parse(await readFile(path.join(root,'docs/production/IMPLEMENTATION-BACKLOG.json'),'utf8'));
  console.log(JSON.stringify({status:'pass',meaning:'Test definitions and comparator self-tests only, not real application execution',...checkDomainVectors(plan,{selfTest:process.argv.includes('--self-test')})},null,2));
}
