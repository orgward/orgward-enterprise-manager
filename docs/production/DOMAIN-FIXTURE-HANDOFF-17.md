# Final original-scenario elaboration and implementation handoff — checkpoint 17

Definitions only, not a production implementation, independent approval or release.
[Customer scenarios](../product/ACTIVATION-CONSISTENCY-INTERACTIONS-17.md).

## Coverage reconciled

This slice covers T-120–T-122 and T-124–T-132: **48 original scenarios, 244
expected observations**. T-119 and T-123 already have earlier high-risk vectors.
Across checkpoints 07–17: **480/480 original scenarios, 2,608 observations,
132/132 tasks**, with no original task or acceptance ID missing from this layer.
The source-bound registry retains the original acceptance-sentence hashes.
The checker now also enforces exact one-to-one coverage of the canonical criteria;
missing vectors, duplicate coverage and a newly added uncovered criterion are
three rejected self-test mutations. This is definition integrity, not acceptance.

This closes the *original scenario-definition pass*, not all engineering detail.
All 132 boundary drafts still require bounded contract integration and legitimate
independent review. Approved implementation packets: **zero**. Actual enterprise
acceptance runs: **zero**. Original tasks remain planned and criteria not_run.
The 16 additional WF obligations, 28 Sentinel rule trigger/control pairs, 18 AI
invariants, Q/PQ/SQ journeys and ES/F/PC/X/R/AT coverage are separate obligations;
480 is not a replacement denominator for them. The current demonstrator's passing
regressions do not prove the target enterprise architecture.

No new research. Reused the brief/release gates, architecture A-01–A-10, CP-01–06,
MC inventory/migration, SQ qualification, original drafts, supplemental operations,
workflow ADR and earlier handoffs. Earlier definitions, canonical backlog and
architecture stay byte-identical. No runtime/UI source changed in this increment.

## Task contract integration map

| Task | Existing operation boundary | Evidence required from implementation |
| --- | --- | --- |
| T-120 | RequestActivation, ValidateOperatingScope, AcceptMigratedScope, ActivateBusinessScope | Exact scope/inventory/control/run manifests, separate acceptance/enablement, containment and historical sign-off |
| T-121 | RegisterOperation, PreviewChange, SubmitChange, QueryCommandResult | Ten surface adapters into one registry, request canonicalization, permission/schema parity, durable replay/current read authorization |
| T-122 | RegisterDependency, ComputeImpact, EvaluateConstraint, ResolveImpactConflict | Field-aware fixed point, explainable paths, complete impact fence, conservative unknown sensitivity, untracked dynamic inputs |
| T-124 | SetFreshnessPolicy, ReconcileSource, ProposeObservedChange, RepairDependency | Bound-time freshness, exact manifests, observed/accepted separation, gap intervals, current consumer generation |
| T-125 | RegisterDomainType, RegisterRelation, RegisterConstraint, PublishActionTemplate, MigrateDomainSchema | Canonical typed namespace, compatible rules/forms/actions, inert publication, migration previews and active-run pins |
| T-126 | PublishActivityForm, StartCase, SubmitHumanTask, ScheduleActivity, RecordPhysicalResult | Real worker forms, timers/checkpoints, typed outputs, provenance, replay/restart and owned blocked work |
| T-127 | InstantiateTemplate, RunTrainingSandbox, ReviewRoleReadiness, EnableAutonomyTier | Reviewed assumptions, isolated practice, current role/provider eligibility, bounded-live capability and accessible non-map route |
| T-128 | RegisterScenario, GenerateQualificationMatrix, ValidateArchitectureProfile | Reproducible legal values/pairs plus mandatory intersections, explicit exclusions, source-bound staleness, actual support matrix |
| T-129 | RunTenantIsolationSuite, RunFairnessSuite, RunCellFailover, RecordSaasQualification | Actual managed topology/public edge, per-tenant load/abuse isolation, raw latency/fairness/failover/usage evidence |
| T-130 | RunMigrationJourney, RunConsistencyRaceSuite, VerifyCoverageCertificate | Two unrelated brownfield estates plus greenfield, ten-entry-point races, writer/effect evidence and cross-product propagation |
| T-131 | ValidateWorkPackage, StartImplementationPacket, AttachAcceptanceEvidence | Concrete files/contracts, authentic independent review, dependency receipts, stale packet guard and real done evidence |
| T-132 | AdjudicateEnterpriseSaasRelease | All original and expanded obligations, independent scoped release review, supported-mode customer operation/export/restore |

Task numbers are not execution order. T-120 requires T-127, T-117 requires T-124,
and final qualification requires dependency closure including T-106. Definitions
do not satisfy any prerequisite. A split must preserve parent obligations and
explicitly revalidate dependency edges; no temporary stubs to bypass the graph.

## Activation is a separately governed business change

Bind activation request to tenant/workspace/legal scope, mode, inventory version,
baseline, six-axis coverage assessment, process versions, eligible performers,
resource reservations, qualified controls, actual run evidence, residual gaps and
named reviewers. Every reference resolves under current permission and recorded
schema/version. A caller-supplied reviewerRef is an identifier, never proof of
review. Independent acceptance binds these immutable digests and validity window.

Request → validate → independent acceptance → activation are distinct commands.
Validation proves the requested scope/mode; sandbox evidence alone cannot qualify
production adapters or authority. Acceptance does not start schedules. Activation
atomically rechecks current inventory/context/security/policy and commits scoped
enablement, idempotent schedule intent, result, audit and outbox. Each actual
dispatch rechecks authority. Another source discovery between review and commit
makes the request stale rather than extending what was approved.

The optional-dashboard gap in AC1 is explicitly nonmandatory and does not affect
controls or required accessibility. Critical unknowns, unstaffed required work,
unsupported effects and untested mandatory controls cannot be signed away. Scope
exclusions need the existing authorized applicability process, not an agent's
assumption. Keep represented, enabled, tested and observed counts separate.

Hypercare failure reopens current applicability and invokes the versioned
containment policy for affected work. Unaffected work is not indiscriminately
stopped. Already accepted irreversible actions stay reconciliatory; historical
certificate bytes and original approvals remain immutable. Users see the failed
measure, scope, owner and allowed recovery, not a silently disappearing badge.

## One semantic command path and explainable impact

The ten canonical sourceEntryPoint values are conversation, form, graph, matrix,
bulk, api, connector, migration, workflow_result and accepted_learning. Chat and
canvas are UX names for conversation/graph. The entry-point label is diagnostic,
not a capability. Import/connector/workflow observations cannot become accepted
authority without their review path. Bulk work has explicit atomic/partial mode
and per-item errors; it cannot bypass the same invariant checks.

T-121-AC1 defines 40 rows: ten adapters × valid/schema-invalid/permission-denied/
invariant-violated. Each row starts from a fresh identical authoritative seed;
compare normalized semantic inputs/results, not differing transport IDs or an
aggregate success counter. Observe actual handler selection, stored state and
outbox. RegisterOperation accepts only deployed, pinned handler identifiers; no
tenant executable code, arbitrary filesystem path or authorization interpreter.

Canonical command identity is scoped by tenant/operation/commandId. Hash the
entire normalized semantic request including preconditions; changed content under
the same key conflicts. Query/replay returns the original durable result only
under current read authorization. Identity and tenant routing derive from the
authenticated session; duplicate branch/head fields must agree or fail schema/
precondition validation. Layout preferences have separate storage and schema;
embedded authority fields are rejected even under an otherwise valid layout call.

Register each derived input with object/revision/field/scope/kind/transform and
actual dynamic retrieval manifest. Dependency capture is part of derivation,
not guessed after computation. Traverse reverse edges over the CP visited tuple
to a fixed point with deterministic sorted paths. Cycles are legal; scheduling
cycles still require the workflow's termination rules. The AC3 four-node closure
includes the changed source reached again through the cycle, deduplicated once;
the manifest distinguishes source and dependent paths rather than hiding it.

The budget-2 traversal remains incomplete. A continuation may finish only against
the same pinned input generation or restart on the new generation; it cannot
combine partial results from different heads. Protected publication is blocked
until complete, including when a caller or projection claims no further impact.
Unknown field sensitivity invalidates conservatively. Known view-only edits do
not invalidate grants; label-sensitive generated text does become stale on rename.
Missing dynamic input capture yields untracked and blocks mandatory protected use.

T-123's atomic publication/invalidation barrier remains authoritative. Preview
success is not a published baseline; publication is not a current evaluation;
current evaluation is not enablement. UI projections expose generation/watermark
and preserve initiating lens/selection. Hidden objects cannot leak through counts,
dependency paths, diagnostics or export; authorized redaction needs explicit policy.

## Reconciliation and consumer freshness

Evaluate freshness at a bound server time against the authorized source policy,
not an arbitrary TTL supplied by an untrusted caller. Observation coverage has
expiry and source manifest independently from accepted fact validity. Test just
before, exactly at and just after expiry; `now >= expiresAt` is expired. Clock
uncertainty outside the permitted profile means unknown/stale for protected use.
An outage is not deletion. Deletion requires an evidenced source tombstone and
the accepted change/retirement protocol where appropriate.

AC1 explicitly distinguishes current-with-evidence, current-asserted, proposed,
stale, contradicted and missing. Historically-valid and unsupported remain part
of the wider contract, not aliases for those states. Multiple contradictions
may be accepted compiler inputs while protected use remains denied. Source
behavior violating a control creates finding/proposal; it never self-approves
that behavior as a new policy. Steward ownership repair and Sentinel recompilation
remain linked to the same model identities.

Periodic reconciliation compares identity sets, counts, content hashes and source
cursors. A high event number is not proof of contiguous coverage: AC3 receiving
s3 without s2 retains the gap until an authoritative manifest supplies s2. Replay
deduplicates source/revision identity, preserves gap interval and old evidence,
and advances validated coverage only after exact reconciliation. Source authority
still determines which changes are proposals; sync never invents approval.

Repairing a mapping refreshes only consumers recomputed from matching inputs.
An old job cannot replace the current head; a still-missing source remains missing.
Historical evaluations retain their original context and a distinct current
applicability record. Recompute can restore derivation validity, not fabricate a
new real-world observation or qualifying control run.

## Custom concepts and everyday work

Customer types extend canonical object/relation/version/provenance families under
a tenant-owned namespace; they do not create a second identity or permissions
model. The Inspection example needs a resolved sample reference, decimal unit,
versioned decision enum and reviewed temperature range. Packet integration must
specify exact values/precision/nullability/units and relation endpoint types;
fieldNames alone is not a complete schema. Forms and diagrams use the same typed
definition. Customer constraints use the restricted deterministic interpreter,
not JavaScript, network calls or model-generated authorization.

Registration/publication does not grant capability or install arbitrary code.
Canonical authority/deny precedence and reserved namespaces cannot be overridden.
Action templates reference certified adapters, typed inputs/outputs, declared
effects, budgets and compensation rules. All custom actions retain Warden checks,
Arbiter review, Overseer fences and Ledger durability at the shared effect broker.
AC4 attempts real dispatch in eligible and denied cases: zero effects without an
attempt would not establish any denial. Required-module outage fails protected use.

Schema evolution is versioned migration, with exact affected IDs, transform hash,
validation/quarantine and restart checkpoints. A required new value cannot be
invented. Stage transformations before publishing a valid successor; old revisions
and in-flight cases keep their pins. Moving a live process requires the separately
approved WF migration plan with full history/checkpoint/fence evidence. A schema
upgrade is not permission to change a running workflow or resubmit remote work.

The workbench exposes assigned work, due dates, validated forms, partial drafts,
dependencies, checkpoints, outputs, effect status and owned next actions. A human
submission binds actor, case/task, form version, checkpoint, typed output references
and attestation. Attachment upload alone is not task completion: classification,
hash, scanner/retention checks and required output/control rules still apply.
Missing performer/adapter/output remains blocked, with partial work recoverable.

Timers store local expression, named timezone, selected offset/disambiguation,
pinned timezone-database version, resolved UTC instant, calendar version and stable
logical occurrence ID. AC3's first 01:30 at offset -04:00 resolves to 05:30Z; the
second occurrence is not another firing for that scheduled one-shot. Pin/verify
the release timezone dataset during implementation. Spring gaps require an
explicit reject/shift policy, never an arbitrary silent choice. Recurrence changes
create new versions; unique occurrence identity plus lease fencing prevents replay
from generating two transitions. External effects still require reconciliation.

Human-attested physical completion is valid evidence *of that attestation*, not
automatically a sensor reading, independent inspection or business outcome. Typed
provenance survives views and exports. Unsupported physical automation stays
visible and may use an explicitly approved manual route with its own controls.

## Role adoption and configurable SDLC

Role templates instantiate draft scope/instructions/assumptions, never active
grants or unquestioned industry interpretation. Practice has isolated data,
credentials and effects. Readiness binds role, scope, instructions, provider/model,
evaluation profile and process version; material changes invalidate affected
eligibility and queued dispatch. A commercial tier or passed tutorial is not a
business authorization. Propose-only, sandbox-execute and bounded-live retain
their existing enum; a human checkpoint is policy within a tier, not a new tier.

List/form and map routes reach identical IDs, evidence and permission decisions.
Worker terms explain the action without requiring architecture vocabulary. Test
keyboard/screen-reader operation, reload, validation, denied access and recovery
with actual people under Q/PQ, not only DOM selectors. Accessible structured
workflow editing remains equivalent to the diagram, including bounded loops,
substeps, criteria and review. No fixed S0–S11 runtime satisfies this requirement.

For SDLC, editing review/retry steps creates a new workflow definition. New runs
pin the approved version; old runs retain theirs unless a safe reviewed migration
is performed. Accepted business/design correction invalidates affected context,
tests, reviews and queued effects immediately. Sentinel findings route proposed
repairs to SDLC; generated code never approves its own release. Actual executable
build/test/deploy runs remain isolated, budgeted and broker-governed.

## Qualification matrix and release evidence

Version the support dimensions, allowed values, constraints, mandatory scenarios,
high-risk intersections, generator algorithm and seed. The small AC1 matrix has
three binary dimensions: eight legal triples and twelve cross-dimension value
pairs (three dimension pairs × four value pairs). Its oracle independently
enumerates those sets. Add constrained fixtures with genuinely prohibited pairs,
reviewed reasons and proof that no legal mandatory case was suppressed. Generator
stability alone is not coverage; minimal row count is not an acceptance requirement.

Pairwise selection supplements all mandatory source scenarios, PC/X intersections,
ten edit entry points and high-risk fault schedules. It cannot exclude a requested
capability to reduce test cost. Newly supported concept/source/region/topology
invalidates affected selections and qualifications. Report declared, tested,
qualified and unsupported combinations separately. A matrix file is not execution.

Managed qualification uses actual authorized test infrastructure and public-edge
sessions, not a self-host report with a new mode label. Reuse Q/PQ: 100 concurrent
users, ten workspaces with 10k objects/50k edges each, 100k audit events, 1000 queued/
ten running jobs, full 100k-claim compilation <=120s (ten warm/three cold), 24-hour
soak and query/command/UI targets. Retain all rules and error/timeout samples.
Declare how workspaces map to ten tenants and preserve per-tenant normal/protected
capacity under idle/interactive/import/compiler/bursty-agent loads. Thresholds and
workload proportions are fixed *before* measurement, never selected after results.

Check query p95<=500ms/p99<=2000ms, command acknowledgment p95<=1000ms, initial
screen<=3000ms and 1000-node neighborhood<=2000ms, plus existing throughput and
recovery obligations. Measure each eligible tenant/cohort; an aggregate average
cannot hide starvation. Abuse tests include routing/storage/search/logs/support/
streams/retrieval/export and side-channel counts, not just the private-marker
assertion. A canary marker is one detector, not a proof of universal nonleakage.
99.5% monthly availability needs its own longitudinal window, not a 24-hour claim.

HA failover must preserve acknowledged authoritative state/evidence and reconcile
usage/effects; there may be a fenced zero-writer interval, never two eligible
writers. Backup-disaster recovery separately measures RPO<=900s/RTO<=14400s and
explicit gaps, not an impossible blanket zero-loss promise. Qualified queue
recovery remains <=60s after eligible lease expiry; revocation/cancellable
acknowledgment <=30s does not permit a known current denial to wait 30 seconds.
Unknown external operations are looked up/reconciled before retry; no exactly-once
remote guarantee. No real billing, customer outage or production deployment is
authorized by these fixture definitions.

T-130 uses repair-estate and software-estate plus greenfield, matching the existing
operation enum. Materialize unrelated source structures, identity collisions,
historical schemas, attachments, active work and independently known manifests.
Preserve broader Q/PQ financial and nonfinancial fixtures; these three do not
replace them. AC2 defines 60 rows: ten entry points × authority/classification/
process edits × commit-first/dispatch-first. At commit-first, old approval cannot
dispatch even if every projection lags. Dispatch-first may already have accepted
remote work, which must be retained/reconciled, not falsely counted as a bypass or
retroactively cancelled. Record barriers at durable broker/provider boundaries.

T-131 test-only packet aliases resolve to valid task IDs in isolated test plans;
never add fictitious tasks or approvals to the real registry. Fixture-kind labels
map to the existing contract enum (cross_boundary/end_to_end), not new competing
values. Review evidence has authentic reviewer identity, independence, exact
source/packet digest, findings and disposition; a string reviewStatus is not proof.
Decomposition preserves every parent acceptance ID; source drift reopens affected
review. Evidence attachment alone cannot mark a packet or parent done.

T-132 requires every mandatory family and exact supported installation manifest.
The hypothetical fully passing fixtures must be materialized using genuine future
results; do not synthesize passing receipts to test a real release registry. Unit
adjudication may use isolated fake artifacts explicitly labeled synthetic, but
that is not AC1/AC4 product qualification. Freeze binds scope/evidence generations;
new critical discovery before publication invalidates old approval atomically.
After an actual release, retain historical certificate and issue current-scope
advisory/containment plus a new candidate, never rewrite the published evidence.

## From vectors to implementation: bounded next work

No further blanket pass of original scenario prose is needed before selecting a
foundation packet. Contracts are already included, but their *integration* is
still required per slice:

1. Select a bounded T-01 contract slice and/or T-02 truthful-demonstrator slice;
   both have no backlog prerequisite tasks. Preserve all parent ACs and identify
   the slice's exact contribution. Do not start every task in numerical order.
2. Merge that task's draft, supplemental operations, vectors and applicable WF
   obligations into one concrete packet. Resolve full aggregate/input/output/
   error schemas, invariants, canonical ownership, migrations, indexes, transactions,
   current permission matrix and recovery. Resolve schema/example discrepancies
   explicitly before approval; old drafts are not automatically superseded code.
3. Materialize complete independent seeds: principals/grants, denied tenants,
   revisions, source manifests, typed values, dependency graphs, clock/fault barriers
   and provider fixtures. Vector aliases are not seed records. Record exact command
   inputs and expected stored rows/events/artifact/effect lineage.
4. Implement or specify the test observation adapter against actual store/API/UI/
   provider evidence. Never import expected vector values into the collected result.
   Record each matrix row and phase, count actual attempts, reject missing rows,
   and collect independently derived booleans/counts plus raw traces. Sorting in
   vector arrays is canonical lexical order unless the vector defines sequence.
5. Bind actual existing packet/fixture files, non-goals, UI states, evidence commands,
   topology/version decisions and dependency receipts. Acquire genuine independent
   review; resolve safety-critical findings. Register approved packet only then.
6. Build contract tests → repositories/migrations → commands/events/jobs → API/UI →
   denied/concurrent/restart/real-adapter journey. Attach revision-bound results and
   review before completing any child or parent. Stop at the authorized increment.

Concrete T-02 example: a successful empty run response displays zero, a 503 shows
unavailable (or labeled last-good data), a slower obsolete response cannot replace
newer state, and sample actions remain labeled previews. Verify every affected
widget through actual browser responses, not only a badge. This does not require
pretending tenant isolation or a full SaaS API exists. A packet must honestly use
an existing route or a separately specified safe read contract.

Concrete design-change example: first pin typed process/owner/authority records and
expected dependency closure; then implement transactional changes and immediate
invalidation; then show impact in the form and diagram; then race publication with
dispatch and restart. A graph-only edit is not the completed parent story.

Customer-specific authority, industry applicability, retention/residency/provider
credentials and commercial choices remain explicit owner configuration. Agents
may choose ordinary implementation details under the ADRs, not invent those
approvals. Additional discoveries become traceable scoped work rather than a
claim that 480 definitions exhaust every possible enterprise scenario.

This checkpoint ends the original definition pass. Next is a small foundation
packet integration/review increment, not autonomous broad runtime implementation.
