import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function selectProfile(policy, workflow, taskId, {role='implement',risk='normal',frozenContract=false}={}) {
  const parent=policy.tasks.find(t=>t.taskId===taskId);
  assert.ok(parent,`Unknown canonical task: ${taskId}`);
  assert.ok(Object.hasOwn(workflow.roles,role),`Unknown role: ${role}`);
  assert.ok(workflow.risks.includes(risk),`Unknown risk: ${risk}`);
  const route=workflow.roles[role];
  let profile={model:route.model,reasoning:route.reasoning};
  if(role==='leaf') {
    assert.equal(frozenContract,true,'Leaf work requires a frozen reviewed behavior contract');
    assert.equal(risk,'normal','High-risk semantic work cannot be delegated as a Luna leaf');
  } else if(risk!=='normal'||parent.reasoning==='xhigh') {
    profile={...workflow.highRiskProfile};
  } else if(role==='implement') {
    profile={model:parent.model,reasoning:parent.reasoning};
  }
  return {taskId,role,risk,...profile,skill:route.skill,prompt:route.prompt,
    reviewRequired:true,implementationAuthorized:false,launchesModel:false,
    caution:role==='leaf'?'Mechanical subtask only; no semantic decisions. Parent integration and independent review remain.':'Recommendation only. Verify packet, dependencies, independent review and actual model availability before work.'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const args=process.argv.slice(2),taskId=args.shift();
  assert.ok(taskId,'Usage: node ops/engineering-task.mjs T-01 [--role design|implement|review|orchestrate|leaf] [--risk normal|authority|concurrency|migration|irreversible-effect] [--frozen-contract]');
  const opts={};
  while(args.length) {
    const key=args.shift();
    if(key==='--frozen-contract')opts.frozenContract=true;
    else if(key==='--role'||key==='--risk') {assert.ok(args[0]&&!args[0].startsWith('--'),`Missing value for ${key}`);opts[key.slice(2)]=args.shift();}
    else throw new Error(`Unknown option: ${key}`);
  }
  const read=async f=>JSON.parse(await readFile(path.join(root,f),'utf8'));
  const workflow=await read('contracts/engineering/workflow.json');
  const policy=await read(workflow.parentPolicy);
  const plan=await read('docs/production/IMPLEMENTATION-BACKLOG.json');
  const task=plan.tasks.find(t=>t.id===taskId);assert.ok(task,'Missing canonical task');
  console.log(JSON.stringify({...selectProfile(policy,workflow,taskId,opts),title:task.title,status:task.status,
    dependencies:task.depends_on,acceptanceIds:task.acceptance.map(a=>a.id),
    boundaryDraft:`contracts/enterprise/wp-${taskId}.json`,
    next:'Read the selected skill, task sources, vectors and packet; structural recommendation is not readiness.'},null,2));
}
