# Closed-loop intent and evidence control — checkpoint 19

User-requested enrichment of issue #1, captured in ISSUE-1-SOURCE-19.json.
Status: specified proposal, independent architecture/security review pending under
CR-019. No feature, approved implementation packet or product acceptance is claimed.
This is the canonical integration proposal, not a second SDLC specification.
The source's AUTONOMOUS_SDLC.md/DELIVERY.md equivalents here are SOLUTION-ARCHITECTURE,
CHANGE-PROTOCOL, IMPLEMENTATION-HANDOFF, DELIVERY-CONTRACTS and PORTFOLIO-ROADMAP.
Original 132 tasks/480 criteria, WF16, source obligations and P12/E16 stay intact.

## ADR-019 — Ownership and non-linear execution

Proposed decision: extend the existing modular control plane, shared command path
and ADR-010 interpreter; introduce no scheduler, generic truth database or separate
agent framework. Enterprise records are primary. A lifecycle is an editable view
of work over those records, not the authoritative enterprise model itself.

| Owner | Responsibility and boundary |
| --- | --- |
| Studio/SDLC | Studio owns enterprise intent; SDLC change intent references it, requirements, architecture and plan revisions. No copied competing enterprise truth. |
| Overseer | Versioned evaluator registry, execution envelopes, calibration and diagnosis proposals. Model output cannot approve transitions or rewrite criteria. |
| SDLC + shared workflows | Domain acceptance/transition service computes admissibility; Temporal adapter delivers durable continuations. PostgreSQL holds domain transition receipts/outbox; Temporal holds orchestration history. |
| Sentinel/Steward | Observations/claims, conflicts, source authority and freshness. Reconciliation uses CP-01–06 and T-121–124 at every activity, not just Learn. |
| Warden/Arbiter | Current effect policy and authentic scoped decisions. Human evaluation is a typed decision receipt, not a boolean. |
| Ledger/Platform | Immutable evidence/provenance and transaction/outbox identities, isolated storage, budgets, telemetry and recovery. |

Alternatives rejected: prompts-only control loses durable invariants; a second
orchestrator conflicts with ADR-010; adding a mandatory Reconcile stage misses
observations between stages. Keep the existing CP truth states. Add a separate
dependency applicability dimension CURRENT/STALE/INVALID/UNCERTAIN/SUPERSEDED:
CURRENT means matching dependencies, not verified real-world truth. An asserted
claim can be CURRENT but unproven. Historical validity is never overwritten.

## Domain model and invariants

`contracts/enterprise/closed-loop.schemas-19.json` supplies strict draft schemas
for portable payloads. All persisted objects also inherit canonical tenant,
workspace, stable ID, immutable revision, valid/recorded times, classification,
source provenance and composite-scope references from A-05. These payload schemas
are not replacement aggregate storage schemas or already approved API packets.

- IntentSpecification: explicit requested outcome/problem/actors/desired state;
  versioned success measures, requirements, constraints, preferences, non-goals,
  assumptions, unknowns, decisions, acceptance and authority refs; origin and
  supersession. Explicit statements and inferred interpretations remain distinct.
  Each requirement links actor/condition/behavior/outcome and proof obligations.
- Uncertainty: statement, source, affected requirements, confidence, reversibility,
  consequence/blast radius, clarification/defer costs, empirical feasibility,
  authority needed, disposition and policy/rationale. Rejected interpretations
  remain inspectable. An empty question queue does not imply sufficient context.
- Clarification: question/options/consequences, eligible respondent, due date,
  intent/dependency versions, answer/evidence, interpretation and impact receipt.
  proposed → open → answered → reconciled, or canceled/superseded. Answer alone
  does not update accepted requirements or create an authority grant.
- EvaluationContract (proof obligation): immutable target/criterion/rationale,
  evaluator type/version, typed input refs, expected properties, evidence policy,
  threshold/unit/window, severity, confidence, sample/repeat policy, independence,
  failure route and blocking scope. Human-judgment-only has an accountable decision
  right and evidence package; it is not an escape from evaluation.
- EvaluationResult: immutable contract/target/run/attempt and input manifest,
  evaluator version, timestamp, pass/fail/indeterminate/error, optional score,
  confidence, structured findings/evidence/unsupported claims/assumptions,
  diagnosis and recommended transition. Receipt authentication and semantic
  evidence validation precede acceptance; conforming JSON alone proves nothing.
- ReconciliationProposal: source activity, assertions/evidence, relationship to
  current state, scope/authority, impact paths, proposed disposition, superseded/
  invalid/stale refs and resulting revisions. Observed contradictions create
  findings, never directly grant observed behavior's authority.
- AcceptanceAssessment: target and required obligation manifest, current dependency
  generation, results/decisions, blocking findings, measurement window, derived
  phase and explanation. This is computed, not writable as `done:true` by an agent.
- ControlTransition: expected run generation, profile/node/iteration, diagnosis,
  evidence/decision refs, selected route, budgets and reason. Append-only receipt
  plus domain update and outbox are atomic. No model-private reasoning is required.

All arrays of refs are typed and tenant-resolved; empty is permitted only where
explicitly non-applicable. Missing mandatory obligation, input or authority is a
blocker. Scores cannot average away mandatory failures. Unknown cost is reserved,
not zero. Confidence alone cannot make a claim true or authorize an effect.

## Clarification and context policy

Policy is versioned, deterministic configuration with recorded inputs; models may
extract candidate uncertainties, not override precedence. Evaluate in this order:
missing mandatory authority/access → block/escalate; materially different owner
choices about outcome/security/irreversible cost → ask_human; authorized evidence
likely to resolve a factual gap → investigate; safe bounded experiment cheaper
than a question → prototype; reversible but relevant assumption → infer_and_record;
only conventional low-consequence/cheap-correction details → infer.

Silent infer means no human interruption, not missing audit provenance. If risk,
cost or reversibility is unknown for a material decision, never classify low risk.
Estimate value of information using configured impact/cost bands with rationale;
do not pretend to have a calibrated probability or invented monetary precision.
Question batching deduplicates the same uncertainty/version and groups related
decisions. Limit investigation/experiment turns, spend and question rate by profile;
exhaustion escalates with evidence and alternatives. Never ask for accessible facts
instead of inspecting them; never research around missing human decision rights.

ContextAssessment records required authority/artifact/contract/runtime sources,
freshness and permission rules, retrieved revision manifests, unknowns and exact
completion criteria. Results: sufficient, incomplete_nonblocking (record assumption),
retrieve, clarify, inaccessible. Permission failure does not reveal hidden source
names/counts. Authoritative coverage is evaluated independently of answer plausibility.

Answer reconciliation previews old/new intent, assumptions, requirements, evaluations,
plan and approvals. Commit only with current respondent rights, matching expected
heads and required reviews. Concurrent contradictory answers produce a conflict;
late answers cannot resume a superseded run. Reload retains draft answer and server
status without duplicate notifications or overwritten accepted history.

## Evaluator taxonomy and qualification

Support deterministic, semantic, groundedness, retrieval, trajectory, security,
performance, architecture, human and production_signal types. Outcome is a target
kind, not a guarantee supplied by an evaluator's name. Deterministic evidence is
preferred for objectively testable properties. Semantic judges return findings
with cited artifact spans, rubric criteria, evidence and confidence, not a scalar.
Groundedness splits claims into supported/unsupported/contradicted/insufficient.
Trajectory evaluates tools, parameters, order, current authorization, evidence use,
deduplication and escalation even if the final artifact looks correct.

Registry versions pin adapter/tool/model/prompt/rubric/schema and calibration set
digests, allowed target types, input classification, budget and support envelope.
Changing any effective evaluator input creates a new version and stales applicable
results. Evaluation failures caused by a broken adapter/judge go to evaluator
repair; they do not justify weakening the product or deleting a failing test.

Independent reviewers use separately scoped identities/sessions and decision
rights; a second model name alone is not independence. Store conflicts of interest
and reviewer eligibility. Hidden evaluation sets are access-controlled, never sent
to implementers through retrieval/logs. No magic confidence threshold is universal:
profiles declare human-labelled calibration population, sample size, false acceptance/
rejection bounds, uncertainty intervals, rubric/model sensitivity and expiry.
Test ordering, verbosity, irrelevant text, injection, abstention and disagreement.
Missing calibration blocks use as sole consequential semantic acceptance.
Consequential disagreement escalates; no majority/mean silently overrides a failure.

Suites use stable scenario IDs, initial intent, known/hidden ambiguity, authorized
context, allowed alternative solutions, expected/forbidden actions, outcomes,
obligations and evidence. Categories: normal, ambiguous, edge, adversarial, security,
trajectory, outcome, historical-regressions, evaluator-calibration. Versions and
holdout access survive export/restore; production corrections create reviewed
candidate regression cases, not automatic trusted benchmarks.

## Diagnosis, transition and loop semantics

| Diagnosis | Default destination/action | Protected behavior |
| --- | --- | --- |
| local_defect | implementation repair | New repair iteration, retain failed result. |
| missing_work | plan | Add traceable work; do not blindly retry identical implementation. |
| specification_gap | clarify/frame | Resolve meaning before changing criteria. |
| context_gap | discovery/retrieval | Retrieve only within current access scope. |
| architecture_gap | architecture | ADR/impact review; affected plans/results stale. |
| authority_gap | awaiting_authority | No model-generated approval or effect. |
| environment_failure | bounded retry or operations recovery | Same logical operation; reconcile unknown remote effects first. |
| evaluator_failure | evaluator repair/review | Product evidence remains unresolved, not falsely failed or passed. |
| outcome_failure | outcome/frame | Healthy deployment does not prove business success; mitigate if needed. |

Production regression additionally selects governed mitigation/rollback before
diagnosis when policy requires it. Rollback may be impossible or unknown: show
forward recovery/compensation and reconcile, never claim universal reversal.
Reject/stop is a valid owner decision for infeasible or unauthorized goals.

The profile maps these semantic routes to stable node IDs. A backward route creates
a new bounded iteration/subprocess or reviewed successor run; it does not mutate
completed node history. ADR-010's structured graph restrictions still apply: no
arbitrary irreducible jumps. Missing route is a visible configuration blocker.
Diagram and forms edit the same route/criterion AST and show the same preview.

Execution phases may include intake, clarifying, discovering, framed, architecting,
planning, executing, evaluating, repairing, reviewing, awaiting_authority, releasing,
observing, blocked, failed, canceled and superseded. These are semantic categories,
not a fixed required array of stages. A profile may split/nest/rename nodes; mandatory
obligations and effect checks cannot be deleted by editing labels or edges.

Progress fingerprint binds normalized diagnosis, target/input/evidence/contract
digests and attempted strategy. A different timestamp/model-generated paraphrase
is not new information. Default safety profile: two repeated same-fingerprint
unsuccessful repairs require owned strategy review; maximum iterations/time/spend
also cap nonidentical failures. Profiles can tighten or govern changes to limits.
Human wait and process restart do not reset counters or reservations. Escalation
does not automatically grant another budget. Parallel branches share parent limits.

Transition commit rechecks current membership/policy/generation and expected run
version, records decision/result and enqueues Temporal delivery. Duplicate delivery
returns the same receipt; payload mismatch conflicts. Runtime outage remains
pending delivery. Crash after commit/before signal reconciles the same transition.
Evaluation completion racing a new intent stores historical evidence but cannot
promote the new intent or dispatch with old approval. Experiments run on identified
draft branches with no canonical mutation until governed reconciliation.

## Acceptance is derived, not a lifecycle endpoint button

Separate implementation_complete, verification_complete, release_approved, deployed,
operationally_healthy, observing, outcome_observed and outcome_accepted assessments.
They are independently evidenced, not monotonically assumed from stage traversal.
For outcome_accepted all mandatory obligations match current target/dependencies,
pass with eligible evidence, required decisions are valid, no critical/high findings
remain, architecture checks pass and required measurement windows/samples are met.
Indeterminate mandatory evidence blocks acceptance. An authorized disposition may
request more evidence or record an allowed scoped exception where existing policy
permits, but cannot turn an immutable mandatory deny/failure into a pass. Prior
acceptance remains historical when superseded; current applicability is recomputed.

Ready requires explicit/inferred intent, uncertainty dispositions, context sources,
evaluation strategy and authority boundaries. Before coding, every consequential
criterion has a proof obligation or accountable human evaluation. Before task
completion, every child contribution and original criterion needs actual evidence.
Schema-only prerequisite slices contribute schema proof, not downstream runtime
pass; no circular dependency on a future integrated E2E qualification.

## Commands, queries, permissions and safe failure

Use CP-01's command envelope and `/api/v1` dispatcher, never a parallel write API.
All new operation registrations are proposed until reviewed packets bind full
request/response schemas and migrations. Names resolve through the existing registry.

| Operation | Scope / durable output / normal failure |
| --- | --- |
| ProposeIntentRevision | Designer/authorized agent draft; typed proposed intent + sources; invalid refs → VALIDATION_FAILED. Acceptance reuses existing brief/requirement publication. |
| ClassifyUncertainty | Context owner/service, pinned policy and evidence → disposition/rationale; unauthorized source → scope-safe DENIED. |
| OpenClarification / AnswerClarification | Owner opens; eligible respondent answers with expected question version → answer event; stale/duplicate conflict → VERSION_CONFLICT. |
| ReconcileClarification | Domain owner + required reviewer → governed intent/dependency changes; stale head/review → STALE_CONTEXT, keep answer. |
| RegisterEvaluationContract | Evaluator owner drafts; independent qualification precedes enablement → immutable registry version; missing calibration → EVALUATOR_UNQUALIFIED. |
| RequestEvaluation / RecordEvaluationResult | Authorized requester/brokered evaluator identity → attempt/result evidence; unknown version → CONTRACT_MISMATCH; unavailable evidence → indeterminate/error, not pass. |
| ProposeDiagnosis / CommitControlTransition | Agent proposes; deterministic domain controller checks allowed profile route/current rights → transition receipt/outbox; blocked route/budget → TRANSITION_BLOCKED/BUDGET_EXHAUSTED. |
| ProposeReconciliation / AcceptReconciliation | Source observer proposes; authorized domain owner accepts under CP-03 → new baseline/invalidation; incomplete impact → IMPACT_INCOMPLETE. |
| AssessAcceptance | Controller with read scope → immutable derived assessment; missing proof → blocking reasons, not an exception bypass. |
| ProposeRegression / AcceptLearning | Owner proposes reviewed reusable lesson → new case/policy draft; existing accepted-learning command path governs adoption; never retroactive evidence. |

Success receipts include command/result ID, status, authoritative generation,
projection watermark, object revisions and next eligible actions. DENIED responses
do not confirm hidden object existence. Command idempotency and result re-read
require current authorization. Retry status lookup before any new command ID.
Queries: intent trace; orphan requirements/artifacts; failed/indeterminate proofs;
release assumptions; changed-ADR impact; acceptance explanation; evaluator version
history; invalidating production signals; resume bundle. Filter before traversal,
pagination and counts. Expose permission-safe dependency gaps, never false completeness.

## Continuous reconciliation and institutional learning

Every consequential activity may emit confirms/refines/contradicts/supersedes/
creates/uncertain evidence. CP-03 computes field-aware impact and an atomic protected
invalidation barrier before publication acknowledgement. Acceptance reads current
authoritative generations, not lagging maps. An observation can trigger a safety
finding or policy-defined pause while acceptance of a new truth waits for authority.
Do not overwrite truth merely because telemetry disagrees, and do not leave a known
material contradiction silently usable until a terminal Learn stage.

Learn means cross-run institutionalization: reviewed regression, reusable rubric,
clarification/context policy, organizational pattern, knowledge pack or runbook.
Ordinary state synchronization and clarification reconciliation happen immediately.
Reuse Sentinel claims/lineage and Steward source authority instead of inventing
another generic graph. Keep all ten edit entry points on the same semantics.

## Migration, operations and implementation boundaries

Legacy briefs become provenance-tagged intent drafts; no invented source or proof.
Legacy green statuses remain legacy_unverified unless actual evidence validates
the current contract. Old runs pin prior profiles; cutover uses ADR-010 safe-boundary
mapping and CP-04 fences, not status-only reconstruction. Unknown effects block
run migration. Schema changes are additive first, backfill in resumable batches,
validate references/tenant isolation, then enable new control paths. Rollback leaves
immutable versions readable; it disables new starts rather than erasing history.

Index tenant+target+revision, contract/version, run/attempt, uncertainty/disposition,
dependency reverse edges and unresolved finding severity. Transactional outbox
publishes IntentRevised, ClarificationAnswered/Reconciled, EvaluationRecorded,
ReconciliationAccepted, AcceptanceAssessed and ControlTransitionCommitted with
causation/correlation, expected generation and schema version. Events contain
references/digests and minimal classified data, not secrets or full prompts.

Metrics: duration by semantic phase, backward route counts/reasons, useful/unnecessary
questions and material ambiguities missed, assumption invalidation, proof statuses,
same-fingerprint repair counts, evaluator disagreement/failure, retrieval denials,
human waits, cost/token/tool usage per accepted outcome, post-release outcome failure
and recurrence. Report sample/population/window and unknown cost, not activity as
success. High-cardinality IDs belong in authorized traces, not public metric labels.

Fresh-agent resume returns pinned manifests, current vs historical acceptance,
uncertainties, failed proofs, allowed transitions, pending effects, budgets and
authority waits. No hidden conversation or private reasoning dependence. Restore
reconciles domain/runtime/provider histories under a new fence before dispatch.

## Delivery and exact source coverage

`closed-loop-obligations-19.json` maps all 24 issue checkboxes, with original text,
to existing task/AC owners, CL-001–018 dependency-ordered slices and concrete scenario
inputs/expected observations. All remain not_run. The source snapshot and proposal
manifest are hash-bound. `CLOSED-LOOP-UX-19.md` specifies interactions and golden path.
The CR candidate digest hashes the full manifest object, including its format,
base revision, file list and hash policy. The manifest hashes exact artifact bytes
except the backlog/architecture indexes:
there it hashes semantic content without task/criterion progress, evidence arrays
or packet registrations. It also hashes a canonical CR-019 semantic projection:
proposal, impacts, preserved obligations, invalidation and resume semantics are
bound, while mutable lifecycle/review/owner/application metadata and the circular
candidate-digest field are excluded. A recorded review names an exact Git commit;
the checker re-reads every manifest artifact at that commit and rejects drift.
Those mutable records are separately validated. Legitimate unrelated task progress
or review recording must not stale this proposal; changed meaning must.

CL-X01–CL-X04 are task-owned adversarial contributions, not final-qualification-only
notes. Applicable packets list `closedLoopSupplementaryCaseIds` and per-case bounded
scope/test paths. An owner task cannot start without adopted CR linkage and cannot
complete without its case contribution receipt; T-132 still verifies composition.

First bounded integration is CL-001/002 under T-01: review vocabulary/ownership,
schemas, negative examples and adoption migration; no live effects. Then integrate
intent/clarification, evaluator adapters, acceptance/routing and durable recovery
through the mapped parent tasks. CL-018 qualifies their composition, not a shortcut
around unfinished prerequisites. Parent dependencies remain required in addition
to slice dependencies. Independent review may alter this proposal through CR-019;
preserve source/old acceptance and invalidate affected candidate reviews.

Remaining packet work is explicit: materialized database migrations and seeds,
transport request/success/error schemas for each bounded operation, real observation
adapters, exact dependency/provider versions and independent review. Neither these
schemas nor the structural checker supplies those or executes the product. Automatic
Codex model dispatch is separate and unchanged by this requirement enrichment.
