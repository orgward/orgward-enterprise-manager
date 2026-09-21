import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectProfile } from '../ops/engineering-task.mjs';
import { validateChangeRecord } from '../ops/check-engineering-workflow.mjs';
const read=async f=>JSON.parse(await readFile(new URL(f,import.meta.url),'utf8'));
const policy=await read('../contracts/enterprise/agent-assignment-policy.json');
const workflow=await read('../contracts/engineering/workflow.json');
const plan=await read('../docs/production/IMPLEMENTATION-BACKLOG.json');
const sha=s=>createHash('sha256').update(s).digest('hex');

test('routing preserves stronger parent profile and never authorizes execution',()=>{
  const ordinary=selectProfile(policy,workflow,'T-02');assert.equal(ordinary.model,'gpt-5.6-terra');
  const strong=selectProfile(policy,workflow,'T-123');assert.equal(strong.model,'gpt-5.6-sol');assert.equal(strong.reasoning,'xhigh');
  assert.equal(strong.implementationAuthorized,false);assert.equal(strong.launchesModel,false);
});
test('design and review get Sol; explicit safety risk cannot downgrade',()=>{
  for(const role of ['design','review','orchestrate'])assert.equal(selectProfile(policy,workflow,'T-02',{role}).model,'gpt-5.6-sol');
  for(const risk of workflow.risks.filter(r=>r!=='normal'))assert.equal(selectProfile(policy,workflow,'T-02',{risk}).reasoning,'xhigh');
});
test('Luna leaf requires frozen scope and rejects semantic safety risk',()=>{
  assert.throws(()=>selectProfile(policy,workflow,'T-02',{role:'leaf'}));
  assert.throws(()=>selectProfile(policy,workflow,'T-123',{role:'leaf',risk:'authority',frozenContract:true}));
  assert.equal(selectProfile(policy,workflow,'T-02',{role:'leaf',frozenContract:true}).model,'gpt-5.6-luna');
});
test('routing rejects unknown task role and risk',()=>{
  assert.throws(()=>selectProfile(policy,workflow,'T-999'));
  assert.throws(()=>selectProfile(policy,workflow,'T-02',{role:'__proto__'}));
  assert.throws(()=>selectProfile(policy,workflow,'T-02',{risk:'skip-review'}));
});
// Synthetic validation input only. Never written to the actual change registry.
function proposal(){return {template:false,id:'CR-test-only',status:'proposed',kind:'refinement',author:'author-test',reason:'An independently observed timezone ambiguity needs specified occurrence behavior.',evidence:['ops/checks/synthetic-only.md'],taskIds:['T-01'],acceptanceIds:['T-01-AC1'],before:{revision:'test-v1',exactText:'Synthetic prior semantics',digest:sha('Synthetic prior semantics')},after:{proposal:'Synthetic clarified occurrence contract',candidateDigest:sha('test-v2')},alternatives:['Reject ambiguous time explicitly'],impact:Object.fromEntries(['ux','model','apiEvents','security','workflow','migration','evidence','operations','dependencies','qualification'].map(k=>[k,'Synthetic impact examined for this validation test'])),preservedObligations:['T-01-AC1'],successorMappings:[],invalidationPlan:['Stale affected test packet'],validationCommands:['synthetic-test-command'],review:null,ownerDecision:null,appliedArtifacts:[],validationReceipts:[],resumeCondition:'Independent review of revised contract'};}
test('proposed changes can be captured honestly without fictitious approval',()=>{
  assert.equal(validateChangeRecord(proposal(),plan),true);
});
test('change validation rejects missing impact lineage evidence and template registration',()=>{
  const mutations=[r=>r.template=true,r=>r.id='CR-REPLACE',r=>r.evidence=[],r=>r.acceptanceIds=['T-999-AC1'],r=>r.preservedObligations=[],r=>r.before.digest='bad',r=>r.impact.workflow=null,r=>r.resumeCondition='',r=>r.status='green'];
  for(const mutate of mutations){const r=proposal();mutate(r);assert.throws(()=>validateChangeRecord(r,plan));}
});
function reviewed(){const r=proposal();r.status='approved';r.review={reviewer:'reviewer-test',independenceEvidence:'Separate synthetic fixture identity, not a real approval',receipt:'ops/checks/synthetic-review.md',candidateRevision:'a'.repeat(40),candidateDigest:r.after.candidateDigest,decision:'approved'};return r;}
test('approval requires separate matching review and owner decision for goal changes',()=>{
  assert.equal(validateChangeRecord(reviewed(),plan),true);
  for(const mutate of [r=>r.review=null,r=>r.review.reviewer=r.author,r=>delete r.review.candidateRevision,r=>r.review.candidateRevision='not-a-commit',r=>r.review.candidateDigest=sha('old'),r=>r.review.decision='changes_requested',r=>r.kind='goal_change']){const r=reviewed();mutate(r);assert.throws(()=>validateChangeRecord(r,plan));}
  const goal=reviewed();goal.kind='goal_change';goal.ownerDecision={principal:'owner-test',authority:'synthetic test only',receipt:'ops/checks/synthetic-owner.md',decision:'approved',candidateDigest:goal.after.candidateDigest};assert.equal(validateChangeRecord(goal,plan),true);
});
test('applied changes require artifact and actual-validation references',()=>{
  const r=reviewed();r.status='applied';assert.throws(()=>validateChangeRecord(r,plan));
  r.appliedArtifacts=['synthetic-contract.json'];r.validationReceipts=['ops/checks/synthetic-validation.md'];assert.equal(validateChangeRecord(r,plan),true);
});
