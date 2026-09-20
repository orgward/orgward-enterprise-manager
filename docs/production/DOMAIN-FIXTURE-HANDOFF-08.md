# Foundation and operating-workflow test handoff — increment 08

Historical checkpoint. [Increment 09](DOMAIN-FIXTURE-HANDOFF-09.md) extends this
baseline to 164 definitions across 53 tasks. Counts below describe increment 08.

This increment adds **54 unrun definitions, 339 expected observations, across
T-01 and T-08–T-24**. Together with increment 07: **92/480 scenarios, 565
observations, 29/132 tasks** have the concrete-vector layer. The remaining
**388 scenarios across 103 tasks** still need it. All 480 product acceptance
cases remain unrun; all 132 packet reviews remain pending. This is specification
progress, not production readiness or implementation authorization.

The canonical definitions are `contracts/enterprise/domain-vectors-08.mjs`.
The new `domain-vectors.index.json` binds each batch's expected observations and
every linked original acceptance sentence by SHA-256. The checker rejects
changed scenarios, dropped rows and changed expectations until the registry is
deliberately updated. That integrity check cannot replace semantic review.

## What the next implementer must deliver

Read the original task, its boundary draft, applicable supplemental operations,
architecture/change protocol and both fixture handoffs. Preserve dependencies;
these definitions do not make prerequisites implemented.

Before implementation, complete and independently review a bounded packet with:

1. Actual JSON Schema/OpenAPI/event contracts and **materialized valid/invalid
   seed bytes**, including required fields omitted from the scenario's concise
   initial state. Resolve refs, schema versions, authority and unit registries
   explicitly. Do not use a permissive fixture factory that invents owners,
   credentials, grants, approvals, supplier validity or evidence.
2. A per-case table mapping each original acceptance clause to vector steps,
   expected observations, source tables/events and browser controls. A vector
   ID alone is not proof that every clause is sufficiently specified. Add
   reviewed cases where the matrix exposes missing behavior.
3. Implemented observation adapters at the intended `tests/acceptance/` paths,
   real persistence and dependency/fault barriers. Those test files **do not
   exist yet**. The vector module itself is not a test runner.
4. Exact environment/profile/provider versions and commands; inputs and raw
   traces hashed into the acceptance receipt. Real model calls need their
   approved provider environment; fault adapters cannot satisfy real-model
   acceptance. No new accounts, purchases or credentials are authorized here.
5. Independent review of schemas, fixtures, adapter source and actual results.
   Never generate a product result by copying the expected assertions or let
   the implementing agent invent a reviewer identity.

### Observation boundaries

| Tasks | Evidence that must be collected |
| --- | --- |
| T-01 | Registered schemas, complete aggregate fixture inventory, API/event registry, compatibility runner and old/new consumer bytes |
| T-08 | Clean-host manifest, shipped installer transcript, TLS/identity exchange, dependency probes, independent database readback |
| T-09–T-14 | Browser interactions and accessible state, command responses, immutable revisions/edges, provenance and readiness evaluations |
| T-15–T-18 | Versioned formula inputs, independent decimal arithmetic, resource/budget ledger, assignment/grant/instruction versions |
| T-19–T-20 | Typed plan, trigger keys, task/attempt rows, real lease/fence transactions, outbox and separately recorded effect acceptance |
| T-21 | Host-side isolation/network/resource probes, process lifecycle, grant revocation and artifact quarantine records |
| T-22–T-24 | Real provider receipts, exact artifact bytes, independent rubric, approvals, interventions and end-to-end lineage after restart |

For boolean observations such as `schemaValid`, `freshAuthorization` or
`realAgentArtifactUsable`, the adapter must derive the value from the cited
raw records and independent validator/rubric. Reading an application “pass”
badge is insufficient. `missingLinks: []` requires enumerating the expected
link set and all actual records; it cannot mean that no query was made.

### Matrix and fixture conventions

- Every listed fault/mutation executes, normally from a fresh seed. Report a
  raw case result per row; aggregate zero-violation assertions require **all**
  rows to have run. Single counts are per case unless explicitly a matrix total
  (`casesRejectedBeforeBootstrap`, `deniedCount`, `testedDefects`). Do not sum
  repeated clean-seed row counts or omit failures to manufacture expected values.
- T-24-AC3 is deliberately one ordered compound recovery journey: capacity
  failure, guide-v1 generation/rejection, guide-v2 evaluation/approval, restart
  after result commit, completion replay. Thus both artifacts and the rejection
  rationale must exist; they are not fabricated for an unrelated resource test.
- C-01 inventories 24 named types in 12 aggregate families. Validate all fields
  and typed references, not merely these type names. Reference mutations that
  are genuinely inapplicable require a schema-path explanation. This increment
  does **not** provide the full 24 materialized schema fixtures or freeze those
  schemas; that remains a concrete T-01 packet prerequisite.
- Treat fixture identifiers/digests as symbolic names resolved to actual fixture
  IDs and content hashes. Record the mapping. Hash real artifact bytes; do not
  weaken production digest validation to accept strings such as `guide-digest-v1`.
- The test IdP/canaries and worker attack probes use isolated synthetic targets.
  Do not probe real host secrets, customer objects or external networks.
- Sets use stable order for comparison. UI order, process dependency order,
  event sequence and economically meaningful units must not be normalized away.
- All repeated runs pin application revision and registered configuration.
  Business-specific configuration is allowed; furniture/tutoring names cannot
  select hard-coded outputs or bypass validation in general-purpose handlers.

## Decisions clarified by these scenarios

- Installation is an operator workflow with preflight, first-owner identity,
  transactional/replay-safe bootstrap, dependency readiness and durable recovery.
  A development server starting is not a clean-host qualification.
- Facts, assumptions, unknowns, exclusions and imported conflicts remain distinct.
  Corrections produce accepted successors and stale dependent proposals, never
  silently rewriting the evidence that previous work used.
- Capability and process are separate object types. Chat, map, inspector and
  forms operate on shared canonical changes and context, including typed edges,
  dependency impact and explicit concurrent-publication conflicts.
- Readiness counts unknown applicable requirements in the denominator; zero
  applicable requirements is not_applicable, not 100%. Critical blockers cannot
  disappear in an average; expired evidence and newly included scope invalidate
  current eligibility even while a dashboard projection lags.
- Economics distinguish revenue, contribution and operating surplus; explicit
  burn assumptions determine runway. Currency/time/unit conversion requires
  recorded rules. Missing costs are not zero; forecasts are not actual profit;
  nonpositive burn makes this burn-based runway calculation not_applicable.
- Reservations are atomic, typed and reconciled against measured consumption.
  Capacity, supplier validity and money are separate constraints. Retirement
  stops new work and requires handover/reconciliation before archival.
- Accountability, a role title and an enabled tool grant are different things.
  Offboarding fences future authority without changing past actors. Instruction
  changes preserve old attempts and require a newly authorized successor.
- Runnable plans are acyclic typed dependencies. Rework uses bounded linked
  successor attempts, not an unchecked graph back-edge. ApprovedGuide denotes
  the exact reviewed InspectionGuide plus a valid approval binding, not a cast
  from an unrelated ReviewDecision payload.
- UTC coalesce-one scheduling is the concrete fixture here, **not** removal of
  required IANA timezone/DST support. Broader timezone/provider qualification
  must supply its own explicit overlap/gap calendars and tested tzdata version.
- Workers need actual OS isolation, fenced leases, bounded resource use and
  scoped ephemeral credentials. Terminating a local process does not prove a
  remote effect was canceled. Unknown remote effects stay in reconciliation.
- Human review binds exact output/context. Pause requested is distinct from
  effective pause. Cancellation and result commit have one authoritative winner;
  a late worker cannot override a committed cancellation fence.
- Real agent work needs schema-valid useful bytes, an independent rubric,
  versioned context and usage accounting. Unknown charges retain liability;
  retry limits cannot be bypassed by switching billing providers.

## Checks and next bounded work

`node ops/check-domain-vectors.mjs --self-test` validates 92 definitions and runs
92 synthetic positive comparisons, 657 negative comparisons, 13 invalid-vector
rejections and 10 registry/source mutation rejections. The synthetic positives
intentionally construct documents from expected values. They test only the
comparator, **not** any user journey, worker isolation or provider outcome.

Run `npm run check` and
`node ops/check-spec.mjs --self-test --verify-sources` for regression and source
integrity. Retain the original gate states and all historical receipts.

Next specification slice: T-25–T-48, completing the core SDLC/release/operations
layer's 72 scenario definitions. Then continue remaining portfolio scenarios
by dependency and risk, including Sentinel ingestion/evaluation, cross-product
policy/effect coordination, knowledge propagation and SaaS/migration cases not
covered by increment 07. Simultaneously resolve actual schemas and seed bytes
inside reviewable prerequisite packets; growing vector counts alone cannot
make the plan unambiguous or authorize starting all downstream tasks.
