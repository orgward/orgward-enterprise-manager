# Full OrgWard portfolio roadmap — revision 4

## Issue #1 delivery overlay — proposed checkpoint 19

[Control protocol and ADR-019](CLOSED-LOOP-CONTROL-19.md) and
[customer interactions](../product/CLOSED-LOOP-UX-19.md) enrich existing tasks.
The machine-readable closed-loop-obligations-19.json supplies 18 dependency-ordered
slices, owners, deliverables, target paths and 24 source-linked acceptance scenarios
plus four supporting cases. Paths denote future work, not existing implementations.

Sequence: CL-001/002 review and contracts → CL-003/004 intent/reconciliation and
clarification → CL-005–008 evaluator registry/adapters → CL-009/010 acceptance and
diagnosis → CL-011/012 durable execution and trace UX → CL-013–017 suites/calibration/
observations/learning → CL-018 integrated qualification. The JSON dependency graph
permits safe earlier work on independent suites; parent task dependencies also hold.
No parent closes until its bounded CL contributions and original ACs are evidenced.

Next: review CR-019 and integrate CL-001/002 into the bounded T-01 packet; T-02
truthful demonstrator work is independent. Then resume existing delivery order with
this overlay. No new P/E gates, approved packets or automatic model dispatch.

## Current target: complete business representation, operation and enterprise SaaS

Current definition checkpoint: [increment 17](DOMAIN-FIXTURE-HANDOFF-17.md),
480/480 original scenarios across all 132 tasks, 2,608 expected observations.
The original scenario pass is complete; additional WF/source/journey obligations
are preserved. All enterprise acceptance remains not_run, approved packets zero.
Next: bounded foundation packet integration and legitimate independent review,
including exact contracts, full seeds and actual observation adapters before coding.
No gate or runtime capability changed. See the
[activation/consistency scenarios](../product/ACTIVATION-CONSISTENCY-INTERACTIONS-17.md).

Historical definition checkpoint: [increment 13](DOMAIN-FIXTURE-HANDOFF-13.md),
316/480 original scenarios across 91 tasks, 1,778 observations. Read the
[governance/agent journeys](../product/GOVERNANCE-AGENT-INTERACTIONS-13.md).
Next T-90–T-99; 164 scenarios remain without this layer, and all actual implementation,
full seeds/adapters and independent review requirements remain. No gate changed.

Historical definition checkpoint: [increment 12](DOMAIN-FIXTURE-HANDOFF-12.md),
268/480 original scenarios across 79 tasks, 1,538 observations and 28 Sentinel rule
pairs. Next: T-78–T-89; T-77 already has high-risk effect vectors in increment 07.
212 scenarios still need this layer. Runtime tests, full seeds/adapters and genuine
independent review remain required; no P/E/WF gate changed.

Historical definition checkpoint: [increment 11](DOMAIN-FIXTURE-HANDOFF-11.md),
236/480 original scenarios across 71 tasks, 1,293 expected observations. Read
[business-to-Sentinel-to-SDLC interactions](../product/BUSINESS-SENTINEL-INTERACTIONS-11.md).
The remaining 244 scenarios and all implementation/review obligations remain open.
Sixteen mandatory configurable-workflow obligations remain additional and unrun.
Earlier checkpoint counts below are historical; no product gate changed.

[Domain-fixture increment 07](DOMAIN-FIXTURE-HANDOFF-07.md) supplies concrete
inputs/fault schedules/expected observations for 38 original scenarios. These
definitions cover 11 tasks; 121 other tasks/442 scenarios need the same treatment.
Actual implementation, test execution and independent review remain separate.

Read the concise [product intent](../product/PRODUCT-INTENT.md) and current
[engineering decisions/model assignments](ENGINEERING-DECISIONS-06.md).
Increment 06 specifies all 73 secondary-operation gaps from the draft register;
132 domain-oracle/review bundles still need elaboration/approval. These are
engineering obligations, not a reason to invent customer configuration or to
claim production readiness from contract checks.

Increment 05 adds the [task packet register](WORK-PACKAGE-INDEX.md) and
[elaboration review](WORK-PACKAGE-REVIEW.md): 132 boundary drafts, with all 480
scenarios preserved. Draft examples and traceability are checked; approval,
domain oracles and 73 additional operation contracts are still required.
Use the task-specific open decisions before attempting implementation. This
does not replace any roadmap obligation or pass any gate.

Read [solution architecture](SOLUTION-ARCHITECTURE.md), [change/knowledge protocol](CHANGE-PROTOCOL.md), [migration and coverage UX](../product/MIGRATION-AND-COVERAGE.md), [implementation handoff](IMPLEMENTATION-HANDOFF.md) and [SaaS qualification](SAAS-QUALIFICATION.md) first. These add the user's explicit managed-SaaS, existing-enterprise migration and all-angle consistency goals. Fixed topology/identity/transaction/change semantics replace earlier open alternatives; exact deployed versions and customer policy values still require tested release/configuration choices.

Current canonical backlog: **132 tasks/stories, 480 unrun acceptance cases**. T-109–T-132 include named commands, aggregates, events, transaction/recovery rules and screens. All original IDs and criteria remain. T-106 is the revision-3 portfolio qualifier; **T-132** is the final expanded endpoint and its dependency closure covers every task. No task is declared implemented or implementation-ready merely by this specification.

| Added track | Detailed tasks | Required working result |
|---|---|---|
| Complete business coverage | T-109 inventory/certification; T-120 activation | Dated owner-reviewed inventory; separate representation, constraints, execution, controls and outcome coverage; no hidden unsupported work. |
| Managed SaaS | T-110 provisioning/cells; T-111 identity; T-112 entitlements/metering/quotas; T-113 support/operations; T-114 residency/keys/relocation | Isolated customer-controlled tenancy beyond self-host alone; entitlement never grants business authority. |
| Existing-enterprise migration | T-115 discovery; T-116 mapping/staging; T-117 coexistence; T-118 validation/shadow/rehearsal; T-119 cutover/recovery | Preserve identities, knowledge, constraints, histories and active-work ownership with fenced writers and reconciled effects. |
| Changes from every angle | T-121 shared command registry; T-122 field-sensitive dependency closure; T-123 atomic invalidation/watermarks; T-124 reconciliation | Forms/maps/chat/matrix/API/import/learning cannot silently diverge; knowledge and approval staleness is explicit and protective. |
| Business operation and extension | T-125 custom typed domains/actions; T-126 executable forms/cases; T-127 adoption/templates/autonomy | Actual human/agent/internal/external work with shared controls, not descriptions or diagrams alone. |
| Delivery assurance | T-128 scenario matrix; T-129 SaaS security/service; T-130 migration/consistency; T-131 implementation packets; T-132 adjudication | Real cross-boundary/customer/security evidence and complete implementation packets; no task-count shortcut. |

M-07 adds SaaS and migration/consistency qualification through T-129/T-130. M-08 is T-132 after all earlier work and SQ-01–SQ-08 pass. IMPLEMENTATION-HANDOFF contains six required end-to-end slices. Follow dependency order, not task number, and split oversized work without dropping parent acceptance.

Comprehensive scope includes work in existing specialist systems and performed by people. It does not mean native replacement of every ERP, HR, financial, legal or physical system. Unknowns and unsupported actions remain visible and prevent unjustified completeness/automation claims.

## Revision-3 baseline retained below

The following 108-task/384-case plan and M-00–M-06 are historical baseline. References to T-106 as final apply to that baseline; T-132 and the revision-4 additions govern the current endpoint. Original P/E gate denominators do not change.

Updated 2026-09-19. This is the master expansion of ROADMAP.md, preserving its original production endpoint and history. The earlier 48-task core plan was insufficient for the entire OrgWard portfolio. The canonical backlog now has **108 tasks, 108 stories and 384 task acceptance cases**; all remain planned/not run. Additional source-specific acceptance and integrated journeys are explicit in PORTFOLIO-COVERAGE and PORTFOLIO-QUALIFICATION. Specification progress is not product progress.

## Read in this order

1. `../product/PORTFOLIO-CONTRACT.md`: source intent, product ownership, compatibility decisions and twelve cross-product contracts.
2. `../product/ENTERPRISE-MODEL.md`: shared identity/time/scope, ten dimensions, sixteen perspectives, progressive D0–D5 detail and edit/merge semantics.
3. `../product/PORTFOLIO-UX.md`: roles, visual/navigation rules and SC-13–SC-20; inherit SC-01–SC-12 and existing open review findings.
4. `../product/SENTINEL-CONTRACT.md`: claim lifecycle, deterministic compiler, rule/profile and module semantics.
5. `TASK-INDEX.md` → `IMPLEMENTATION-BACKLOG.json`: dependencies, user story, deliverables and concrete acceptance per task.
6. `PORTFOLIO-COVERAGE.json` and `PORTFOLIO-QUALIFICATION.md`: source fidelity, scenario families, cross-product mutation tests and customer qualification.

Also read `../product/ENTERPRISE-SCENARIOS.md`: 24 explicit workflows across commercial, people, finance references, suppliers, physical/service operations, governance, federation and exit, each with owner, adverse case, support class and task links.

T-01–T-48 and US/AC IDs remain intact. T-49–T-108/PF-49–PF-108 add explicit full-target requirements. The dependency graph, not numerical order or a generic phase label, determines eligibility. T-106's transitive dependency closure must include every task. No calendar promise is credible before implementation contracts, staff and measured throughput exist; milestones below have evidence-based exit conditions instead.

## Implementation tracks: every capability has a delivery owner

| Track / accountable role | Detailed task sequence | Required working result and qualification |
|---|---|---|
| Shared enterprise platform / platform lead | T-01 contracts; T-02 truthful data; T-03 shell; T-04 persistence; T-05 identity; T-06 authorization; T-07 secrets; T-08 install; T-38 inbox; T-40 administration; T-41 restore; T-42 upgrade; T-43 operations; T-44 integration APIs | Stable command/event/state contracts, protected durable operations and usable customer installation. Existing C/Q acceptance plus T-99/T-103–T-105. |
| Core enterprise design / operating-model owner | T-09 graph; T-10 conversation; T-11 real proposals; T-12 integrity/readiness; T-13 edits; T-14 navigation; T-15 economics; T-16 capacity; T-17 assignments; T-18 instructions | Editable sourced organisation and real human/agent authority, not a deterministic template masquerading as model execution. Original P-gates remain independent. |
| Whole-enterprise perspectives / enterprise architect | T-49 identity/time; T-50 organisational/legal scope; T-51 all lenses; T-52 process/case detail; T-53 branch/merge; T-54 progressive refinement; T-55 interchange/extensions; T-56 commitments/economics; T-57 workforce/suppliers; T-58 customers/value; T-59 risk/control; T-60 strategy/simulation; T-61 information/systems; T-62 physical/manual profiles; T-63 collaboration/bulk; T-64 explainable readiness | One model across sixteen perspectives and D0–D5, including non-software enterprises, with actionable cross-perspective edits and temporal evidence. PQ-01/02/08/11. |
| Enterprise operations / process owner | T-19 executable plan; T-20 durable tasks; T-21 isolation/tools; T-22 real model output; T-23 interventions; T-24 non-software journey; T-96 certified external test effects; T-101 case simulation/learning; T-102 continuity | Useful human/agent work respects checkpoints, authority, capacity, commitments and recovery; no automatic real financial/legal/physical permission. PQ-06/08. |
| Sentinel / integrity owner | T-65 ingestion; T-66 extraction; T-67 review; T-68 compiler; T-69 graph/OADL; T-70 base rules; T-71 property/advanced rules; T-72 inbox; T-73 exceptions; T-74 drift; T-75 source qualification | Original R-01–R-28 and AT-01–AT-33 preserved, deterministic snapshots and actionable evidence-backed decisions. PQ-03/05, not merely graph visualization. |
| Warden / policy owner | T-76 policy contracts; T-77 effect enforcement/revocation; T-78 simulation/rollout | Strategic/domain/runtime constraints tested at actual effects, with fail-closed uncertainty, safe reconciliation and policy rollback. PQ-04/06/07. |
| Arbiter / accountable decision owner | T-79 rights/delegation; T-80 voting/quorum/appeals; T-81 conflict/emergency | Legitimate scope-bound human decisions, independent approval, expiry and conflict resolution; no self-approval via new agent identity. PQ-04. |
| Steward / data/domain owner | T-82 definitions/ownership; T-83 quality/retention; T-84 data contracts/semantic lineage | Canonical meanings and property authority remain traceable through producer/consumer changes, classification and ownership handover. PQ-05. |
| Ledger / records and audit owner | T-39 initial audit export; T-85 cross-module chain; T-86 independent verification/holds/keys | Explainable causal history and portable independently verified evidence, with gaps and trust limits visible. Not an accounting product. PQ-09. |
| Overseer / agent supervisor | T-87 identity/autonomy; T-88 multi-agent handoff/shared budgets; T-89 independent/adversarial evaluation | Agents remain scoped, evaluated, interruptible and unable to widen delegated authority; one shared engine. PQ-06. |
| SDLC / engineering and release owners | T-25 context; T-26 requirements; T-27 architecture; T-28 plan; T-29 repository; T-30 change; T-31 assurance; T-32 signed artifacts; T-33 approval; T-34 deploy; T-35 recovery; T-36 observations; T-37 learning; T-90 bidirectional context; T-91 intent-derived evals; T-92 multi-repo/migration; T-93 alternatives/regeneration; T-94 promotion; T-95 incidents/feedback | Real software creation/change derives from accepted organisational design and flows back as governed observations. Non-bank, brownfield, multi-repo and migration paths survive. PQ-07/12. |
| Ecosystem/customer ownership / customer platform owner | T-97 connectors; T-98 role/accessibility UX; T-99 modular self-host; T-100 interpreted industry packs; T-107 extension certification; T-108 retirement/federation/exit | Supported adapter/pack combinations are explicit; customer can install, upgrade, recover, reorganize and leave with usable data/evidence. PQ-10/11. |
| Independent release qualification / release authority | T-45 usability; T-46 security; T-47 scale; T-48 earlier core release; T-103 cross-module security/privacy; T-104 portfolio scale/failure; T-105 customer installation/acceptance; T-106 full closed loop | All applicable original and expanded acceptance runs on the actual supported revision. Full portfolio claim requires more than T-48. PQ-01–PQ-12. |

## Release milestones and honest scope labels

| Milestone | Dependencies / scope | Exit evidence; what it does NOT claim |
|---|---|---|
| M-00 Executable contracts and truthful demonstrator | T-01–T-04 plus bounded T-49 schema work under the dependency rules | Contract fixtures, trustworthy unavailable/sample states and corrected UI foundations. Not production or a complete portfolio. |
| M-01 Original private operating workflow | Dependency closure of T-24 and all P-01–P-12 acceptance, including remaining persistence/dashboard/demo obligations | Real bounded agent task, editable design/role, mandatory human intervention and restart evidence. Fixed original 12 gates; not a customer production release. |
| M-02 Enterprise operating and delivery core | Dependency closure of T-48; all E-01–E-16 and P criteria | Independent installation/security/scale and real governed delivery/operating journeys under their supported scope. Not proof that six integrity/governance modules are all complete. |
| M-03 Integrated integrity and design | T-49–T-75 plus dependencies, including T-80 for governed exceptions | Multi-perspective/refinement/merge UX and original Sentinel source qualification, PQ-01/02/03/05. May be packaged as a read-only integrity entry path; execution features require their own dependencies and qualification. |
| M-04 Governed portfolio operation | T-76–T-96, T-101–T-102 and dependencies | Policy/decisions/stewardship/audit/agent supervision bound to real enterprise and SDLC work, PQ-04–PQ-09. Full customer ecosystem and qualification still outstanding. |
| M-05 Customer-owned extensible portfolio | T-97–T-105, T-107–T-108 and dependencies | Supported installation/upgrade/restore, accessible role journeys, connector/pack compatibility, federation/exit and independent security/load evidence. Unsupported combinations remain visible. |
| M-06 Full portfolio target | T-106, every PF requirement and transitive dependency, all PQ/F/PC/X/source acceptance and original gate criteria | Revision-bound release adjudication for the declared supported scope; no untested module, boundary or mandatory feature. No claim to support every possible jurisdiction, provider or industry without further qualified extensions. |

Milestones can overlap in engineering; they are not permission to bypass dependencies. Any narrower release names its modules, variants, disabled effects and limitations. The entire roadmap remains required for the full target rather than being pushed into an unowned “later” list.

## Immediate next build and stopping rule

Mandatory updated design: [configurable workflows](../product/CONFIGURABLE-WORKFLOWS.md)
and [ADR-010](ADR-010-CONFIGURABLE-WORKFLOW.md); workflow definitions, including
SDLC, must be visually/form editable. Sixteen additional WF obligations augment
the unchanged original tasks. See ADR slices WF-S1–WF-S6 for dependency-respecting
schema/editor/runtime/operations/qualification work. No fixed-stage-only endpoint.

Latest checkpoint [17](DOMAIN-FIXTURE-HANDOFF-17.md) closes the final 48 definitions:
480/480 original scenarios across 132/132 tasks. Next is the bounded T-01/T-02
packet integration/review described in that handoff. Do not start feature code
without concrete schemas/seeds/adapters, prerequisite evidence and independent
approval; no packet is currently approved. Stop after that authorized increment.
Historical checkpoint [16](DOMAIN-FIXTURE-HANDOFF-16.md) covers T-109–T-118;
432/480 scenarios across 120 tasks have concrete expected observations. Next:
remaining T-120–T-132 excluding T-123; T-119/T-123 already have earlier vectors.
The final 48 uncovered scenarios and all packet integration/review requirements
remain; neither provisioning nor migration is implemented by this specification.
Historical checkpoint [15](DOMAIN-FIXTURE-HANDOFF-15.md) covers T-100–T-108;
392/480 scenarios across 110 tasks now have concrete expected observations.
Next bounded definition slice: T-109–T-118. All contract integration, independent
review and actual qualification obligations remain; T-132 is the final endpoint.
Historical checkpoint [14](DOMAIN-FIXTURE-HANDOFF-14.md) covers T-90–T-99;
356/480 scenarios across 101 tasks now have concrete expected observations.
Next bounded definition slice: T-100–T-108. Contracts are elaborated alongside
scenarios; selected packets still need full schema/seed/adapter integration and
independent review, not a separate from-scratch contract-design round.
Historical checkpoint [13](DOMAIN-FIXTURE-HANDOFF-13.md) covers T-78–T-89;
next bounded definition slice is T-90–T-99. Earlier checkpoint text is historical.
Historical checkpoint [12](DOMAIN-FIXTURE-HANDOFF-12.md) covers T-69–T-76;
next bounded definition slice is T-78–T-89. Earlier checkpoint text is historical.
Historical checkpoint [11](DOMAIN-FIXTURE-HANDOFF-11.md) covers T-56–T-67;
next bounded definition slice is T-69–T-76 (T-68 already covered in 07).
Historical checkpoint [10](DOMAIN-FIXTURE-HANDOFF-10.md) continues T-50–T-55 and
reaches 188/480 original definitions across 59 tasks. Next: T-56–T-67. The previous
checkpoint text below is historical; no vector is an executed acceptance test.

Current specification checkpoint: [increment 09](DOMAIN-FIXTURE-HANDOFF-09.md)
extends concrete expectations to 164/480 scenarios across 53/132 tasks. Read
[SDLC interactions](../product/SDLC-INTERACTIONS-09.md) for the user journey.
The next bounded definition slice is T-50–T-67 (enterprise model/perspectives/processes
and Sentinel ingestion/claim review); the 72 core T-25–T-48 definitions are saved, not executed.
All original task statuses and dependencies remain unchanged. None of the
vectors is an executed acceptance test or independently approved packet.
Historical revision-3 build guidance below is subject to the revision-4 packet
guard; do not start an implementation solely because its vector now exists.

This increment is specification/review only. Next authorized build should start T-01 and T-02, with the revision-3 model/profile/compatibility decisions included in T-01's executable fixtures. Select a bounded vertical slice, satisfy dependencies, implement UI plus backend plus negative/recovery tests, save a receipt and stop at the requested increment. Do not automatically start 108 tasks because a roadmap exists.

The remaining choices are implementation ADRs with named owners: supported provider/topology versions (T-01/T-08); temporal/scope/schema indexing (T-49); exact rule profiles and extension semantics (T-68–T-71); policy language/precedence and effect capabilities (T-76/T-77); agent evaluation thresholds/provider baseline (T-89); adapter and pack support matrix (T-97/T-100/T-107). They must be resolved with executable fixtures before downstream implementation, never silently guessed or marked complete through documentation alone.
