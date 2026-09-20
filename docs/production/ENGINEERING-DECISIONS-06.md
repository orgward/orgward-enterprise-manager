# Engineering decisions and task assignment — increment 06

Follow-up: [DOMAIN-FIXTURE-HANDOFF-07.md](DOMAIN-FIXTURE-HANDOFF-07.md) elaborates
38 scenarios across 11 tasks with 226 expected observations. No application
acceptance or independent review is claimed; 442 scenarios still need vectors.

User authority: make the design decisions and fill implementation gaps. The
decisions here fix engineering defaults; they do not assert independent review,
customer authorization or product qualification. Existing outcome/architecture
contracts remain binding. No new feature is delivered by this document.

## Model assignment

Use **Terra High** as the default implementation worker for a bounded reviewed
slice. Use **Sol High** for design, ambiguous integration and security-sensitive
work, and **Sol XHigh** for concurrency, temporal consistency, irreversible
effects and migration/cutover. Use **Luna Medium** for a tightly specified leaf
task: isolated UI controls, fixture transcription, narrow mechanical refactoring
or documentation. Luna must not independently decide authority, schema
migrations, state-machine safety or acceptance criteria. Low is for mechanical
formatting or extraction with deterministic validation, not full-stack stories.

These are project recommendations, not measured OrgWard model benchmarks.
The [official model guide](https://learn.chatgpt.com/docs/models) describes Sol
for complex work, Terra for everyday work and Luna for clear repeatable work;
it recommends raising effort when deeper planning/checking is needed. Max is
an escalation for a demonstrated hard unresolved problem, not the default.
Ultra involves delegation and is not equivalent to a stronger single-worker
setting; use it only under explicit authorization and separable tasks.

`contracts/enterprise/agent-assignment-policy.json` assigns all 132 parent tasks.
No parent is assigned to Luna: its allowed work is a reviewed leaf slice within
a parent. A separate reviewer checks independently derived expected outcomes;
another model's agreement is not enterprise security certification. Do not
delegate or change session configuration merely because this recommendation
exists. Pin available model IDs/settings in each run receipt; do not invent
availability, credit limits or comparative success rates.

## D-01 — One state model, separate readiness dimensions

Keep object identity stable across every lens; edits create immutable revisions.
Store `designState`, `reviewState`, `enablementState` and `evidenceState`
separately. Inventory coverage, representation, constraints, runnable work,
tested controls and measured outcomes have separate versioned denominators.
Certificates bind scope, purpose, evidence cutoff and expiry. A complete diagram
does not certify an operating business. New discoveries invalidate current
applicability without erasing historical certificates.

## D-02 — Command and reference contracts

Use a discriminated operation registry, never arbitrary table CRUD. Every input
field has a registered schema and typed target, with tenant/workspace validation.
`expectedVersion` is the aggregate fence; `expectedHead` is the branch fence.
The operation-specific schemas in the supplemental catalogue describe payloads
and aggregate command fields; semantic edits additionally inherit CP-01 context
and preview binding. A command cannot default a missing fence to current.
Queries have URL-encoded parameters, no GET body; no command replay on reload.
Authenticated context is server-resolved; target selectors are not authority.

## D-03 — Persistence and write ordering

Retain Node ESM modular control plane, PostgreSQL authority/jobs/outbox and
S3-compatible immutable artifacts. Use canonical A-05 families, not a new store
for each task. Tenant-leading keys and composite scoped foreign references are
mandatory; repository checks and database row isolation both apply. Mutable
heads point at immutable revisions. Lock affected heads in stable ID order and
check the authoritative mutation generation before commit. Serialization failure
retries the transaction with the original command identity; changed payload is
a conflict, never a new implicit command.

Store domain changes, command result, audit intent and outbox atomically. Network
effects happen outside the transaction through a fenced broker. Invalidation
is part of publication, not a later job. Index `(tenant, operation, commandId)`
uniquely, plus tenant/object/version, reverse field dependencies and scoped
state/time cursors. Specialized graph infrastructure is optional/rebuildable,
never the authority for permission or current revision.

## D-04 — Scope, time and merges

Use explicit tenant/workspace/legal scope; unknown scope is neither global nor
disjoint. Valid time and recorded time are separate UTC instants; store business
timezone on calendars. A late observation never backdates recorded history.
Three-way merge is field-aware against base/current/proposed revisions. Conflicts
on the same semantic field require explicit resolution; label similarity never
merges identities. No silent deletion cascade across obligations/history.

## D-05 — Permissions and approval

Deny by default. Deterministic restricted policy interpreter; immutable deny,
explicit deny, obligations/quorum, then positive grant. Missing mandatory data
denies/escalates. No model or extension code participates as an authority oracle.
Reviewer independence is evaluated by accountable principal/delegation lineage,
not account label. Approvals bind request/artifact/environment/config/context,
policy and expiry. Entitlements, support roles and chosen UI persona do not grant
business action authority. Fresh server-side checks apply at every effect.

## D-06 — Identity, recovery and support defaults

Enterprise identity mappings are allowlisted and versioned. Domain verification
does not auto-link users across tenants. Revocation increments security epoch;
all protected reads/downloads/streams and effects validate current eligibility.
Two independent configured custodians are required for owner recovery. If that
recovery configuration is absent, the product exposes an onboarding blocker,
not an undocumented operator backdoor. Support needs customer-approved resource,
purpose and expiry; default support view is redacted health only.

## D-07 — Effects, retries and execution

Each effect needs intent, capability, budget reservation, target/config/input
digest, current policy/context/cell epoch and a qualified adapter. A timeout
after dispatch means unknown outcome; reconcile by provider operation ID before
retrying. No exactly-once remote promise. Lease fencing rejects obsolete workers.
Computations may finish pinned historical work only if policy permits; new reads
or tools after revocation are denied. Pause acknowledgment means safe boundary
reached, not merely that a request was sent. Mandatory checkpoints cannot be
bypassed by an agent, rerun, retry or regenerated plan.

## D-08 — Migration and coexistence

Single writer per type/field/scope/phase. Default identity matching is source
system plus stable source ID, never names. Mapping transforms are deterministic,
isolated and side-effect free. Imports stage immutable source snapshots and
crosswalks; they do not enable grants, secrets, schedules or historical approvals.
Exact counts/hashes/identity/reference reconciliation precedes cutover; sampling
only supplements it. Shadow work has no production effect capabilities.
Drain unsupported in-flight work; bridge only fully supported pinned state.
Fence source before target epoch activation. Unknown effects or changed final
delta block cutover. Irreversible post-cutover work requires forward recovery or
evidenced compensation; restoring an old database is not a business rollback.

## D-09 — Knowledge changes and products

Chat, forms, graph, matrix, bulk, API, connector, migration, workflow outputs and
accepted learning use the same change protocol. Field-sensitive dependency
closure covers semantic, realization, evaluation, authorization, derivation,
observation, operational and view-only edges. Incomplete traversal blocks
protected publication. Context invalidation is authoritative even while views
lag. Source observations propose changes; they never silently redefine accepted
business truth. Sentinel compiles accepted claims deterministically; OADL is an
integrity projection. SDLC pins business intent/context/constraints and returns
observed results and proposed corrections, not autonomous truth updates.

## D-10 — Tenant operations and commercial boundaries

Global registry contains placement/entitlement metadata, not business content.
Provisioning and relocation are resumable jobs with owned-resource manifests.
Unknown resource ownership blocks compensation. Commercial restrictions stop
new discretionary work under configured grace policy but preserve evidence,
export and safe recovery. Usage is immutable and deduplicated; reserved,
consumed and uncertain amounts remain distinct. No live payment integration is
enabled by the roadmap. Region policy covers storage, backups and provider/tool
egress; provider fallback cannot weaken it.

## D-11 — Extension and physical-work boundaries

Namespaced typed concepts/relations/forms/actions may extend domain semantics,
not core identity or authorization precedence. Schema migration preserves old
revisions and quarantines incompatible rows. Publishing a template does not
grant its tools. Physical work is human-attested or performed through a qualified
adapter with explicit provenance; no simulated physical completion. Human tasks
have typed outputs, workload/due dates and checkpoints. A software-only enterprise
and a physical/service business must both pass operating journeys.

## D-12 — UX and truthful states

Each widget distinguishes loading, successful empty, fresh, stale, unavailable,
denied, conflict and recovery. Zero comes only from a successful authorized empty
result; examples never fill a failed live request. Preserve draft/selection and
offer compare/rebase after conflict. Every graph action has keyboard/list/form
access and an actual backend command/result. Error and job state must survive
reload. T-02 shall consume a build-generated, revision-bound **public maturity
snapshot** containing only gate IDs/status/evidence labels, not internal paths
or customer data; production live tenant status stays an authorized API concern.
This resolves the previously open safe ledger-source choice without inventing
an existing endpoint. Test freshness labeling and mismatch against the build.

## D-13 — Fixtures, quality and release choices

Expected results are authored independently of implementation. Real database
races, crash boundaries, browser role journeys, isolated adapters and restore
drills are mandatory where the task says so. Stub provider success cannot pass
an actual-effect criterion. Tests bind revision, seed, scope, actor, raw output,
environment/provider versions and unresolved findings. Exact package/image
versions are pinned at installation/release implementation after compatibility
and security checks; do not freeze guessed future versions in this document.
Use existing Q/PQ/SQ load/recovery thresholds; agents cannot lower them after
observing failure. No blanket green status based on a job being accepted.

## Supplemental operation contracts

All 73 named secondary-operation gaps from increment 05 now have an authored
payload, canonical aggregate target, role, state transition, event, invariant,
durable outcome and recovery rule in
`contracts/enterprise/additional-operation-decisions.mjs`.
`node ops/check-design-resolutions.mjs --describe FenceSource` prints the full
strict request/result/error schemas and examples for an operation. Progress
events added here are new explicit contracts; they do not replace the original
terminal events or allow claiming terminal success at job acceptance.

They are **specified, pending review**, not approved handlers. The 132 old
boundary drafts remain immutable checkpoint inputs; their 73 operation-gap
entries are now addressed by this supplement at design level. Parent packets
still need integration of these contracts and domain-specific executable
datasets/oracles, followed by independent review. The earlier count of 205
bundled engineering/review gaps must not be called 205 unanswered customer
questions. No customer decision is needed to author those tests.

## Remaining evidence versus decisions

Do not ask the user to choose ordinary schema/index/error/UX mechanics already
fixed above. Customer choices are explicit configuration records with disabled
protected capabilities until supplied. Independent review and product tests are
evidence requirements, not design choices that can be declared away. All 132
domain-oracle/review bundles remain open; supplying 73 command contracts does
not complete 480 end-to-end acceptance cases or make the whole backlog ready.
