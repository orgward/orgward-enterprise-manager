import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const contractPath='contracts/enterprise/workflow-obligations-10.json';
export function validateWorkflowObligations(contract,plan,architecture) {
  assert.equal(plan.workflow_obligations,contractPath,'Workflow requirement disconnected from canonical backlog');
  assert.equal(architecture.workflow_obligations,contractPath,'Workflow requirement disconnected from architecture');
  assert.ok(plan.source_contracts.includes(contractPath));
  assert.equal(contract.format,'orgward-configurable-workflow-obligations-v1');
  assert.equal(contract.requirements.length,16);
  assert.deepEqual(contract.requirements.map(r=>r.id),Array.from({length:16},(_,i)=>`WF-${String(i+1).padStart(2,'0')}`));
  assert.deepEqual(contract.architecture,{semanticAuthority:'orgward-workflow-profile',diagramAdapter:'bpmn-js',runtimeAdapter:'temporal-typescript',agentGraph:'optional-langgraph-action-adapter',domainAuthority:'postgresql',defaultStages:'editable-template-not-fixed-runtime'});
  const tasks=new Map(plan.tasks.map(t=>[t.id,t]));
  for(const r of contract.requirements) {
    assert.ok(r.taskIds.length&&new Set(r.taskIds).size===r.taskIds.length);
    assert.ok(r.taskIds.every(id=>tasks.has(id)),`${r.id}: missing owner`);
    assert.ok(r.title.length>10&&r.scenario.startsWith('Given ')&&r.scenario.length>100);
    assert.ok(r.checks.length>=4&&r.checks.every(x=>x.length>10));
    assert.ok(['not_run','pass','fail','blocked'].includes(r.status));
    assert.ok(Array.isArray(r.evidence));
    assert.ok(r.taskEvidence&&typeof r.taskEvidence==='object'&&!Array.isArray(r.taskEvidence));
    assert.ok(Object.keys(r.taskEvidence).every(id=>r.taskIds.includes(id)));
    if(r.status==='pass')assert.ok(r.evidence.length>0,`${r.id}: no actual evidence`);
    for(const refs of Object.values(r.taskEvidence))assert.ok(Array.isArray(refs)&&refs.length>0);
    for(const e of [...r.evidence,...Object.values(r.taskEvidence).flat()]) {
      assert.match(e,/^ops\/checks\/[a-zA-Z0-9._/-]+$/);
      assert.ok(!e.split('/').includes('..'),'Escaping evidence path');
    }
    for(const id of r.taskIds) {
      const task=tasks.get(id);
      if(['in_progress','complete'].includes(task.status)) {
        const packets=architecture.packages.filter(p=>p.taskId===id);
        assert.ok(packets.some(p=>p.workflowObligationIds?.includes(r.id)),`${id}: missing packet linkage for ${r.id}`);
      }
      if(task.status==='complete')assert.ok(r.taskEvidence[id]?.length,`${id}: missing reviewed contribution evidence for ${r.id}`);
    }
  }
  if(tasks.get('T-132')?.status==='complete')assert.ok(contract.requirements.every(r=>r.status==='pass'),'Final release missing mandatory workflow acceptance');
  return true;
}

export async function checkConfigurableWorkflow(plan,architecture,{selfTest=false}={}) {
  const contract=JSON.parse(await readFile(path.join(root,contractPath),'utf8'));
  validateWorkflowObligations(contract,plan,architecture);
  await access(path.join(root,contract.decision));await access(path.join(root,contract.ux));
  for(const r of contract.requirements)for(const e of [...r.evidence,...Object.values(r.taskEvidence).flat()])await access(path.join(root,e));
  let rejected=0,positive=0;
  if(selfTest) {
    const changes=[c=>c.requirements.pop(),c=>c.requirements[0].id='WF-99',c=>c.architecture.defaultStages='fixed-twelve-stage-array',c=>c.architecture.runtimeAdapter='in-memory',c=>c.requirements[0].taskIds=['T-999'],c=>c.requirements[0].checks=[],c=>c.requirements[0].status='pass',c=>c.requirements[0].evidence=['ops/checks/../../secret'],c=>c.requirements[0].scenario='Implement workflow',c=>c.requirements[0].taskEvidence={'T-999':['ops/checks/fake.md']},c=>c.requirements[0].taskEvidence={'T-19':[]}];
    for(const mutate of changes){const c=structuredClone(contract);mutate(c);assert.throws(()=>validateWorkflowObligations(c,plan,architecture));rejected++;}
    for(const change of [p=>delete p.workflow_obligations,p=>p.tasks.find(t=>t.id==='T-52').status='in_progress',p=>p.tasks.find(t=>t.id==='T-132').status='complete']) {
      const p=structuredClone(plan);change(p);assert.throws(()=>validateWorkflowObligations(contract,p,architecture));rejected++;
    }
    const disconnected=structuredClone(architecture);delete disconnected.workflow_obligations;
    assert.throws(()=>validateWorkflowObligations(contract,plan,disconnected));rejected++;
    // Structural contribution check only. These synthetic paths are never saved
    // as evidence or checked as real product receipts.
    const partial=structuredClone(plan), a=structuredClone(architecture), c=structuredClone(contract);
    partial.tasks.find(t=>t.id==='T-01').status='complete';
    a.packages.push({taskId:'T-01',workflowObligationIds:['WF-03']});
    assert.throws(()=>validateWorkflowObligations(c,partial,a));rejected++;
    c.requirements.find(r=>r.id==='WF-03').taskEvidence['T-01']=['ops/checks/synthetic-not-saved.md'];
    validateWorkflowObligations(c,partial,a);positive++;
    assert.equal(c.requirements.find(r=>r.id==='WF-03').status,'not_run');
  }
  return {additional_workflow_obligations:16,workflow_obligations_passed:contract.requirements.filter(r=>r.status==='pass').length,rejected_workflow_contract_mutations:rejected,workflow_contribution_structure_self_tests:positive,workflow_runtime_acceptance_executed:0};
}
