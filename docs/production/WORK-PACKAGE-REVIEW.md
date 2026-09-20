# Work-package elaboration review — increment 05

Follow-up increment 06: [ENGINEERING-DECISIONS-06.md](ENGINEERING-DECISIONS-06.md)
fixes engineering defaults and supplies all 73 additional named command
definitions with checked schemas/examples. The counts below describe the saved
increment-05 baseline. Its 132 domain-oracle/review bundles remain unresolved;
none of the supplemental definitions is an independent approval or passing test.

Status: saved boundary drafts; **not implementation-ready**. No production code,
UI feature, provider operation or independent product qualification is delivered
by this increment. Revision-4 architecture remains authoritative.

## What now exists

The [register](WORK-PACKAGE-INDEX.md) links 132 separate JSON drafts, one for
every existing task. They preserve the exact 480 original scenarios and their
IDs, dependencies, screen obligations and named command/event obligations.
Each supplies a task-specific primary payload, strict request/result/error
schema and examples, form controls, eight UI states, transaction and permission
rules, recovery constraints, seven cross-cutting fixture categories, child-slice
sequence and intended implementation/test paths. High-risk tasks also have
specific counterexamples for semantic edits, bitemporal history, claim compilation,
effect races, quorum, source cutover and irreversible recovery.

The machine-readable index binds saved drafts to content hashes. The checker
verifies source fidelity and schema examples, rejects stale materialization and
prevents pending drafts from satisfying the implementation-start guard. It is a
planning validator, not a production domain or authorization engine.

## Honest remaining gaps

**205 explicit decisions remain:** 132 domain-fixture/review decisions and 73
additional named operation contracts. The latter appear individually in the
register and task drafts. This is not a complete count of future engineering
decisions: review may reveal further operations, fields and failure modes.

The primary payloads are boundary proposals, not complete schemas for every
aggregate in a feature. The named records must map to the canonical A-05/C-01
families; they must not become 132 disconnected stores. Draft event names must
be reconciled with canonical domain events. Payload enums describe the example
boundary, not a claim that other enterprise concepts are unsupported.

The 480 domain fixture entries currently preserve scenarios and declare that
independent datasets/output oracles are required. They are **not runnable tests**.
Generic authorization/replay/restart examples do not implement these scenarios.
No agent may count mapped IDs, schema validation or boilerplate fixture checks
as domain acceptance. A reviewer must turn each scenario into independently
checkable persisted/event/effect assertions before the corresponding slice is
approved. Some tasks will require several contracts and migrations, not one
file or a single generic command.

No independent reviewer has been supplied or impersonated. The approved
architecture `packages` list remains empty. All 132 tasks and all original
acceptance statuses remain planned/not_run. Customer-specific authority,
residency, retention, interpretation and provider choices require the existing
authorized-owner process. They cannot be invented by an implementation agent.

## Review and implementation protocol

1. Open one task, its draft and its source documents. Verify dependencies and
   choose a bounded actor journey. Do not start all tasks in numerical order.
2. Resolve the draft's open decisions. Expand every required operation used by
   that journey: exact request/result/error, allowed transitions, role/scope
   matrix, temporal/version preconditions and emitted/consumed events. Register
   typed references and canonical ownership; do not duplicate identities.
3. Author domain fixtures independently of implementation: initial rows/revisions,
   principals/grants, actual command inputs, expected stored rows/outbox/artifact
   bytes, prohibited effects and recovery checkpoints. Keep original scenario
   text and IDs. Add concurrency schedules and tenant-negative assertions.
4. Obtain legitimate independent review. Record actual reviewer, disposition,
   source revision and review receipt. Resolve safety-critical ambiguity. The
   review must inspect source meaning, not just accept a passing schema checker.
5. Register bounded approved packets and prerequisite receipts. Only then change
   task status. Implement contract tests → durable domain/API → real UI → real
   boundary/recovery tests. “Domain” may be a pure view function for read-only
   tasks; do not manufacture database writes or a new backend for those tasks.
6. Verify actual results, reload/restart and denied paths. Preserve raw results,
   environment/fixture/provider versions and revision. Complete a parent only
   after every original scenario and every child operation has passing evidence.

`expectedVersion` is the aggregate concurrency fence; `expectedHead` is the
branch baseline fence. Neither replaces the other or the current security,
policy, dependency-generation and placement epochs. Read queries serialize
their input in query parameters, never a GET body. A payload `tenantId` used as
an administrative target does not establish authenticated tenant authority.

## First bounded implementation candidates

T-01 and T-02 have no backlog dependencies, but still require reviewed packets.
They can be elaborated without first building the entire SaaS backend.

For T-02, the observed defect is concrete: `public/platform.js` uses fallback
empty arrays on fetch failure and `executionRuns.length || 1`, so an empty
successful response renders a nonzero badge and a failure loses its meaning.
The eventual implementation must preserve per-endpoint loading/fresh/empty/
stale/unavailable state for the three existing endpoints, remove fabricated
counts, and label example actions as previews. Browser fixtures must inject
empty responses, each endpoint's independent 503, delayed/out-of-order requests
and recovery; inspect all affected widgets, not only the badge. Canonical gate
data needs an explicit safe read contract or a clearly labeled revision-bound
build snapshot. Do not pretend that endpoint already exists. This review does
not fix the UI or establish an authenticated tenant boundary.

Then select RS-01 (design change) or RS-02 (new enterprise) with prerequisite
closure and one reviewed vertical slice. Do not leap from a truthful catalogue
to unqualified provider dispatch. RS-03 migration, RS-04 SaaS administration,
RS-05 Sentinel/SDLC correction and RS-06 business operation remain mandatory
for the full target, along with the earlier source and qualification suites.

## What “fully enterprise ready” will mean

The application must demonstrate the scoped business inventory and actual
human/agent/external work, not merely represent records. It must maintain
consistent canonical knowledge across all ten edit entry points and all sixteen
perspectives; accepted changes invalidate affected authority/evals immediately,
without rewriting historical evidence. SaaS and customer-owned installations,
coexistence migration, support access, restore, upgrade and exit all need their
own observed results. Unsupported work remains explicitly unsupported.

The original 12 private gates, 16 production gates, source acceptance, portfolio
journeys, 18 architecture invariants and eight SaaS journeys are not passed by
these drafts. “100%” can only refer to a dated, reviewed business scope with an
explicit denominator and no critical unknowns; it cannot guarantee discovery or
automation of every future real-world enterprise behavior.
