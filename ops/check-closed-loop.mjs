import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateExample } from './check-work-package-drafts.mjs';
import { validateChangeRecord } from './check-engineering-workflow.mjs';

export const contractPath='contracts/enterprise/closed-loop-obligations-19.json';
export const sha=text=>createHash('sha256').update(text).digest('hex');
export const semantics=plan=>plan.tasks.map(t=>({id:t.id,title:t.title,user_story:t.user_story,depends_on:t.depends_on,acceptance:t.acceptance.map(a=>({id:a.id,scenario:a.scenario}))}));
// Progress and newly reviewed packets must not stale an otherwise unchanged
// proposal. Their validity is checked separately by the start/acceptance guards.
export function candidateHash(file,bytes) {
  if(file==='docs/production/IMPLEMENTATION-BACKLOG.json') {
    const p=JSON.parse(bytes);
    return sha(JSON.stringify({...p,tasks:p.tasks.map(({status,receipts,acceptance,...t})=>({...t,acceptance:acceptance.map(({status,evidence,...ac})=>ac)}))}));
  }
  if(file==='docs/production/ENTERPRISE-ARCHITECTURE.json') {
    const {packages,...a}=JSON.parse(bytes);
    for(const key of ['invariants','journeys'])a[key]=a[key].map(({status,evidence,...r})=>r);
    return sha(JSON.stringify(a));
  }
  return sha(bytes);
}
const nonempty=x=>assert.ok(typeof x==='string'&&x.trim().length>0,'Missing concrete text');
const unique=xs=>{assert.ok(Array.isArray(xs));assert.equal(new Set(xs).size,xs.length,'Duplicate identity');};
const receipt=x=>{assert.match(x,/^ops\/checks\/[a-zA-Z0-9._/-]+$/);assert.ok(!x.split('/').includes('..'),'Escaping receipt');};
function result(row) {
  assert.ok(['not_run','pass','fail','blocked'].includes(row.status));
  unique(row.evidence);row.evidence.forEach(receipt);
  if(row.status==='pass')assert.ok(row.evidence.length,'Pass without actual evidence');
}

// Specification linkage and anti-false-readiness checks, not runtime policy.
export function validateClosedLoop(c,plan,architecture,source,change) {
  assert.equal(c.format,'orgward-closed-loop-obligations-v1');
  assert.ok(['proposed_pending_independent_review','approved_specification'].includes(c.status));
  assert.equal(plan.closed_loop_obligations,contractPath);
  assert.equal(architecture.closed_loop_obligations,contractPath);
  assert.ok(plan.source_contracts.includes(contractPath));
  assert.equal(c.sourceBodyDigest,sha(source.body),'Issue source changed without reconciliation');
  assert.equal(c.originalSemanticsDigest,sha(JSON.stringify(semantics(plan))),'Original task semantics changed; reconcile lineage, do not silently rehash');
  const criteria=source.body.split('\n').filter(x=>x.startsWith('- [ ] ')).map(x=>x.slice(6));
  assert.equal(criteria.length,24);
  assert.deepEqual(c.requirements.map(r=>r.sourceCriterion),criteria,'Missing/rewritten issue criterion');
  assert.deepEqual(c.requirements.map(r=>r.id),Array.from({length:24},(_,i)=>`CL-R${String(i+1).padStart(2,'0')}`));
  assert.deepEqual(c.slices.map(s=>s.id),Array.from({length:18},(_,i)=>`CL-${String(i+1).padStart(3,'0')}`));
  const tasks=new Map(plan.tasks.map(t=>[t.id,t])), slices=new Map(c.slices.map(s=>[s.id,s]));
  validateChangeRecord(change,plan);
  assert.equal(change.id,'CR-019');
  if(c.status==='approved_specification')assert.ok(['approved','applied'].includes(change.status),'Unreviewed adopted specification');
  for(const s of c.slices) {
    nonempty(s.title);nonempty(s.deliverable);nonempty(s.targetPath);nonempty(s.boundedContribution);
    unique(s.taskIds);assert.ok(s.taskIds.length);s.taskIds.forEach(id=>assert.ok(tasks.has(id)));
    unique(s.dependsOn);s.dependsOn.forEach(id=>assert.ok(slices.has(id),'Unknown slice dependency'));
  }
  const visiting=new Set(),visited=new Set();
  function visit(id) {assert.ok(!visiting.has(id),'Slice dependency cycle');if(visited.has(id))return;visiting.add(id);slices.get(id).dependsOn.forEach(visit);visiting.delete(id);visited.add(id);}
  c.slices.forEach(s=>visit(s.id));
  for(const r of c.requirements) {
    nonempty(r.title);nonempty(r.existingCoverage);result(r);
    unique(r.taskIds);assert.ok(r.taskIds.length);r.taskIds.forEach(id=>assert.ok(tasks.has(id),'Unknown task owner'));
    unique(r.acceptanceIds);assert.ok(r.acceptanceIds.length);
    const allowed=new Set(r.taskIds.flatMap(id=>tasks.get(id).acceptance.map(a=>a.id)));
    r.acceptanceIds.forEach(id=>assert.ok(allowed.has(id),'Unowned original criterion'));
    unique(r.sliceIds);assert.ok(r.sliceIds.length);r.sliceIds.forEach(id=>assert.ok(slices.has(id)));
    const s=r.scenario;assert.equal(s.id,r.id.replace('-R','-S'));
    assert.ok(s.seed?.tenant&&s.seed?.workspace&&Object.keys(s.seed).length>2);
    assert.ok(s.action?.length>30&&s.counterexample?.length>30);
    assert.ok(s.expected&&Object.keys(s.expected).length>=3,'Empty expected observations');
    assert.ok(s.observationSources.length>=3);
    assert.match(s.testPath,/^tests\/acceptance\/closed-loop\/cl-\d{2}\.test\.mjs$/);
    assert.ok(r.taskEvidence&&typeof r.taskEvidence==='object');
    for(const [id,refs]of Object.entries(r.taskEvidence)){assert.ok(r.taskIds.includes(id));assert.ok(refs.length);unique(refs);refs.forEach(receipt);}
    for(const id of r.taskIds) {
      if(['in_progress','complete'].includes(tasks.get(id).status)) {
        assert.ok(['approved','applied'].includes(change.status),'Affected task starts before change review');
        assert.equal(c.status,'approved_specification');
        const packets=architecture.packages.filter(p=>p.taskId===id&&p.closedLoopRequirementIds?.includes(r.id));
        assert.ok(packets.length,`${id}: missing ${r.id} packet linkage`);
        for(const p of packets) {
          assert.equal(p.closedLoopCandidateDigest,change.after.candidateDigest,'Stale CL packet');
          const contribution=p.closedLoopContributions?.find(x=>x.requirementId===r.id);
          assert.ok(contribution,'Missing bounded contribution');nonempty(contribution.scope);nonempty(contribution.testPath);
        }
      }
      if(tasks.get(id).status==='complete')assert.ok(r.taskEvidence[id]?.length,'Missing task contribution receipt');
    }
  }
  assert.deepEqual(c.supportingScenarios.map(s=>s.id),['CL-X01','CL-X02','CL-X03','CL-X04']);
  for(const s of c.supportingScenarios) {
    result(s);assert.ok(s.seed&&Object.keys(s.seed).length);assert.ok(Object.keys(s.expected).length>=3);nonempty(s.action);nonempty(s.counterexample);
    assert.match(s.testPath,/^tests\/acceptance\/closed-loop\/cl-x\d{2}\.test\.mjs$/);
    unique(s.requirementIds);assert.ok(s.requirementIds.length);s.requirementIds.forEach(id=>assert.ok(c.requirements.some(r=>r.id===id)));
    unique(s.sliceIds);assert.ok(s.sliceIds.length);s.sliceIds.forEach(id=>assert.ok(slices.has(id)));
  }
  const mapped=new Set([...c.requirements,...c.supportingScenarios].flatMap(r=>r.sliceIds));
  c.slices.forEach(s=>assert.ok(mapped.has(s.id),'Slice without acceptance coverage'));
  if(tasks.get('T-132').status==='complete')assert.ok([...c.requirements,...c.supportingScenarios].every(r=>r.status==='pass'),'Final qualification missing closed-loop acceptance');
  return true;
}

export function expandSchema(schema,defs,seen=[]) {
  if(schema.$ref) {
    assert.deepEqual(Object.keys(schema),['$ref']);assert.match(schema.$ref,/^#\/\$defs\/[A-Za-z]+$/);
    const name=schema.$ref.split('/').at(-1);assert.ok(defs[name],'Unresolved schema ref');assert.ok(!seen.includes(name),'Recursive fixture schema');
    return expandSchema(defs[name],defs,[...seen,name]);
  }
  const next=structuredClone(schema);
  if(next.properties)for(const [key,value]of Object.entries(next.properties))next.properties[key]=expandSchema(value,defs,seen);
  if(next.items)next.items=expandSchema(next.items,defs,seen);
  return next;
}

export async function checkClosedLoop(root,plan,architecture) {
  const read=async f=>JSON.parse(await readFile(path.join(root,f),'utf8'));
  const c=await read(contractPath),source=await read(c.source),change=await read(c.changeRecord);
  validateClosedLoop(c,plan,architecture,source,change);
  const manifest=await read(c.proposalManifest);
  assert.equal(change.after.candidateDigest,sha(JSON.stringify(manifest.files)),'Candidate manifest/CR drift');
  unique(manifest.files.map(f=>f.path));
  for(const needed of [contractPath,c.source,c.decision,c.ux,c.schemas,'docs/production/IMPLEMENTATION-BACKLOG.json','docs/production/ENTERPRISE-ARCHITECTURE.json','ops/check-closed-loop.mjs'])assert.ok(manifest.files.some(f=>f.path===needed),'Incomplete candidate manifest');
  const rootReal=await realpath(root);
  for(const f of manifest.files) {
    assert.ok(!path.isAbsolute(f.path)&&!f.path.split('/').includes('..'));
    const resolved=await realpath(path.join(root,f.path));assert.ok(resolved.startsWith(rootReal+path.sep));
    assert.equal(candidateHash(f.path,await readFile(resolved)),f.sha256,`Candidate changed: ${f.path}; update proposal and invalidate review`);
  }
  const schemas=await read(c.schemas),examples=await read('contracts/enterprise/closed-loop-examples-19.json');
  assert.equal(Object.keys(schemas.$defs).length,17);
  for(const value of Object.values(schemas.$defs))expandSchema(value,schemas.$defs);
  for(const e of examples.valid)validateExample(expandSchema(schemas.$defs[e.schema],schemas.$defs),e.input);
  for(const e of examples.invalid) {
    const sourceExample=examples.valid[e.base],input={...structuredClone(sourceExample.input),...e.patch};
    if(e.remove)delete input[e.remove];
    assert.throws(()=>validateExample(expandSchema(schemas.$defs[sourceExample.schema],schemas.$defs),input),undefined,e.reason);
  }
  for(const r of [...c.requirements,...c.supportingScenarios]) {
    for(const ref of [...r.evidence,...Object.values(r.taskEvidence??{}).flat()])await readFile(path.join(root,ref));
    if(r.status==='pass')await readFile(path.join(root,r.scenario?.testPath??r.testPath));
  }
  return {closed_loop_source_requirements:24,closed_loop_delivery_slices:18,closed_loop_supplementary_cases:4,closed_loop_schema_definitions:17,closed_loop_valid_schema_examples:examples.valid.length,closed_loop_rejected_schema_examples:examples.invalid.length,closed_loop_product_acceptance_passed:c.requirements.filter(r=>r.status==='pass').length,closed_loop_change_status:change.status,closed_loop_runtime_tests_executed:0};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const read=async f=>JSON.parse(await readFile(path.join(root,f),'utf8'));
  console.log(JSON.stringify(await checkClosedLoop(root,await read('docs/production/IMPLEMENTATION-BACKLOG.json'),await read('docs/production/ENTERPRISE-ARCHITECTURE.json')),null,2));
}
