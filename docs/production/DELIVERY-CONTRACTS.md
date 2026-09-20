# Engineering contracts for the enterprise product

Revision-4 precedence: SOLUTION-ARCHITECTURE.md, CHANGE-PROTOCOL.md and IMPLEMENTATION-HANDOFF.md fix the expanded SaaS/migration/consistency architecture and bounded implementation-packet requirement. Preserve C-01–C-08 and original acceptance; where C-08 names T-106 as final, it now means the prior portfolio baseline, with T-132 the current expanded endpoint.

Revision 2. Required design baseline for the task backlog; target contracts are not implemented APIs. T-01 makes the schemas/OpenAPI/event fixtures executable before downstream work. Names below are canonical product concepts; do not create disconnected duplicate project, instruction, work-item or artifact stores for each surface.

## C-01 — Aggregate and storage contract

Use a modular control plane and separately runnable workers for the first supported deployment. PostgreSQL is the durable source of truth; artifact bytes use a storage interface with a supported S3-compatible implementation. Database-backed jobs/outbox avoid an unnecessary extra queue service for the first topology. UI projections are rebuildable and never authority sources. Existing JSON import is an explicit, verified migration, not production persistence.

All tenant-owned entities: `id`, `tenantId`, `workspaceId` (nullable only for documented organisation-level types), `schemaVersion`, `version`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`. References include target type and ID; workspace scope is verified at write and read. Published records are immutable snapshots; edits produce drafts/new versions. Tombstones retain referential history under retention policy.

| Aggregate | Mandatory additional fields/invariants |
|---|---|
| Workspace | owner, scope, locale/timezone/currency, policyVersion, lifecycle; authenticated memberships separate from business roles |
| Brief / source | conversationId, acceptedVersion, fact/assumption/unknown/exclusion records; source ID, revision/hash, origin, author, classification, retrievedAt, validUntil, authority and access scope |
| Blueprint / object / edge | briefVersion, parentVersion, type/area, fields, epistemic state, lifecycle, owner, provenance, confidence explanation; edge type/source/target; structural references valid |
| Requirement / gap | scopeVersion, criterion, applicability, criticality, reason, owner, dueAt, remedy, evidenceRefs; exclusion has rationale, approver and reviewAt |
| Instruction / assignment | objective, typed inputs/outputs, procedure, allowed/denied tools/scopes, limits, checkpoints, evaluation rules; assignment pins principal/instruction/authority versions and effective dates |
| Process version / task | trigger/version, DAG, typed ports, branch conditions, deadlines, compensation; task pins dependencies, assignee, inputs, required outputs and checks |
| Run / attempt | processVersion, input/instruction/context hashes, status, attemptNumber, leaseOwner, fencingToken, heartbeatAt, budget reservation, cancellation/pause intent, provider references, artifacts, evaluations |
| Change case | intent, measures, enterpriseVersion, owner, currentStage, context/impact/requirements/architecture/plan versions and dependency hashes |
| Decision / approval | authenticated actor, decision/reason, scope, policyVersion, requestHash, bound evidence/artifact/environment/config hashes, grantedAt, expiresAt, revokedAt |
| Artifact / evaluation | URI, hash algorithm/digest, size/type, classification, producing attempt/source revision, retention; criterion/evaluator/version, input hashes, result, logs, evaluatedAt and validUntil |
| Release / effect | candidate digest, environment/config version, authorization ID, idempotency key, provider operation ID, state, observed effect, rollback candidate and health criteria |
| Measure / observation / learning | formula/unit/category, source, baseline/target, window/freshness/minimum samples, owner; timestamped readings and provenance; follow-up disposition and new change ID |

Migration preserves IDs and history or supplies a persistent old→new mapping. Import validates source schema, tenant mapping and hashes; quarantine invalid records with reason. Dry-run counts, replay idempotency, rollback/readback and failed import recovery are mandatory. A task may not silently discard old workspace data.

## C-02 — Commands, queries and events

Production API prefix `/api/v1`; existing `/api/*` routes remain legacy until an explicit compatibility plan. REST resources use IDs, not filesystem paths. Mutation command body contains `commandId`, `expectedVersion`, `payload`; authenticated principal and permitted tenant context come from the session/token. Ignore/reject caller-supplied identity/roles/tenant claims as authority. Idempotency scoped to tenant + operation + command ID; changed payload under reused key returns conflict.

Transaction: validate schema → resolve scope/identity → evaluate policy → lock/check version → apply state transition → persist state, command result, audit and outbox together → return. Consumers deduplicate event IDs. Repeating an accepted command returns its original result without repeating an effect, even after a crash. Policy and ownership changes are rechecked at dispatch/effect time.

Responses: 200/201 for completed resource commands; 202 with durable job ID/status URL for asynchronous work; 400 invalid envelope; 401 unauthenticated; 403 unauthorized action on a visible object; 404 absent or inaccessible object; 409 version/idempotency conflict; 422 domain validation with field errors; 429 budget/rate limit and retry metadata; 503 unavailable dependency. Error shape: `code`, safe `message`, `fieldErrors`, `correlationId`, `retryable`, `currentVersion`, `recoveryActions`. Never leak tenant existence, credentials, raw stack or worker path.

Query contract: authorized workspace filter mandatory; cursor pagination with stable sort/tie-breaker; explicit status/owner/time filters; `asOf`, `partial` and freshness metadata; no fabricated fallback counts. Event envelope: `eventId`, `schemaVersion`, tenant/workspace/aggregate ID and version, type, actor, occurredAt, correlationId, causationId, data and evidence references. SSE or equivalent updates resume by event cursor; clients refetch after gaps and reconcile optimistic UI.

| Resources | Commands and required resulting events |
|---|---|
| workspaces/memberships | create/archive/invite/revoke → WorkspaceCreated/Archived, MembershipGranted/Revoked |
| conversations/briefs | append/correct/accept/generate → MessageRecorded, BriefAccepted, ProposalRequested/Validated/Failed |
| blueprints/objects | draft/edit/link/compare/publish/retire → DraftUpdated, BlueprintPublished, ObjectRetired, EvidenceInvalidated |
| instructions/assignments | propose/revise/enable/revoke → InstructionVersionCreated, AssignmentEnabled/Revoked |
| processes/runs/attempts | publish/trigger/lease/heartbeat/pause/cancel/resume/retry → ProcessPublished, RunQueued, LeaseGranted, CheckpointReached, RunPaused/Cancelled/Resumed, AttemptCompleted/Failed/Interrupted |
| changes/requirements/architecture | create/evaluate/repair/accept/advance → ChangeCreated, EvaluationRecorded, BaselineAccepted, StageAdvanced |
| repositories/candidates | onboard/sync/propose/build/verify → RepositoryBound, ChangeProposed, BuildCompleted, CandidateVerified/Rejected |
| approvals/releases | request/approve/reject/revoke/promote/reconcile/rollback → ApprovalRequested/Granted/Revoked, EffectRequested/Observed/Unknown, ReleaseHealthy/Failed/RolledBack |
| observations/followups | ingest/assess/accept/reject/defer → ObservationRecorded, OutcomeAssessed, FollowupDispositioned |
| evidence/exports/admin | verify/export/hold/configure/rotate/backup/restore → EvidenceVerified, ExportCompleted, HoldApplied, ConfigurationApplied, CredentialRotated, BackupVerified, RestoreVerified |

T-01 must define actual JSON schemas, examples and version compatibility for each family; names alone are not completion. Additive optional fields are backward compatible; semantic or required-field changes need a version/migration and consumer tests. No UI bypass via internal endpoints.

## C-03 — State and transition semantics

Addendum: CONFIGURABLE-WORKFLOWS and ADR-010 require editable versioned workflow
profiles including SDLC. A-02's initial PostgreSQL-only process scheduler is replaced
in the target design by a Temporal adapter with domain/outbox/effect authority still
in PostgreSQL. C-03 run/attempt/effect invariants remain mandatory. Definition loops
instantiate bounded new iteration nodes; they are not invalid cyclic scheduling
dependencies or automatic retries of uncertain effects. No runtime migration is
implied by this contract edit.

Blueprint: `draft → proposed → accepted → published → superseded/retired`. Publishing requires structural validity and explicit unresolved gaps, not fabricated evidence. Operational enablement is a separate decision.

Assignment: `proposed → validated → enabled → suspended/revoked/expired`. Enabled requires eligible authenticated principal, instruction version, current authority, tool scopes and budget. Suspension/revocation prevents new dispatch immediately; existing work is paused/cancelled/reconciled according to its effect boundary.

Task attempt: `queued → leased → running → waiting_human | pause_requested | cancel_requested | succeeded | failed | interrupted | effect_unknown`. Waiting can resume only with the matching checkpoint decision; a paused attempt can create a successor attempt with a new instruction/input version. A request to cancel is not proof the worker stopped. Terminal records never reset in place. Workflow success requires all required output contracts and evaluations, including human steps, not just worker exit status.

Default worker targets: heartbeat 10s, lease 30s, monotonically increasing fencing token; reclaim only after expiry with current policy. Stale workers cannot publish accepted results or obtain further tool grants. Crash after remote effect before acknowledgement enters reconciliation using provider ID/idempotency key; never blindly retry a potentially irreversible effect. Exactly-once remote execution is not assumed.

Pause: stop scheduling and further brokered tool grants after persisted pause intent; expose active uninterruptible operation until acknowledged/reconciled. Cancel: terminate within configured grace period, revoke grants, collect partial output, reconcile effects, release reservations. Resume: revalidate identity, budget, context, checkpoints and changed instructions; retain predecessor links. Retry: new attempt with reason and bounded retry count, never auto-retry domain denial or an unknown external effect.

Approval tuple: principal + policy version + request hash + artifact/evidence hashes + environment/config version + scope + expiry. Reject self-approval where separation is required. Changes, expiry, revocation or failed checks invalidate approval. Human override cannot waive non-overridable controls; allowed exception requires reason, scope, owner and expiry plus its own policy decision.

Release: `planned → awaiting_approval → authorized → deploying → observing → healthy | failed | effect_unknown → rollback_pending → rolling_back → rolled_back | recovery_required`. Deploying and rolling back are protected effects. Observation and business outcome assessments persist separately; technical healthy does not imply business success.

Retirement: stop schedules, revoke assignments/tool grants, drain/reconcile active work, transfer accountable ownership, decommission allowed resources, retain evidence, then archive. No dangling process references or orphaned active credentials.

## C-04 — Agent, tool and provider boundaries

Context package pins objective, requirement IDs, input sources/versions/classification, instructions, tools, budget, output schemas, checks and authority scope. Documents, retrieved content, logs and model output are untrusted data; no instructions there grant new authority. Tool broker validates each call against the current assignment and effect policy.

Reserve budget atomically before dispatch; account for reserved and actual provider consumption across concurrent tasks. Token/time/tool-call/cost limits are independent. Unknown cost is held pending reconciliation, not treated as zero. Provider outage, throttling, malformed structured output, denied tool calls, incomplete output and evaluation failure have distinct states. Provider substitution must remain within data-residency/model policy and approved budget; never silently switch billing accounts.

Workers run ephemeral non-root isolated workloads with explicit CPU/memory/disk/time/output limits, read-only base, approved writable mounts, no host runtime socket, denied-by-default egress and short-lived task-scoped credentials. Fixed process arguments and separate directories alone do not provide this boundary. Artifact collection rejects path escapes, symlinks, oversized files and secret leakage; rendering/downloading untrusted output uses safe content disposition and authorization.

SCM adapter: approved installation/repository scope, immutable base, owned branch, structured diff, commit/PR, checks/webhooks, reconciliation. Verify webhook authenticity/replay window, deduplicate events and bind source revision. Never execute a repository's code in the control-plane process. Build and deployment adapters consume immutable inputs and return provider operation IDs and observed effects.

Existing deterministic code generator remains a reference profile. A real coding agent must edit an arbitrary selected test repository to satisfy traced requirements, handle failed tests, and produce usable reviewed changes; scaffolding the same template is insufficient.

## C-05 — Authority and privacy defaults

Founder/owner can accept scope and delegate allowed work. Designer edits/publishes within assigned scope. Human/agent executor reads assigned inputs and submits outputs, not its own required independent evaluation. Release approver authorizes eligible immutable candidates but cannot self-approve their implementation. Auditor has scoped read/export; platform admin configures infrastructure and is not automatically a business risk approver. Service principals use narrowly scoped credentials. Default deny; policy test matrix includes every command/query/download/event stream.

Tenant/workspace scope is checked in API, SQL, object-storage paths/grants, jobs, cache keys, search and subscriptions. Browser role or tenant headers are not security boundaries. Authorized data export and deletion honor classification, retention and holds; data minimization/redaction applies to model context, logs, diagnostics and audit exports. Key rotation preserves ability to verify historical signatures; revocation/expiry are visible.

## C-06 — Definition of ready and done for every task

Ready: dependencies have revision-bound evidence; required domain choices are recorded; task names exact screen, schema/API/event changes, migration/compatibility, allowed effect boundary and acceptance fixtures. A task whose tests require unspecified behavior is blocked for design. Record the concrete question; do not guess a product policy or substitute a mock success.

Done: intended role can complete the real UI/API workflow from a clean fixture; data survives required restart; negative/recovery cases pass; authorization/isolation hold; migrations and rollback are exercised where relevant; logs/audit and user recovery are inspectable; required docs and receipt updated. Reviewer verifies assertions against independent inputs, not only implementation constants. Record failures and skipped checks as remaining work.

Work packages may be split into smaller commits/tasks while preserving parent acceptance IDs and dependencies. Parent completes only when all child acceptance passes. No task may be closed by a disabled button, prose inspector, hard-coded sample result, empty adapter, unexecuted test, or reassigned gate denominator.

## C-07 — Integration seams requiring combined tests

1. Brief acceptance → blueprint generation: same workspace, exact accepted facts and source versions; cancel does not publish partial output.
2. Blueprint/instruction publication → task execution: run pins immutable inputs; material edit invalidates dependent authorization before further work.
3. Process scheduling → tool broker: lease/fencing + effective assignment/policy + atomic budget reservation all required.
4. Requirements/architecture → SCM/build: every claimed requirement maps to a changed artifact and independent acceptance result; rebase invalidates prior checks.
5. Assurance → approval → deployment: exact candidate/evidence/environment tuple survives handoff; substitution and revocation deny effect.
6. Deployment → observation → learning: source revision, effect and outcome remain linked; failed business measure does not become technical failure or vice versa.
7. Backup/restore → workers/providers: restored control plane does not replay old external effects, reuse leases or lose signature verification keys.
8. Identity offboarding → every surface: sessions, streams, queued jobs, downloads and connector/tool grants honor revocation.

## C-08 — Revision-3 portfolio implementation handoff

PORTFOLIO-CONTRACT PC-01–PC-12 and ENTERPRISE-MODEL EM-01–EM-07 extend these contracts. For each T-49–T-108 implementation create concrete schema/API/event examples, transition table, permission/effect matrix, indexes/transaction boundaries, migration/backward compatibility, UI state/action mapping and executable acceptance fixtures before dependent feature code. Required directories in the backlog are intended deliverables, not claims that files already exist.

Use one authoritative enterprise identity/context model and shared workflow/effect/evidence services across named modules. OADL v0.1 remains a strict projection. Keep design, observed behavior, enablement and qualification separate. Tests must cover semantic change propagation to dependent claims, requirements, evaluations, approvals, queued work and in-flight effects; layout-only edits must not cause semantic publication.

Map actual test cases to PF, ES, F, PC, X, PQ and original R/AT IDs in PORTFOLIO-COVERAGE. Preserve original task/story/acceptance IDs during decomposition. A child task does not close its parent until every inherited criterion passes. T-106 full qualification requires all tasks and all expanded obligations plus the unchanged original gates. No documentation-only or mocked substitute satisfies a required real user/backend/effect outcome.
