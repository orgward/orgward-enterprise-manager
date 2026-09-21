# Business inventory, SaaS foundation and migration preparation — checkpoint 16

Definitions only; no runtime feature, independent review or product qualification.
[User walkthrough](../product/SAAS-MIGRATION-INTERACTIONS-16.md).

## Scope and source continuity

T-109–T-118 add **40 original scenarios and 200 expected observations**.
Cumulative **432/480 scenarios, 2,364 observations, 120/132 tasks**. Remaining:
**48 original scenarios across 12 tasks** without this layer. Original acceptance
sentences, task/dependency objects and older vector batches remain unchanged.

Reused the first-product brief/gates, A-01–A-10 architecture, CP change protocol,
MC migration/coverage, SQ qualification, workflow ADR/profile, task-specific drafts,
work-package review and existing supplemental operation decisions. Those operations
already specify the additional commands; this checkpoint supplies domain expectations
and integration refinements, not competing APIs or new stores. No new research.
Sixteen WF obligations and final T-132 qualification remain mandatory.

## Contract completion map

| Task | Existing operations to integrate into bounded packets | Actual evidence required |
| --- | --- | --- |
| T-109 | AcceptInventory, AssessCoverage, CertifyScope, ReopenCoverage | Unique scoped inventory and six-axis denominators, facet/mode coverage, reviewed exclusion, discovery/certification race |
| T-110 | RequestTenant, ProvisionTenant, ActivateTenant, ReconcileProvisioning | Actual isolated resource allocation, server placement, immutable ownership manifest, replay/compensation and parity across modes |
| T-111 | VerifyDomain, BindIdentityProvider, SyncMembership, RevokeSession, RecoverOwner | Authentic identity tests, allowlisted mappings, real scoped recovery rehearsal and cross-surface revocation timing |
| T-112 | ConfigureEntitlement, RecordUsage, ReserveQuota, RestrictTenant, ResumeTenant | Immutable deduplicated usage, atomic quota reservations, current authority denials and retained recovery during restriction |
| T-113 | OpenSupportCase, GrantSupportAccess, RevokeSupportAccess, ScheduleMaintenance | Customer-approved scoped grant, operator denials, expiry/current-access evidence, redacted audit and tenant-filtered maintenance |
| T-114 | SetResidencyPolicy, RotateTenantKey, PrepareRelocation, CommitPlacementEpoch | Actual destination evidence, current regional policy, key history, source fence/placement CAS and one eligible writer |
| T-115 | DiscoverSources, ProfileSource, AcceptSourceInventory | Source/team/time inventory, authorized intake, snapshot/cursor reconciliation, explicit informal-work assertions |
| T-116 | ProposeMapping, ApproveMapping, StageBatch, QuarantineRecord, RepairMapping | Typed reviewed transformations, stable crosswalks, per-row errors, exact batch accounting and inert imported authority |
| T-117 | SetSourceAuthority, StartDeltaSync, ResolveSyncConflict, PauseSync | Field/scope writer matrix, allowlisted direction, source gaps/conflicts, stale draft preconditions and preserved provenance |
| T-118 | ValidateMigration, StartShadow, RehearseCutover, RecordRehearsal | Exact identity/hash/reference/history checks, effect-free shadow, complete-state bridge/drain and cutover blockers |

T-117 depends on T-124 even though its number is earlier. Specification may proceed;
implementation cannot use a stub reconciliation service or bypass that dependency.
Prerequisite slices can be explicitly decomposed/reviewed without losing parent
obligations. Start eligibility is not numeric order or the existence of a vector.

## Whole-business coverage without misleading completeness

Inventory manifests bind enterprise/unit/legal scope, source revisions, discovery
window, activity identities, owner attestations, criticality, required facets and
applicability decisions. Include routine, exceptional, informal, strategic, continuity
and wind-down work. Deduplicate evidenced aliases by identity; do not equate a process
node, source record or one appearance in each lens with a distinct business activity.
Composite activities need explicit decomposition and counting policy to avoid counting
both a parent and all children as independent comparable denominator units.

Each required activity carries purpose/customer/outcome, accountable owner/scope,
process/case/decision, inputs/outputs, resources, data/system sources, policies/risks/
controls, measures and execution mode. Modes remain human, internal-agent,
internal-deterministic, external-system, physical-attested or explicitly unsupported.
Different parts of the enterprise can legitimately use different modes and detail
levels. Do not force D5 software implementation for manual D2 activity.

Six independent axes: inventory/discovery coverage, semantic representation, linked
constraints, enabled execution, tested controls and measured outcomes. For a pinned
profile count each applicable required activity once per axis, retain numerator,
denominator and exclusion IDs, and expose cross-dimensional overlap without summing
duplicate identities. The six-activity fixtures are small unit-scoped examples;
full qualification still inventories all contracted dimensions and teams.

No observed windows means unknown outcome, not zero success rate or failure. Six
represented, two runnable, zero qualified and zero observed successes must not become
a combined readiness score. An empty applicable denominator is not automatic 100%:
show not-applicable with reviewed scope evidence, or unknown if inventory is missing.
Externally executed activity may qualify using supported external evidence; it does
not require copying all specialist transactional data into OrgWard.

Certification binds immutable assessment/profile/scope/inventory/evidence digests,
purpose (representation or operation), reviewer and dates. Operation additionally
requires current enabled/tested controls and actual operating evidence. A signature
cannot waive a critical unknown. Exclusion requires legitimate applicability, owner,
reason, review date and impact; score-gaming never removes mandatory obligations.

Discovery and certificate publication use the same inventory generation fence.
Commit new activity plus invalidation/result/audit/outbox atomically before allowing
current completeness use. A concurrent stale certificate attempt fails/reassesses.
Preserve immutable historical certificate bytes while separately marking current
applicability stale. Replay the same source discovery once; no duplicate denominator
increase. Display the new missing activity and owner in every impacted perspective.

## Tenant provisioning and identity

Approved enrollment request owns authenticated requester/invitation, request hash,
requested region/tier/modules, owner invitation, and lifecycle. A server-issued job
identity and request-scoped idempotency uniqueness prevent duplicate provisioning;
same identity with changed inputs conflicts. Clients request placement preferences,
not authoritative cell routing or grants. Resolve membership and current placement
through the trusted registry; reject caller cell/tenant overrides safely.

Global registry contains only necessary routing/placement/entitlement/provisioning
metadata, not business graph, evidence, names from private objects or model context.
Keep sensitive enrollment/support content regional and separately authorized. Test
schema allowlists and actual stored records; absence of one canary alone is not proof
that arbitrary future business fields cannot be added to the registry.

Provisioning is a resumable operation with actual database/storage/runtime/identity
resource receipts and an owned-resource manifest. Never delete a resource based on
a matching display name. Reconcile provider IDs/tags/creation identity before reuse
or compensation; ambiguous ownership pauses cleanup with an owner. Compensation can
fail and must retain its outstanding resources. Do not call the tenant active after
database allocation or erase evidence of a partial allocation.

Activation separately checks current configuration, region, isolation, least-privilege
identity, recovery and module/dependency profile. Tenant activation grants no business
process authority. Self-host and managed paths share schemas/command semantics and
negative tests; differing placement/infrastructure are explicit adapters, not a second
business model. Self-host has no implicit hosted storage or developer credential.

Domain ownership proof is server-verified, timeboxed and bound to tenant/domain/method/
challenge; client strings are not proof. It does not authorize account linking or
make every user with that email suffix an owner. Identity mapping binds trusted issuer,
audience/client and immutable source principal/group identifiers to explicitly allowed
tenant roles. User-editable group/display names cannot supply administrative rights.
Owner assignment needs the approved invitation/membership path, not the first login.

Membership changes commit roles/effective interval/source revision and security epoch
together. Validate current scope at callbacks, queries, streams, retrieval, downloads,
queue claims and broker effects. Browser workspace/persona selection conveys no rights.
Missing/expired authoritative epoch data denies protected access; cached membership
cannot silently extend eligibility. Revocation qualification remains <=30 seconds,
but current known revocation forbids the next access immediately, not after a grace
period. Close/refresh client streams and caches as defense in depth, not sole enforcement.

Recovery requires two distinct independently configured custodians and exact successor
owner/scope proof. A preconfigured separately authenticated recovery path must work
when the main identity provider is unavailable; no new backdoor is invented during
the outage. Missing/conflicting proof blocks recovery. Commit new ownership and revoke
obsolete owner grants under current epochs, preserving work and audit. Test owner
departure and outage separately. Past remote effects remain observed reconciliation
work; revoking a person cannot physically undo an accepted external action.

## Entitlements, quota and support are not business authority

Commercial entitlement controls available modules/limits. It does not grant a release
approval, data access, source ownership or payment authority. Quota reservation likewise
permits resource accounting, not the effect. Current business policy/reviewer/identity/
context checks remain at the broker after entitlement/quota eligibility.

Usage records bind tenant, provider/account/operation, logical usage event identity,
attempt/reservation, quantity/unit, tariff/version where relevant, measured time and
actual/uncertain disposition. Tokens, bytes, compute time and money are separate units;
currency pricing needs an explicit tariff and decimal/minor-unit contract, not a float
sum of token counts. This checkpoint neither configures a live billing provider nor
authorizes charging. Billing/webhook tests use authorized isolated test events only.

Lock quota bucket and uniqueness constraints when reserving; concurrent total consumed
plus outstanding holds plus requested quantity cannot exceed the current limit.
Uncertain holds are a subset of outstanding reservations, not an extra addend. AC1:
reserve 400/200/100, settle first at 300 and release its unused 100; consumed=300,
outstanding=300 (200 queued +100 uncertain), available=400 under limit 1000.
Do not count settled usage and its old reservation twice. Preserve uncertainty through
worker failure, expiry or lost provider response; only known non-dispatch or observed
reconciliation releases that hold. Actual overrun remains measured and blocks new
dispatch; never clip the ledger to the configured cap.

Deduplicate immutable events and operation-attribution keys; identical replay returns
the recorded disposition, changed quantity under the same identity quarantines a
conflict. Avoid double-counting a provider outcome observed through both webhook and
polling. Reservation/provider lineage, not receipt transport, owns the accounting.

Restriction follows a versioned approved grace policy. Block new discretionary work,
preserve current-authorized evidence/export and reserved safety/reconciliation capacity,
and retain already accepted irreversible work until reconciled. These exceptions do
not grant unrestricted tools or bypass privacy. Resume lifts the commercial restriction
only: expired sessions, revoked grants and old approvals remain unusable; queued work
revalidates through the same fences. Failed notifications do not undo policy state.

Support opens with redacted customer-approved diagnostics; no raw business context in
operator dashboards by default. Support grant binds actual operator principal, case,
resource selectors, allowed operations/purpose, customer consent and expiry. Resource
scope alone is insufficient: a read-only diagnostic grant cannot approve business risk.
Operator cannot extend its own grant. At expiry/revocation, new queries/downloads/
streams/effects stop under current checks; redacted session audit stays customer-visible.
Already delivered support content cannot be retroactively unread, so minimize collection
and apply explicit diagnostic retention. Test cached and direct API paths.

Maintenance binds supported release/restore evidence, actual cell, window, safe drain
policy and notification audience. Each customer sees its own affected status, not
tenant lists or private workloads. Notify through outboxed scoped events; no actual
external notifications are sent by this specification. Unsafe drain postpones/escalates
maintenance instead of discarding unknown effects. Preserve recovery capacity and
old compatible interpreters needed by pinned workflow histories.

## Residency, keys and moving a tenant

Residency policy covers database, artifacts, backups, workflow history, logs/telemetry,
search/retrieval, model/provider processing, connectors and support diagnostics. Pin
allowed region/provider profiles and actual destinations, not only a region label.
Unknown provider placement cannot be asserted compliant. Tightening invalidates new
incompatible disclosure/egress immediately; existing data needs evidenced relocation
or an explicitly blocked compliance state, never a false instantaneous move.

Encryption keys, signing keys and access credentials have different purposes and
lifecycles. Record versioned broker-resolved key references, key owner/location, rotation
mode, per-object progress and retention dependencies. A rotate-key command is not
permission to delete the old key. New writes/rewrap, historical decrypt and offline
signature verification need separate tests. Retain required public trust history;
never export private key material or revive access for a revoked reader. Routine
rotation is different from compromise; actual cryptographic library/algorithm/version
selection remains a reviewed implementation concern, not a custom primitive here.

Relocation verifies target data/schema/runtime/artifact manifests and current residency,
drains or bridges eligible work, reconciles unknown effects, fences source and CASes
placement from epoch n to n+1 against exact review/fence receipts. There may be zero
eligible writers during safe recovery, never two. Crash before/after placement CAS
is resolved by current registry state and durable fences, not arrival order or DNS.
Obsolete cells/workers cannot mutate, dispatch or promote stale projections. No
automatic rollback to an unfenced source; restored old credentials remain revoked.
T-119's existing cutover vectors and T-123's consistency vectors still apply.

## Discovery, identity mapping and coexistence

Discovery is scoped read-only intake. Inventory source/team/period, permissions,
revision/hash, cursor/snapshot capabilities, schema/classification, sampling limits,
excluded/unreadable areas and error states. Profiling samples do not establish exact
migration counts. Permission denial is not an empty successful source. Do not send
restricted input to a model just to summarize the denial. Safe gap metadata must obey
the caller's own visibility; hidden field names/counts cannot leak in explanations.

Informal work missing from logs can enter through a dated accountable owner assertion
or interview with its own provenance and discovery action. Label asserted versus
observed. Review acceptance acknowledges an inventory and its unknowns; it is not
full business certification or permission to access additional sources.

Persist admitted source observations and cursor/checkpoint atomically. A cursor binds
connector/source scope, immutable revision or reproducible snapshot, partition and
last acknowledged position. Resume the same snapshot after throttle/restart with
bounded retry. Source drift or expired cursor starts verified resnapshot/backfill
and exposes gaps, rather than pretending collection was uninterrupted. Not all sources
offer historical snapshots; unsupported exact capture remains a visible migration
blocker or explicitly approved quiesced extraction, not invented snapshot capability.

Identity defaults to source system + stable source ID + scope/type, never label. Mapping
binds source/target schemas, typed fields, canonical IDs or durable crosswalks, pure
transform digest, loss/history decisions and independent review. Transform has bounded
resources and no network/secret/effect capability. Do not run arbitrary uploaded code
in the control plane. Approved mapping bytes are immutable; corrections create reviewed
successors and stale validation, preserving old staged/provenance interpretation.

Staging has explicit atomic or partial policy. Partial example: five source rows, four
staged and one quarantined; all five remain accounted. Preserve per-row source identity,
hash, transform/mapping version, output identity and safe error/owner across restart.
No duplicated errors, silent dropped denominator rows or forced name-based merges.
Credentials/secrets in imports are isolated as prohibited sensitive input with controlled
retention and redacted diagnostics, not copied to prompts or enabled connections.
Grant/schedule/connector descriptions remain inert; no historical approval becomes live.
Imported completed work is source-attested, not an OrgWard execution receipt.

Source-of-record matrix is per type/field/legal/business scope and phase, with current
writer, desired target, explicit directions, valid interval, provenance and freshness
policy. Enforce nonoverlap or explicitly reviewed conflict resolution; unknown scope
is not disjoint. OrgWard model ownership, observed external values and effect execution
ownership are related but distinct. A declared external writer does not let telemetry
rewrite accepted authority or policy. StartDeltaSync keeps observations in the proposed
lane; accepted corrections use the shared reviewed change path.

Competing authority/policy edits retain both versions and route a scoped conflict.
Latest timestamp or source popularity cannot settle it. A relevant source delta can
stale a preview's external precondition and dependent approvals before being accepted
as design truth: invalidation does not mean the source proposal won. Recheck observed
source/mapping/authority generations at publication, preserve the user's draft and
offer source/current/draft comparison. Accepted semantic changes invalidate affected
requirements/evals/approvals using the same CP transaction, never a second sync store.

Resnapshot can restore current completeness but not prove unobserved intermediate
events. Preserve the gap interval and any historical assurance limitation; do not
synthesize a missing order fulfilment or authority change from latest state. Pause
acknowledgment waits for a safe batch boundary/current cursor; an uncertain external
write remains separately reconciliatory even if polling has stopped.

## Validation and rehearsal before cutover

Validation pins source/staging/mapping/authority manifests and exact source identities,
counts/hashes, transformed target hashes, references, invariants, classifications and
required history. Approved differences need explicit independent scope/reason/check;
they cannot excuse critical loss or broken references. Source hash need not equal
target hash after an approved rename: compare source bytes to source manifest and
target bytes to deterministic mapped expected output. Counts alone are insufficient.

Shadow uses pinned inputs, the same compiled process/criteria semantics and recorded
or certified non-effect action results with no production credentials/capabilities.
Compare decisions/outputs and unknown coverage separately; never perform a second real
effect just to see whether it matches. Model nondeterminism needs a pinned independent
rubric rather than assumed byte equality. Shadow success is not live qualification.

For each active process choose drain on source, supported safe-boundary bridge, or
reviewed retirement/replacement. A bridge requires full definition/compiler/interpreter/
node/iteration/input/artifact/eval/approval/timer/budget/compensation/effect history,
current access, stable source/target run IDs and one fenced execution owner. Missing
state, uninterruptible work or unknown effect blocks bridging. A status label such as
waiting cannot reconstruct executable state. The supported bridge control is distinct
from the deliberately unsupported fixture; it must not infer compatibility from success
in a different runtime profile. Configurable workflow version rules remain mandatory.

Rehearse validation, supported transfer/drain, restore/rollback or forward recovery on
an isolated representative environment. Record expected/observed timings, evidence,
work disposition and findings; missing recovery proof or source drift blocks eligibility.
Keep staged source/mapping intact for repair and create new reviewed evidence when
inputs change. Completing rehearsal does not execute cutover; T-119 and later hypercare
acceptance retain their own authority and actual-effect obligations.

## Packet refinements and evidence discipline

Reviewed successors must refine the draft payloads: criticalUnknowns/counts are derived
from actual manifests, not trusted client numbers (T-109/T-116/T-118); cell/security
epoch claims are preconditions/targets, not authenticated authority (T-110/T-111/T-114);
quota units/currency/tariff and uncertainty are typed (T-112); support operations/purpose
are explicit (T-113); no-cursor/not-started/expired-source variants are discriminated
(T-115/T-117); empty permitted-difference and gap lists are valid when evidence proves
none (T-118). No dummy grant, invented source or fake reviewer to satisfy historical
minItems. Keep old draft hashes and integrate supplemental schemas deliberately.

Use canonical A-05 families, tenant-leading keys/indexes and scoped references, atomic
domain/result/audit/outbox changes and authoritative invalidation. Pin actual safe error
codes/examples for denied/hidden, stale generation, conflicting command, quota exceeded,
unknown effect, incomplete inventory and incompatible migration. UI keeps permitted
drafts, accessible form/table alternatives and exact phase/version/recovery labels.

Every vector matrix row needs a fresh full schema-valid seed, actual attempted command,
independent stored/provider observations and expected phase snapshots. Zero effects
cannot pass if the adapter was never exercised. Real provisioning/identity/provider
and migration tests run only in authorized isolated environments; these definitions
authorize none now. Review/packet approval remains absent, not silently supplied by
the comparator or by this document's specificity.

All 132 tasks planned and 480 original criteria not_run. Approved packets zero;
P 4/12, E 0/16, WF 0/16 unchanged. Research 1/5 used, four remain. Next bounded
definition slice: remaining T-120–T-132 excluding already-covered T-123; T-119 also
already has earlier vectors. These twelve tasks retain the final 48 uncovered cases.
