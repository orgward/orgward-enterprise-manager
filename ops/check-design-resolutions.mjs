import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { additionalOperations } from '../contracts/enterprise/additional-operation-decisions.mjs';
import { parseFields, digest } from './build-work-package-drafts.mjs';
import { validateExample } from './check-work-package-drafts.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const text={type:'string',minLength:1};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const integer={type:'integer',minimum:0};
const errorSchema=object({code:text,message:text,fieldErrors:{type:'array',items:object({field:text,message:text})},correlationId:text,retryable:{type:'boolean'},currentVersion:{type:['integer','null']},recoveryActions:{type:'array',items:text,minItems:1}});

export function describeOperation(row) {
  const [number,name,fields,aggregate,transition,event,role,invariant,result,recovery]=row;
  const taskId=`T-${number}`, [from,to]=transition.split('>');
  const parsed=parseFields(fields), readOnly=event==='None';
  for(const [field,schema] of Object.entries(parsed.definition.properties)) {
    if(schema.type==='number'&&/(Epoch|Version|Seconds|Ms|Count|Limit|Hours)$/.test(field))schema.type='integer';
  }
  const internal=['InvalidateContext','RegisterOperation'].includes(name);
  const asynchronous=['fencing','reconciling','rotating','validating','running','queued','recovering','pause_requested'].includes(to);
  const version=from==='absent'?0:7;
  const semantic=new Set(['ResolveSyncConflict','ResolveImpactConflict','ApproveChange','RegisterDependency','RegisterRelation','RegisterConstraint','PublishActionTemplate','MigrateDomainSchema','ProposeObservedChange','RepairDependency','PreviewChange']);
  const contextSchema=object({workspaceId:text,branchId:text,effectiveAt:text});
  const context={workspaceId:'workspace-a',branchId:'branch-1',effectiveAt:'2026-09-19T00:00:00Z'};
  const requestSchema=readOnly?object({payload:parsed.definition}):object({commandId:text,operation:{const:name},expectedVersion:integer,...(semantic.has(name)?{expectedHead:integer,context:contextSchema}:{}),payload:parsed.definition,reason:text});
  const requestExample=readOnly?{payload:parsed.example}:{commandId:`fixture-${name}-1`,operation:name,expectedVersion:version,...(semantic.has(name)?{expectedHead:7,context}:{}),payload:parsed.example,reason:'Exercise the specified transition with seeded test records'};
  const resultSchema=object({...(readOnly?{query:{const:name}}:{commandId:text}),aggregateRef:text,state:{const:to},version:integer,disposition:{enum:['completed','accepted','read']}});
  const resultExample={...(readOnly?{query:name}:{commandId:requestExample.commandId}),aggregateRef:`${aggregate}-1`,state:to,version:readOnly?version:version+1,disposition:readOnly?'read':asynchronous?'accepted':'completed'};
  const errorExample={code:'DOMAIN_PRECONDITION_FAILED',message:'A required invariant is not satisfied. Inspect permitted validation details.',fieldErrors:[],correlationId:`trace-${name}-1`,retryable:false,currentVersion:7,recoveryActions:['inspect-validation','repair-or-review']};
  return {taskId,name,status:'specified_pending_independent_review',author:'codex',reviewer:null,
    sourceDecision:`contracts/enterprise/additional-operation-decisions.mjs#${name}`,rowDigest:digest(row),
    transport:internal?'internal registered service only; no public route':readOnly?'GET /api/v1/queries/'+name+'; URL-encoded input, no GET body':'POST /api/v1/commands',
    contextContract:'Resolve session tenant/workspace/actor and current security/policy/placement epochs on server. Listed semantic operations include expectedHead/context in the strict envelope; metadata-only and read operations do not manufacture a branch. Publication/review additionally validates the payload candidate/impact/approval bindings required by CP-01.',
    requestSchema,requestExample,resultSchema,resultExample,errorSchema,errorExample,
    targetAggregate:aggregate,readOnly,internal,eligibleRole:role,
    permission:`Current tenant-scoped ${role} grant for ${name}; role label alone is insufficient. A separate independent reviewer is required wherever the invariant specifies one. Never trust payload reviewerRef as identity.`,
    transition:{from,to},invariant,durableResult:result,recovery,event,
    transaction:readOnly?'No domain write, result event or effect. Filter result using current authorization.':internal&&name==='InvalidateContext'?'Same transaction as baseline/head and command/outbox commit; never a later asynchronous invalidation.':'Domain state, command result, audit intent and outbox commit atomically. Async/external work uses durable job/intent and current dispatch authorization; terminal events require observed completion.',
    idempotency:'Scope command key by authenticated tenant and operation. Equal replay returns existing result subject to current read permission; different canonical payload conflicts. Provider timeouts require reconciliation, not blind resend.',
    uiContract:'Use the owning task screens and eight states; show domain validation reasons, actual stage and recovery. Payload references are authorized selectors, not editable credentials, identity or proof. Accepted jobs remain pending.',
    fixtures:{executionStatus:'not_run',required:['positive durable transition','domain-invariant failure','cross-tenant denial','ineligible role','stale expected version','crash/restart','unknown effect where applicable'],
      definitionValidationOnly:true,domainAssertions:[invariant,result,recovery]},
    readyForImplementation:false,
  };
}

// Abstract state/permission oracle only. The application must not import it.
// The booleans below represent facts already independently verified by tests;
// no production request may supply them as authority.
export function transitionOracle(operation, facts) {
  for(const key of ['authenticated','tenantMatches','roleGrantCurrent','domainInvariantHolds'])assert.equal(typeof facts[key],'boolean',`Missing ${key}`);
  return facts.authenticated&&facts.tenantMatches&&facts.roleGrantCurrent&&facts.domainInvariantHolds&&facts.state===operation.transition.from;
}

export async function checkDesignResolutions(plan,{selfTest=false}={}) {
  const index=JSON.parse(await readFile(path.join(root,'contracts/enterprise/packet-drafts.index.json'),'utf8'));
  const savedPackets=await Promise.all(index.packets.map(p=>readFile(path.join(root,p.path),'utf8').then(JSON.parse)));
  // Derive obligations from canonical task operations and validated saved
  // primary packets, not the index's descriptive operation-gap column.
  const required=plan.tasks.flatMap(task=>(task.implementation_contract?.operations || []).filter(name=>!savedPackets.find(p=>p.taskId===task.id)?.operations.some(op=>op.name===name)).map(name=>`${task.id}:${name}`)).sort();
  const actual=additionalOperations.map(r=>`T-${r[0]}:${r[1]}`).sort();
  assert.deepEqual(actual,required,'Missing, duplicate or invented additional operation decision');
  let examples=0,oracleCases=0,rejections=0;
  const tasks=new Map(plan.tasks.map(t=>[t.id,t]));
  for(const row of additionalOperations) {
    assert.equal(row.length,10);
    const op=describeOperation(row),task=tasks.get(op.taskId);
    assert.ok(task.implementation_contract.operations.includes(op.name));
    assert.equal(op.readyForImplementation,false);assert.equal(op.reviewer,null);
    assert.ok(op.invariant.length>45&&op.durableResult.length>45&&op.recovery.length>45);
    for(const [schema,value] of [[op.requestSchema,op.requestExample],[op.resultSchema,op.resultExample],[op.errorSchema,op.errorExample]]) {validateExample(schema,value);examples++;}
    assert.equal(op.resultExample.state,op.transition.to);
    if(op.readOnly)assert.equal(op.event,'None');
    const good={authenticated:true,tenantMatches:true,roleGrantCurrent:true,domainInvariantHolds:true,state:op.transition.from};
    assert.equal(transitionOracle(op,good),true);oracleCases++;
    for(const key of ['authenticated','tenantMatches','roleGrantCurrent','domainInvariantHolds']){assert.equal(transitionOracle(op,{...good,[key]:false}),false);oracleCases++;}
    assert.equal(transitionOracle(op,{...good,state:'not-a-valid-source-state'}),false);oracleCases++;
    if(selfTest){
      const missing=structuredClone(op.requestExample);delete missing.payload[Object.keys(missing.payload)[0]];
      for(const bad of [missing,{...op.requestExample,payload:{...op.requestExample.payload,admin:true}},{...op.requestExample,operation:'UnknownOperation'},{...op.requestExample,expectedVersion:-1}]){assert.throws(()=>validateExample(op.requestSchema,bad));rejections++;}
      assert.throws(()=>transitionOracle(op,{...good,domainInvariantHolds:'true'}));rejections++;
    }
  }
  const staffing=JSON.parse(await readFile(path.join(root,'contracts/enterprise/agent-assignment-policy.json'),'utf8'));
  assert.deepEqual(staffing.tasks.map(t=>t.taskId),plan.tasks.map(t=>t.id));
  for(const t of staffing.tasks){assert.ok(['gpt-5.6-terra','gpt-5.6-sol'].includes(t.model));assert.ok(['high','xhigh'].includes(t.reasoning));assert.equal(t.reviewRequired,true);}
  return {additional_operations_specified:actual.length,additional_operation_schema_examples:examples,
    abstract_operation_transition_cases:oracleCases,additional_operation_schema_rejections:rejections,
    assigned_task_recommendations:staffing.tasks.length,additional_operations_approved:0,
    unresolved_domain_oracle_review_bundles:132,product_acceptance_passes_added:0};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--describe')){
    const name=process.argv[process.argv.indexOf('--describe')+1];
    const row=additionalOperations.find(r=>r[1]===name);
    assert.ok(row,'Unknown operation');console.log(JSON.stringify(describeOperation(row),null,2));
  }else{
    const plan=JSON.parse(await readFile(path.join(root,'docs/production/IMPLEMENTATION-BACKLOG.json'),'utf8'));
    console.log(JSON.stringify({status:'pass',meaning:'Design decisions and abstract fixtures only; not implementation approval',...await checkDesignResolutions(plan,{selfTest:process.argv.includes('--self-test')})},null,2));
  }
}
