# Enterprise model, perspectives and refinement

Revision-4 extension: ../production/CHANGE-PROTOCOL.md makes material-change propagation, protected invalidation and projection consistency precise. ../production/SOLUTION-ARCHITECTURE.md fixes the authoritative persistence/tenant topology; MIGRATION-AND-COVERAGE.md defines complete-business inventory and migration ownership. All model semantics below remain required.

Revision 3 target contract. Supplements C-01–C-07, not a replacement implementation schema. T-49–T-64 translate these requirements into executable schemas, commands and test fixtures before dependent features are coded.

## EM-01 — Shared identity, context and truth

Every aggregate: opaque stable ID, tenant/workspace, type+schemaVersion, owner reference, revision, lifecycle, recordedAt/by, provenance references and classification. Display name is mutable and never a join key. Relations have their own identity, typed endpoints, predicate, scope, validity, evidence and revision. State transitions require expectedVersion, commandId and server-derived principal; state plus outbox commit atomically. Deletion is lifecycle retirement/tombstone where referenced; history is not rewritten.

Distinguish (a) design scenario/branch, (b) temporal validity, (c) transaction/recording time, (d) claim review state, (e) implementation/enablement state, (f) observed verification. These are independent fields, not one `status`. Minimum context tuple: tenant, workspace, organisational/legal scope, branch, baseline revision, effectiveAt, recordedAsOf, lens, detailLevel and filters. A snapshot captures all of these plus source/version manifests. Future plans do not overwrite current operation. Late observations retain both observedAt and recordedAt. Time intervals use UTC instants; business calendars retain timezone and explicit DST behavior.

An object can be designed and accepted but not implemented; implemented but unverified; observed but unauthorized; retired but retained as historical evidence. UI must show each applicable dimension without false green synthesis. Assertions identify author and reason; evidence pointer absence remains visible.

## EM-02 — Minimum domain vocabulary

| Area | Required aggregates and typed relations | Invariants / deliberately separate concepts |
|---|---|---|
| Purpose and strategy | Purpose, Stakeholder, Goal, Outcome, Measure, Assumption, Experiment; supports/dependsOn/measuredBy | Goals have accountable owner, horizon and observable success; assumptions are not facts; causation is not inferred from correlation. |
| Value and customers | Segment, Need, Offering, Product/Service, Journey, Channel, ValueStream, Agreement | Offering addresses a need and realizes capabilities; customer personal records stay in authorized systems of record unless explicitly in scope. |
| Enterprise structure | Organisation, LegalEntity, Unit, Domain, Location, Partnership, Role, Principal, Assignment | Legal entity, tenant, domain, department and security boundary are different types; organisational membership does not itself grant tool authority. |
| Capabilities and processes | Capability, ProcessDefinition, Activity, CaseType, Trigger, TaskContract, DecisionPoint, HumanCheckpoint | Capability is an ability; process a versioned way to realize it; run an instance. Branch/join/loop/compensation semantics are explicit; manual work is valid. |
| Authority and governance | AuthorityScope, DecisionRight, Delegation, Decision, Policy, ObligationInterpretation, Exception | Accountability, responsibility, ownership, usage, stewardship and canonical source authority are different predicates. Scope cannot be inferred from a diagram's position. |
| Resources and economics | Resource, CapacityCalendar, Reservation, Budget, EconomicScenario, Commitment, ContractReference, AccountReference, PostingReference | Amounts include unit/currency/period/source; no incompatible totals; commitments may be incomplete or disputed; accounting source remains identified. |
| Information | Concept, EntityDefinition, SemanticProperty, Classification, DataContract, QualityRule, EvidenceSource | Business term is not a physical column; property mapping is versioned; authoritative source is not necessarily most frequently read source. |
| Technology | System, Service, Interface, Integration, DataStore, Component, Repository, DeploymentTarget, Artifact | A repository can realize several components; one service can have many deployments; logical service != executable artifact != environment instance. |
| Risk and control | RiskScenario, Control, ControlTest, Finding, Issue, Incident, RecoveryPlan | Risk has context/likelihood/impact method; control existence != operating effectiveness; exception does not delete evidence of violation. |
| People and agents | RoleDefinition, SkillRequirement, AgentProfile, InstructionVersion, CapabilityGrant, Workload | Agent is not a human approver; planner/evaluator/approver separation is explicit; identity type never grants implicit seniority. |
| Learning and lifecycle | Observation, Assessment, ChangeCase, Baseline, LifecycleEvent, RetirementPlan | Learning proposes change; approval/publishing is separate. Retire includes active runs, evidence retention and external obligations. |

Schema implementations define required fields, enumerations, cardinalities, indexed queries, invariants, errors and migration for each enabled aggregate. The above is not permission to implement arbitrary untyped JSON bags. Custom concepts use versioned namespaces and typed predicates; absent domain packs stay visible as unsupported.

## EM-03 — Perspectives are projections, not duplicate models

| Lens | User question | Primary visualization / meaningful cross-perspective navigation |
|---|---|---|
| L-01 Strategy/outcomes | Why does this exist and is it succeeding? | Goal tree, measure timeline → offering/process/control |
| L-02 Customer/value | Who benefits, through what experience? | Journey/value stream → capabilities, channels, commitments |
| L-03 Capability/domain | What must we be able to do, and who owns it? | Capability hierarchy/heatmap → processes, systems, gaps |
| L-04 Process/case | How does work flow, including exceptions? | Swimlane/process graph → roles, inputs, decisions, runs |
| L-05 Organisation/authority | Who is accountable and permitted to decide? | Org chart + responsibility/decision matrix → scope, delegation, work |
| L-06 Resources/economics | Can we fund and staff this design? | Capacity/calendar/scenario table → commitments, bottlenecks, outcomes |
| L-07 Information/lineage | What does this mean and where is truth? | Entity/property lineage → source authority, process reads, data contracts |
| L-08 System/architecture | What implements each capability and dependency? | System context/component map → interfaces, repos, environments |
| L-09 Risk/control/obligation | What can fail and what constrains us? | Risk/control coverage matrix → evidence, policies, interpretations |
| L-10 People/agent autonomy | Who or what performs work within which limits? | Assignment/capability graph → instructions, budgets, evaluations |
| L-11 SDLC/delivery | How does intent become a running system? | Requirement-to-release trace → baseline, tests, artifact, deployment |
| L-12 Execution/operations | What is happening and where must I intervene? | Run timeline/queue → checkpoint, effects, compensation, incident |
| L-13 Evidence/integrity | Why believe this and where is it inconsistent? | Findings queue/claim graph → evidence, compiler snapshot, resolution |
| L-14 Change/time | What changes across alternatives and time? | Branch/version comparison and dependency delta → impacted lenses |
| L-15 Federation/scope | Which unit, legal entity or partner owns this scope? | Scoped hierarchy/boundary map → shared contracts and redacted references |
| L-16 Lifecycle/resilience | Can we evolve, recover or exit safely? | Lifecycle/recovery/decommission plan → dependencies, retained evidence |

All lenses query the same IDs and context. Split view supports any pair of compatible lenses, synchronized selection, breadcrumb and edge explanation; it must explain hidden or unauthorized dependencies without leaking forbidden names/counts. Cross-perspective query builder uses allowlisted typed traversals, bounded depth and permission-filtered pagination. A heatmap declares its denominator, exclusions and evidence freshness. Layout-only edits are personal/shared view settings, not semantic model versions.

## EM-04 — Progressive detail without losing intent

Detail levels: D0 enterprise outcomes/boundaries; D1 domains/value/capabilities; D2 processes/decisions/roles/information; D3 logical systems/services/interfaces; D4 components/data contracts/repos/architecture; D5 build/artifact/environment/runtime evidence. A user can stop at D1 or model a manual D2 process: no compulsory software creation. Multiple detail levels may coexist; unknown refinements are visibly incomplete.

`refines`, `realizes`, `constrains`, `satisfies`, `evaluates`, `observes`, `supersedes` are distinct typed links. Many-to-many mappings carry rationale, scope and version. A process may require a software change or reuse an existing system. Creating an SDLC case from a selected D2/D3 gap preserves source IDs, acceptance conditions, authority, data definitions and critical assumptions. Refinement does not automatically satisfy the parent requirement; independent evaluations establish that.

Reverse tracing must answer: which enterprise outcome does this test protect; which accepted process uses this field; who approved this data authority; which deployed artifacts implement this system; which assumptions would invalidate that release? Missing links are actionable gaps, not an AI-generated claim of coverage.

## EM-05 — Interactive editing and collaboration

Graph/list/matrix editors invoke the same typed commands. Create by conversation, form, connector proposal or diagram gesture; all produce reviewable drafts. Link gesture opens a predicate/target/scope form constrained by types and permissions; dragging a node only changes layout unless explicitly reparenting. Reparenting previews semantic effects. Bulk edit/import shows per-row validation, all-or-nothing or explicitly selected partial transaction policy, and a dry-run diff.

Branch from immutable baseline; autosave draft with visible timestamp; compare object fields and edges; request review; resolve conflicts; publish with expected base. Three-way merge identifies delete/edit, rename/identity, edge, scope, policy and extension-version conflicts. Never use last-write-wins for authority or policy. Review approval binds the final digest; editing approved content invalidates approval. Concurrent users see stale draft and rebase choice; reconnect preserves unsent work and revalidates authorization.

Semantic undo is a new compensating revision, not history deletion. Reverting published design does not roll back already executed effects; show active run/deployment impacts and require their separate recovery plan. Branching secret/classified data never broadens access. Comments/mentions are scoped durable discussions with resolution distinct from approval. Presence is advisory, not a lock or authorization guarantee.

## EM-06 — Change propagation and running work

Maintain reverse dependency index with edge kind, version and evaluation relevance. Any material change computes an explainable impact set: draft-only visuals; design references; accepted claim compile; requirements/evals; policy/approval; queued work; active effects; observations. An impact row names the changed field and traversal path, not just a count.

Pinned historical results remain reproducible, while their applicability to the new baseline becomes stale. New/queued protected effects revalidate current policy/identity and required context. Active local work may finish under its pinned context only if policy permits; revoked grants stop the next effect and enter pause/reconciliation. An in-flight external transaction cannot be labeled undone until provider evidence confirms reversal. Mandatory human checkpoints cannot be skipped by rebasing or retrying.

Acceptance fixture: change canonical CustomerEmail authority A→B while two reviewers edit the onboarding process and an agent deployment is queued. Merge must surface the conflict, old evaluation/approval becomes stale, Warden refuses the old effect tuple, Sentinel compiles B only after authorized claims, and the replacement SDLC case traces back to the approved design. A completed old deployment remains historically A, never rewritten B.

## EM-07 — Extension and portability policy

Minimum extension manifest: namespace/version, schema and predicates, migrations, required modules, applicability scopes, rule/eval packs, UI field/view descriptors, data classification, capabilities and compatibility range. Code-bearing adapters are reviewed/signed and run with least privilege; uploaded model content is not executable. Load rejection/quarantine and uninstall impact are visible. Unsupported fields are preserved in a lossless Studio export or explicitly rejected; OADL projection separately discloses losses.

Baseline variation families include services, software products, goods/supply chains, regulated financial reference, public/nonprofit, multi-entity global operations, human-only workflows, and mixed physical/digital operations. Pack-specific operational/legal claims require separately qualified adapters and interpretations. Machinery, medical decisions, bank transfers and statutory actions are not authorized by a generated process or this roadmap.
