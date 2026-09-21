import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { selectProfile } from './engineering-task.mjs';

const impactKinds=['ux','model','apiEvents','security','workflow','migration','evidence','operations','dependencies','qualification'];
const nonempty=(s,label)=>assert.ok(typeof s==='string'&&s.trim().length>0,`Missing ${label}`);
const digest=s=>createHash('sha256').update(s).digest('hex');
export function validateChangeRecord(record,plan) {
  assert.equal(record.template,false,'Templates cannot be registered change records');
  assert.match(record.id,/^CR-[a-zA-Z0-9][a-zA-Z0-9-]*$/);assert.notEqual(record.id,'CR-REPLACE');
  assert.ok(['proposed','reviewed','approved','applied','rejected','deferred'].includes(record.status));
  assert.ok(['correction','refinement','architecture','goal_change'].includes(record.kind));
  for(const key of ['author','reason','resumeCondition'])nonempty(record[key],key);
  for(const key of ['evidence','taskIds','acceptanceIds','alternatives','preservedObligations','invalidationPlan','validationCommands']) {
    assert.ok(Array.isArray(record[key])&&record[key].length,`Missing ${key}`);
    for(const value of record[key])nonempty(value,key);
    assert.equal(new Set(record[key]).size,record[key].length,`Duplicate ${key}`);
  }
  const tasks=new Map(plan.tasks.map(t=>[t.id,t]));
  for(const id of record.taskIds)assert.ok(tasks.has(id),`Unknown task ${id}`);
  const acs=new Set(record.taskIds.flatMap(id=>tasks.get(id).acceptance.map(ac=>ac.id)));
  for(const id of record.acceptanceIds)assert.ok(acs.has(id),`Unmapped acceptance ${id}`);
  for(const id of record.acceptanceIds)assert.ok(record.preservedObligations.includes(id),'Original obligation lost');
  nonempty(record.before?.revision,'before revision');nonempty(record.before?.exactText,'old semantics');
  assert.equal(record.before.digest,digest(record.before.exactText),'Old semantics digest mismatch');
  nonempty(record.after?.proposal,'proposed semantics');assert.match(record.after.candidateDigest,/^[a-f0-9]{64}$/);
  for(const key of impactKinds)nonempty(record.impact?.[key],`impact ${key} or justified not-applicable`);
  assert.ok(Array.isArray(record.successorMappings));
  for(const mapping of record.successorMappings) {
    assert.ok(record.acceptanceIds.includes(mapping.from),'Unknown original successor source');
    nonempty(mapping.to,'successor identity');nonempty(mapping.reason,'successor reason');
  }
  for(const key of ['appliedArtifacts','validationReceipts'])assert.ok(Array.isArray(record[key]));
  if(['reviewed','approved','applied'].includes(record.status)) {
    const review=record.review;assert.ok(review,'Missing real review record');
    nonempty(review.reviewer,'reviewer');assert.notEqual(review.reviewer,record.author,'Author cannot independently approve');
    nonempty(review.independenceEvidence,'review independence');nonempty(review.receipt,'review receipt');
    assert.match(review.candidateRevision,/^[a-f0-9]{40}$/,'Review must bind exact candidate Git revision');
    assert.equal(review.candidateDigest,record.after.candidateDigest,'Stale review');
    assert.ok(['approved','changes_requested'].includes(review.decision));
    if(['approved','applied'].includes(record.status))assert.equal(review.decision,'approved');
  }
  if(record.kind==='goal_change'&&['approved','applied'].includes(record.status)) {
    const owner=record.ownerDecision;assert.ok(owner,'Goal/safety change needs explicit owner decision');
    for(const key of ['principal','authority','receipt'])nonempty(owner[key],key);
    assert.equal(owner.decision,'approved');assert.equal(owner.candidateDigest,record.after.candidateDigest,'Stale owner decision');
  }
  if(record.status==='applied') {
    assert.ok(record.appliedArtifacts.length&&record.validationReceipts.length,'Applied change lacks artifacts/validation');
    for(const f of [...record.appliedArtifacts,...record.validationReceipts])nonempty(f,'applied reference');
  }
  return true;
}

export async function checkEngineeringWorkflow(root) {
  const read=async f=>JSON.parse(await readFile(path.join(root,f),'utf8'));
  const safeFile=async file=>{
    nonempty(file,'file path');assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..'),'Unsafe repository reference');
    const actual=await realpath(path.join(root,file));assert.ok(actual.startsWith(await realpath(root)+path.sep),'Reference escapes repository');
    await readFile(actual);return actual;
  };
  const workflow=await read('contracts/engineering/workflow.json');assert.equal(workflow.version,1);
  assert.equal(workflow.automaticDelegation,false);assert.equal(workflow.automaticBillingFallback,false);
  assert.equal(workflow.leafRequiresFrozenContract,true);
  assert.deepEqual(Object.keys(workflow.roles).sort(),['design','implement','leaf','orchestrate','review']);
  assert.deepEqual(workflow.highRiskProfile,{model:'gpt-5.6-sol',reasoning:'xhigh'});
  for(const file of [workflow.guide,workflow.changeControl,workflow.parentPolicy,workflow.changeRegister,...workflow.templates])await safeFile(file);
  const plan=await read('docs/production/IMPLEMENTATION-BACKLOG.json'),policy=await read(workflow.parentPolicy);
  assert.deepEqual(policy.tasks.map(t=>t.taskId).sort(),plan.tasks.map(t=>t.id).sort(),'Task/model coverage mismatch');
  const skills=new Set();
  for(const [role,route] of Object.entries(workflow.roles)) {
    assert.match(route.skill,/^orgward-[a-z-]+$/);await safeFile(route.prompt);
    const file=`.agents/skills/${route.skill}/SKILL.md`;await safeFile(file);skills.add(file);
    const skill=await readFile(path.join(root,file),'utf8');
    assert.ok(skill.startsWith('---\n'));assert.ok(skill.includes(`\nname: ${route.skill}\n`));
    assert.match(skill,/\ndescription: .+\n/);
    for(const task of plan.tasks) {
      const result=selectProfile(policy,workflow,task.id,{role,frozenContract:role==='leaf'});
      assert.equal(result.launchesModel,false);assert.equal(result.implementationAuthorized,false);
      assert.ok(['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna'].includes(result.model));
      assert.ok(['medium','high','xhigh'].includes(result.reasoning));
    }
  }
  const template=await read('docs/engineering/templates/change-proposal.json');
  assert.equal(template.template,true);assert.equal(template.status,'proposed');assert.equal(template.review,null);assert.equal(template.ownerDecision,null);
  const brief=await read('docs/engineering/templates/task-brief.json');assert.equal(brief.template,true);assert.equal(brief.reviewReceipt,null);assert.equal(brief.delegationAuthority,null);
  const register=await read(workflow.changeRegister);assert.equal(register.version,1);assert.ok(Array.isArray(register.changes));
  assert.equal(new Set(register.changes).size,register.changes.length);
  const ids=new Set();
  for(const file of register.changes) {
    assert.match(file,/^docs\/engineering\/changes\/CR-[a-zA-Z0-9-]+\.json$/);await safeFile(file);
    const record=await read(file);validateChangeRecord(record,plan);assert.ok(!ids.has(record.id),'Duplicate change ID');ids.add(record.id);
    assert.equal(path.basename(file),`${record.id}.json`,'Change file/ID mismatch');
    for(const ref of [...record.evidence,...record.appliedArtifacts,...record.validationReceipts,...(record.review?[record.review.receipt]:[]),...(record.ownerDecision?[record.ownerDecision.receipt]:[])])await safeFile(ref);
  }
  const onDisk=await readdir(path.join(root,'docs/engineering/changes')).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  for(const file of onDisk.filter(f=>f.endsWith('.json')))assert.ok(register.changes.includes(`docs/engineering/changes/${file}`),'Unregistered change record');
  return {status:'pass',meaning:'Engineering artifact structure/routing only; no reviewer authenticity, scheduler execution or product acceptance',skills:skills.size,prompts:new Set(Object.values(workflow.roles).map(r=>r.prompt)).size,templates:workflow.templates.length,parentTaskRecommendations:policy.tasks.length,routingCombinations:plan.tasks.length*Object.keys(workflow.roles).length,registeredChanges:register.changes.length};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  console.log(JSON.stringify(await checkEngineeringWorkflow(root),null,2));
}
