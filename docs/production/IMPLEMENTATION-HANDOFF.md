# Agent implementation contract and decision policy — revision 4

Mandatory user-requested addendum: [CONFIGURABLE-WORKFLOWS](../product/CONFIGURABLE-WORKFLOWS.md)
and [ADR-010](ADR-010-CONFIGURABLE-WORKFLOW.md). The canonical backlog and
architecture link sixteen WF obligations. Affected approved packets must declare
`workflowObligationIds` and their bounded contribution; task completion requires
its contribution receipt and T-132 requires every integrated WF result passed.
Do not impose downstream full-runtime tests on a prerequisite schema task, or
mistake its schema receipt for the integrated user journey. All review rules remain.

For the 91 tasks covered through [DOMAIN-FIXTURE-HANDOFF-13.md](DOMAIN-FIXTURE-HANDOFF-13.md),
use concrete vectors and independently collected observations, never a generic
pass flag. The 316 comparator self-tests are not actual application acceptance.
The remaining 164 original scenarios still need this elaboration. Read the linked SDLC
interaction guide for actual user decisions and cross-product handoffs.

Current engineering defaults and all 73 supplemental operation definitions are
in [ENGINEERING-DECISIONS-06.md](ENGINEERING-DECISIONS-06.md) and its contract
catalogue. They resolve ordinary design choices without inventing customer
authority. Domain-specific executable oracles and independent review remain
required; the increment-05 counts below are historical, not unanswered customer
questions to send back wholesale.

Draft elaboration increment 05: [WORK-PACKAGE-INDEX.md](WORK-PACKAGE-INDEX.md)
now links 132 boundary drafts preserving 480 scenarios. Read
[WORK-PACKAGE-REVIEW.md](WORK-PACKAGE-REVIEW.md) before using them: they have
205 explicit unresolved decisions, including 73 additional operation contracts,
and no independent approvals. They do not satisfy the start condition below.
Draft validation is separate from approval; never bulk-promote drafts.

The roadmap is a set of outcomes and acceptance obligations, not 132 interchangeable prompts. To avoid agents inventing missing semantics, use the mandatory work-package contract below. Do not claim that all coding choices or every enterprise-specific case can be known in advance.

## Fixed decisions versus configuration

Fixed: module ownership and transaction topology in SOLUTION-ARCHITECTURE; canonical identity/scope/version semantics; single command path; immutable baseline/evidence; field-aware dependency invalidation and freshness barriers; current authority at effect time; explicit source-of-record migration; tenant isolation; bounded model/tool execution; non-overridable denies; no auto-acceptance of observed behavior; deterministic claim compiler and versioned OADL extension boundary.

Configurable with recorded authorized owner: business scope, locale/calendar, risk/applicability, process/role/instructions, human checkpoints, data/source authority, industry interpretations, quotas, commercial policy, supported region/provider and reversible-action limits. Agent must not invent a missing owner approval or imply a configuration exists. Default unconfigured protected capability is disabled with a visible gap.

Release-selected and pinned: exact dependency/image versions, hardware/topology, adapter/provider versions and declared capacities. Pin through a tested release manifest before build/deploy qualification. This is a normal implementation choice under the architecture, not permission to alter architecture or claim universal support. Security/data-loss/authority/semantic ambiguity blocks the affected task; unrelated ready tasks may continue.

## Mandatory implementation packet per bounded slice

Every task, including the original 108, must have a packet satisfying `contracts/enterprise/work-package.contract.json` before its status becomes in_progress. The packet must name actual files and tests; no placeholder, generic “add CRUD”, pending schema or invented receipt. Split large parent tasks into bounded packets; preserve all story/acceptance IDs and dependency edges. Planning a packet does not complete it.

Required fields:

1. `taskId`, `sliceId`, actor, user trigger, desired observable result; parent acceptance IDs and dependency receipts.
2. Exact schemas/aggregate fields/enums/typed references/invariants, migration up/down or forward recovery, indices and isolation boundary.
3. Commands/queries: method/path or registered operation; request, successful result and safe error examples; permission matrix including denied principal; idempotency/version behavior.
4. Transaction/outbox/effect boundary; emitted events and subscribed consumers; field-level dependencies and freshness/invalidation semantics.
5. State machine: allowed transitions, actor/preconditions, durable output, denied transition and recovery. Specify retry versus new attempt and unknown-effect reconciliation.
6. UI: screen/route, fields, controls, permission visibility and loading/empty/stale/conflict/failed/denied/success/recovery states, keyboard path and persisted result after reload.
7. Fixtures: positive, negative, concurrent, restart/recovery, tenant isolation and end-to-end role journey; at least one cross-module counterexample. Each maps to a named acceptance criterion and expected persisted/event/effect result.
8. Non-goals and unsupported cases; source/architecture decisions; budget/time limits; observability and customer diagnostics; deployment/compatibility dependencies.
9. Evidence commands and expected assertions; raw results after execution, revision, fixture/provider manifest, unresolved findings and independent review outcome.

## Implementation sequence and completion prohibition

Latest concrete expectations: [DOMAIN-FIXTURE-HANDOFF-13.md](DOMAIN-FIXTURE-HANDOFF-13.md).
316 scenarios across 91 tasks now have vector definitions, source-sentence hashes,
failure schedules and expected observations. 164 original scenarios still need this layer.
Complete schema seeds, observation adapters and independent review before
claiming any packet ready. This supplements, not replaces, the packet requirements.

Write contract fixtures first; prove invalid inputs and denied transitions; implement migrations/repositories and atomic state/outbox; add domain commands and worker/projection consumers; connect API and real UI; run the complete role journey with restart and negative cases. Verify actual storage/effects independently of UI labels. An inaccessible button, static JSON response, mock provider or implemented schema alone cannot satisfy full-stack acceptance.

Before declaring a parent complete, reconcile every acceptance ID to a passing fixture/receipt and all child packets to completion. A packet's readiness check is a structural gate only, not architectural approval or implementation proof. Independent security, usability, migration and customer qualification cannot be replaced by an agent checking its own generated assertions.

## Required full-stack reference slices

| Slice | Real actor journey | Required backend and fault |
|---|---|---|
| RS-01 Design change | Designer edits a process from role view, previews system/authority impact, resolves conflict and publishes | Immutable baseline, dependency index, atomic invalidation, stale projection banner; concurrent authority change denies old preview. |
| RS-02 New enterprise | Founder establishes scope, models all required dimensions, assigns human/agent work and completes controlled task | Coverage denominator, enabled plan/authority, real bounded model output, checkpoint and restart evidence; unknown critical activity prevents certification. |
| RS-03 Existing enterprise | Migration owner stages source objects, resolves identity mapping, validates, rehearses and cuts over one process | Source cursors/mappings/fenced owner epoch, historical provenance, duplicate import safe; timeout after remote effect routes reconciliation. |
| RS-04 SaaS ownership | Admin provisions tenant, configures identity/quotas, grants limited support then revokes and restores | Isolated placement/membership/storage/jobs; support cannot read unrelated data; restored lease/grant cannot revive old authority. |
| RS-05 Closed loop | Architect accepts a data-authority change, Sentinel detects invalid reads, SDLC regenerates/evaluates and independent reviewer deploys correction | Shared canonical property, compiled snapshot, invalidated approvals, signed artifact and observed result; stale context blocks at effect boundary. |
| RS-06 Business operation | Worker executes a manual/external process, records partial result and requests permitted compensation | Commitments, typed forms, capacity, policy, durable effects, Ledger evidence; descriptor-only process or unknown effect cannot count as completed work. |

All six need both UI and API runs. None is substituted by the existing synthetic banking reference or fixed generator. The new architecture/protocol checker exercises design fixtures only and must be reported separately from product tests.
