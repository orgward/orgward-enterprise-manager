// Source-derived trigger/control pairs, not a rule engine or executed tests.
// A reviewed packet must expand these semantic facts into full typed seed records.
const r=(id,severity,trigger,control,acceptanceIds,kind='finding')=>({ruleId:id,severity,trigger,control,acceptanceIds,triggerOutcome:kind,controlOutcome:'no-target-rule-finding'});
export const ruleProfile={id:'enterprise-sentinel-12',version:1,status:'specified_not_qualified',scope:'explicit-global-or-typed-scope; unknown-is-not-global',clock:'2026-10-01T00:00:00Z',driftWindowSeconds:3600,driftChangedClaimThreshold:10,staleEvidenceSeconds:31536000,heuristicR16Threshold:0.8,propertyExtension:'property-process-v1',exceptionChangesCanonicalSeverity:false};
export const ruleFixtures=[
  r('R-01','CRITICAL',{entity:'Party',classification:'canonical_identity',authorities:['system-a','system-b'],scope:'LE:A'},{entity:'Party',classification:'canonical_identity',authorities:['system-a'],scope:'LE:A'},['AT-11']),
  r('R-02','HIGH',{entity:'Party',classification:'canonical_identity',authority:'crm',kind:'consumer_system'},{entity:'Party',classification:'canonical_identity',authority:'identity',kind:'authoritative_registry'},['AT-12']),
  r('R-03','HIGH',{claim:'authority-a',acceptedLegacy:true,evidence:[],assertion:null},{claim:'authority-a',evidence:[],assertion:{actor:'owner-a',justification:'Reviewed source responsibility'}},['AT-13']),
  r('R-04','HIGH',{capability:'Onboarding',owners:['domain-a','domain-b'],scopes:['LE:A','LE:A']},{capability:'Onboarding',owners:['domain-a','domain-b'],scopes:['LE:A','LE:B']},['AT-14']),
  r('R-05','HIGH',{entity:'Party',governors:['domain-a','domain-b'],scopes:['LE:A','LE:A']},{entity:'Party',governors:['domain-a','domain-b'],scopes:['LE:A','LE:B']},['AT-14']),
  r('R-06','HIGH',{entity:'Party',classification:'canonical_identity',governors:[],coverage:'complete'},{entity:'Party',classification:'canonical_identity',governors:['domain-a'],coverage:'complete'},['AT-15']),
  r('R-07','WARN',{decision:'adr-a',governs:[]},{decision:'adr-a',governs:['entity:Party']},['AT-16']),
  r('R-08','HIGH',{decision:'adr-a',mandatoryAuthority:'system-a',acceptedAuthority:'system-b',entity:'Party'},{decision:'adr-a',mandatoryAuthority:'system-a',acceptedAuthority:'system-a',entity:'Party'},[]),
  r('R-09','CRITICAL',{entity:'Party',policy:'single_authority',authorities:['system-a','system-b']},{entity:'Party',policy:'single_authority',authorities:['system-a']},['AT-17']),
  r('R-10','WARN',{entity:'Party',classification:'unknown',referencedBy:['authority-a']},{entity:'Party',classification:'canonical_identity',referencedBy:['authority-a']},['AT-18']),
  r('R-11','WARN',{system:'app-a',kind:'unknown',realizes:['Onboarding']},{system:'app-a',kind:'consumer_system',realizes:['Onboarding']},['AT-18']),
  r('R-12','HIGH',{transfer:'transfer-a',entity:'Party',classification:'canonical_identity',sourceDomain:'domain-a',targetDomain:'domain-b',governingDecisions:[]},{transfer:'transfer-a',entity:'Party',classification:'canonical_identity',sourceDomain:'domain-a',targetDomain:'domain-b',governingDecisions:['adr-transfer']},['AT-19']),
  r('R-13','WARN',{legacyIntegration:'a-to-b',transferredEntity:null,mode:'incomplete-staging-diagnostic'},{integration:'a-to-b',transferredEntity:'Party'},['AT-20']),
  r('R-14','WARN',{capability:'Onboarding',owner:'domain-a',softwareRequired:true,realizations:[]},{capability:'Onboarding',owner:'domain-a',softwareRequired:false,manualRealization:'reviewed-human-process'},[]),
  r('R-15','INFO',{system:'app-a',semanticRelationships:[]},{system:'app-a',semanticRelationships:['realizes:Onboarding']},[]),
  r('R-16','WARN',{system:'replica-a',kind:'consumer_system',incomingCanonical:'Party',localMasterEvidence:'accepted-ownership-claim',heuristicConfidence:0.9},{system:'replica-a',kind:'consumer_system',incomingCanonical:'Party',localMasterEvidence:null,readOnlyEvidence:'approved-replication-contract'},[],'heuristic-finding'),
  r('R-17','HIGH',{entity:'Party',classifications:['canonical_identity','contextual'],scopes:['LE:A','LE:A']},{entity:'Party',classifications:['canonical_identity','contextual'],scopes:['LE:A','LE:B']},['AT-21']),
  r('R-18','HIGH',{system:'app-a',kinds:['authoritative_registry','consumer_system'],scopes:['LE:A','LE:A']},{system:'app-a',kinds:['authoritative_registry','consumer_system'],scopes:['LE:A','LE:B']},['AT-21']),
  r('R-19','WARN',{exception:'legacy-ex-a',reviewBy:null,perpetual:false,active:false},{exception:'ex-a',reviewBy:'2026-10-02T00:00:00Z',expiresAt:'2026-10-03T00:00:00Z',perpetual:false},['AT-22']),
  r('R-20','HIGH',{exception:'legacy-ex-a',governanceRefs:[],active:false},{exception:'ex-a',governanceRefs:['decision-a','evidence-a']},['AT-22']),
  r('R-21','WARN',{windowSeconds:3600,distinctChangedAcceptedClaimIds:11},{windowSeconds:3600,distinctChangedAcceptedClaimIds:10},['AT-29']),
  r('R-22','WARN',{decision:'adr-a',criticalEntity:'Party',authority:'system-a',governs:['entity:Party']},{decision:'adr-a',criticalEntity:'Party',authority:'system-a',governs:['entity:Party','system:system-a']},[]),
  r('R-23','WARN',{claim:'authority-a',evidenceAgeSeconds:31536001},{claim:'authority-a',evidenceAgeSeconds:31536000},['AT-23']),
  r('R-24','CRITICAL',{nodes:[{tenant:'tenant-a',type:'System',id:'a'},{tenant:'tenant-a',type:'System',id:'a'}]},{nodes:[{tenant:'tenant-a',type:'System',id:'a'},{tenant:'tenant-a',type:'Entity',id:'a'}]},['AT-10','AT-33'],'compile-failure'),
  r('R-25','WARN',{entity:'Party',authorities:['system-a','system-b'],scopes:['unknown','LE:A']},{entity:'Party',authorities:['system-a','system-b'],scopes:['LE:A','LE:B']},['AT-24']),
  r('R-26','HIGH',{process:'onboarding',property:'Party.email',authority:'identity',readSource:'replica',evidence:'read-a',coverage:'current-complete'},{process:'onboarding',property:'Party.email',authority:'identity',readSource:'identity',evidence:'read-a',coverage:'current-complete'},[]),
  r('R-27','WARN',{property:'Party.email',entityAuthority:'identity',propertyAuthority:null,inheritanceDecision:null,read:'read-a'},{property:'Party.email',entityAuthority:'identity',propertyAuthority:null,inheritanceDecision:'accepted-inherit-v1',read:'read-a'},[]),
  r('R-28','HIGH',{run:'run-a',property:'Party.email',stepSources:['identity','replica'],governingAllowance:null},{run:'run-a',property:'Party.email',stepSources:['identity','identity'],governingAllowance:null},[])
];
