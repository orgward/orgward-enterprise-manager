# Architecture and implementation-readiness review — revision 4

2026-09-19. The user's target is an enterprise SaaS where a new or existing organisation can represent its complete business, migrate knowledge/operations, run governed work and change it from any perspective while preserving links and constraints. This review updates files and specification validation; it does not implement the SaaS.

## Direct answers

**Was architecture already sufficiently clear?** No. Revision 3 had coherent module boundaries and broad feature coverage, but left managed tenancy, migration ownership/cutover and atomic knowledge invalidation under-specified. SOLUTION-ARCHITECTURE now fixes the modular transactional control plane, regional cell boundary, authoritative data/projection separation, tenant identity, module ownership, policy/effect broker and canonical change protocol.

**Could uncritical agents execute every task end-to-end without further contracts?** No. A user-story paragraph with acceptance bullets is not a complete implementation packet. The new handoff contract and checker require concrete schemas, operations/examples/errors, permissions, transitions, transactions/events, migrations/recovery, UI states and mapped test fixtures before a task starts. No task is falsely marked ready; the packet register is currently empty. Future bounded packets still require real review. The 132-task roadmap is a decomposable delivery contract, not proof that every coding detail has already been settled.

**Would the intended product represent and run an entire enterprise?** The target now explicitly requires every identified business activity in its declared scope to be represented, linked and assigned an execution mode: human, internal agent/deterministic work, external system, physical attestation or visible unsupported capability. Real operation requires performers/resources/authority and tested outputs, not only diagrams. Specialist systems may remain integrated systems of record. It would be false to promise every industry/jurisdiction/device/provider can be fully automated by a single generic release.

**Can users change it from any angle while knowledge stays current?** This is now a mandatory end-to-end contract: every edit source uses one command registry, typed revision model and field-aware dependency closure. Material publication commits a protective invalidation barrier atomically; stale approvals cannot dispatch while asynchronous indexes catch up. Affected projections, claims, evaluations and running work are recomputed, paused or explicitly stale/historical. Observations do not self-authorize accepted design. These guarantees still require database race/failure and real UI/API tests, not only a design oracle.

## Newly closed specification gaps; implementation remains open

| Gap | Required detail now saved | Owning tasks |
|---|---|---|
| “100%” had no defensible denominator | Signed inventory/scope, required activity facets, owner attestations, unknown/exclusion rules and distinct coverage dimensions | T-109/T-120 |
| Self-host support mistaken for full SaaS | Tenant/cell provisioning, identity, entitlement versus authority, metering, support access, residency and safe restriction/relocation | T-110–T-114/T-129 |
| Migration treated as file import | Source-of-record matrix, staged crosswalks, exact reconciliation, coexistence, shadow/rehearsal, work disposition, fenced cutover and hypercare | T-115–T-120 |
| “Keep links updated” lacked safety protocol | Ten entry points, typed dependency sensitivities, fixed-point impact, atomic invalidation, current-consistency queries and source reconciliation | T-121–T-124/T-130 |
| Custom enterprise concepts could become untyped data | Typed domain/relationship/schema/rule/form/action extensions and governed evolution | T-125 |
| Descriptive process could masquerade as actual business operation | Worker forms, human/agent/external cases, timers, results, commitments and evidence; safe template adoption | T-126/T-127 |
| Scenario counts could hide unsupported combinations | Generated constrained coverage, mandatory high-risk cases and explicit support manifest | T-128 |
| Task paragraphs mistaken for implementation readiness | Reviewed bounded work packets with concrete contract/UX/migration/fixture obligations and start/complete guards | T-131 |
| Prior final milestone could omit new target | T-106 retained as revision-3 baseline; T-132 depends on all 132 tasks and expanded SQ/AI qualification | T-132 |

## Assets and actual verification boundary

New authoritative documents: SOLUTION-ARCHITECTURE, CHANGE-PROTOCOL, MIGRATION-AND-COVERAGE (SC-21–SC-24), IMPLEMENTATION-HANDOFF and SAAS-QUALIFICATION. The machine-readable architecture register records eighteen invariants, eight SaaS journeys, ten edit entry points, six execution modes and ten migration phases. `contracts/enterprise/consistency-cases.json` contains eighteen abstract decision cases, not product authorization code. `work-package.contract.json` defines readiness obligations, not an implemented backlog.

The canonical backlog retains T-01–T-108 and adds twenty-four tasks with commands/aggregates/events/transaction contracts and ninety-six acceptance cases: **132 tasks, 480 task acceptance cases**. All remain planned/not run. Earlier 24 enterprise scenarios, 20 variation families, 16 perspectives, Sentinel R-01–R-28/AT-01–AT-33 and original gate sets remain required. Earlier reviews and findings are historical/open, not silently resolved by this documentation.

Read the receipt at `../../ops/checks/architecture-review-04-2026-09-19.md` for actual tests and revision. Structural checks and specification decision cases are reported separately from application regression tests. No new UI/backend production capability, independent customer approval or security certification is claimed. Original delivery remains 4/12 historical gates, production 0/16.

## Remaining implementation responsibilities, not hidden assumptions

Create and legitimately review bounded work packets; implement actual database/identity/effect isolation and UI behavior; pin tested release/provider versions; obtain customer-owned scope and domain interpretations; execute real migration/concurrency/tenant-security/recovery acceptance; independently qualify the supported release. No amount of prose or LLM self-review can remove those obligations. The architecture now constrains them so an agent must expose a gap instead of guessing or claiming completion.
