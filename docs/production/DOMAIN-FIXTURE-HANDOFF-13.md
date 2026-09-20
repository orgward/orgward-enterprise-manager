# Policy, decisions, stewardship, evidence and agent supervision — increment 13

Specification checkpoint, not feature implementation or independent approval.
[User interactions](../product/GOVERNANCE-AGENT-INTERACTIONS-13.md) connect the
governance modules to business and configurable SDLC work.

## Scope and source fidelity

`domain-vectors-13.mjs` adds **48 original acceptance definitions and 240 expected
observations** for T-78–T-89. Cumulative **316/480 definitions**, **1,778 observations**,
**91/132 tasks**; **164 scenarios / 41 tasks** remain without this layer. T-77's
high-risk effect vectors from 07 remain unchanged. Original task objects, dependency
edges, acceptance sentences and all previous vector files remain unchanged.

Reused the existing product/architecture/workflow contracts, task-specific drafts,
qualification targets and pinned framework chapters on policy layers and semantic
lineage. These chapters supply intent; the mechanics below are explicit local
engineering decisions, not claims that upstream modules or these APIs exist.
No external research. Sixteen additional WF obligations remain mandatory and unrun.

## Required implementation evidence by task

| Task | Concrete journeys now defined | Required independently collected evidence |
| --- | --- | --- |
| T-78 | Effect-free simulation; activation impact; policy outage; canary and rollback | Pinned request diffs, scoped activations, blocked effect logs, retained queue/decision records |
| T-79 | Rights/quorum; bounded delegation; departure/expiry; same-principal roles | Current rights graph, delegation chain, rejected grants, real authenticated identities and eligible vote set |
| T-80 | Exact-tuple votes; evidence/revocation changes; concurrency/restart; appeal | Transactional case/vote/decision/outbox records, digests, eligible principal lineage and Warden verification |
| T-81 | Authority conflicts; break-glass refusal; emergency expiry; no reviewer | Preserved claims, controlled resolution/escalation, denied effects, owned reconciliation/after-action work |
| T-82 | Term reconciliation; ownership conflict; accepted handover; classification tightening | Canonical IDs/aliases, scope/provenance, handover acceptance, access/cache/download invalidation before new disclosure |
| T-83 | Measured quality; restricted/held evidence; reassessment; source offboarding | Raw sample/window/denominator, failed/passed/unknown assessments, issue ownership, hold and retention state |
| T-84 | Logical-to-execution lineage; breaking contracts; schema mapping migration; coverage gaps | Exact property/producer/consumer/evidence versions, stale eval barrier, old mapping interpretation, missing-read inventory |
| T-85 | Causal event chain; duplicate/gap/tamper; audit outage; concurrent events | Domain/outbox/event reconciliation, independently verified bytes/checkpoints, causal DAG and blocked protected dispatch |
| T-86 | Offline export verification; restriction/trust failure; rotation/restore; held disposal | Portable manifests, external public trust anchors, historical key metadata, no exported private keys, actual retained/deleted object state |
| T-87 | Evaluated assignment intersection; changed profile; revocation; planner-created reviewer | Issued capabilities, profile/eval versions, actual tool dispatch, revocation timings and accountable-principal lineage |
| T-88 | Two specialists and shared budget; invalid descendants; parent stop/crash; instruction revision | Durable ancestry, atomic reservation ledger, output/evaluation digests, lease fencing and successor-attempt history |
| T-89 | Independent provider eval; adversarial failure; qualified fallback; business failure | Actual isolated provider outputs/tool logs/usage, independent rubric, restricted incident evidence and separate business measure |

## Fixed implementation decisions for these packets

### Policy lifecycle and reviewer eligibility

Simulation consumes the same pinned expression semantics and typed request contract
as runtime, but has no effect capability and cannot mutate the active policy.
Redaction may make a condition unknown: do not invent missing sensitive inputs to
produce a clean comparison. Show added denies, removed denies, changed obligations
and unchanged decisions separately, with affected scope/work and governing lineage.

Policy activation commits the new version/assignment, current policy epoch, impact
barrier, command result and audit/outbox atomically. Canary selection is explicit
workspace/environment/capability scope, not random widening of protected authority.
Missing impact or an unsafe mandatory-recovery transition blocks activation. A
supported transition plan explicitly drains, remaps or retains narrowly authorized
reconciliation; it cannot waive immutable protection or leave an old broad grant
active indefinitely. Rollback is a new activation with old content and current
epochs. Denied historical requests are never silently replayed on rollback.

Delegation authority is the intersection of every live ancestor grant, principal
rights, action/resource scope, purpose, environment, validity, policy and budget.
Reject cycles, unknown ancestors, wider action sets, later expiry and depth beyond
the configured bound. Role labels, UI persona and new agent/account IDs do not
prove independence. Resolve accountable principal and delegation lineage for
segregation-of-duties; no privileged identity can be manufactured by a requester.

Quorum is evaluated on distinct currently eligible principals over one immutable
request/evidence tuple. Show configured eligible population, required votes,
recusals, abstentions, vetoes and expiry before submission. Never lower the required
number automatically when a reviewer leaves. Missing quorum/veto policy blocks
protected review setup. Fixture baseline is two independent approving principals;
an explicit rejection blocks that review round under its pinned profile, while
abstention supplies no vote. Other legitimate board policies require an explicit
versioned configuration and their own tests, not an LLM's inferred custom.

Departure or expiry invalidates affected pending/current-use contributions without
erasing historical votes. A separately authorized substitute supplies a new vote;
no vote transfer. Recheck at vote, decision finalization and protected use. Lock
the case/version and persist vote, final transition and outbox under one consistent
transaction protocol. Duplicate command/same payload returns its saved result;
changed payload conflicts. A raced loser reloads the case; no blind expectedVersion
replacement to force a vote through. One quorum produces one logical finalization.

Appeal owns a separate case and reviewer eligibility, references the old decision,
and either upholds it or creates a bound superseding decision. Preserve rationale,
evidence and all votes. Queued effects require fresh evaluation; a changed decision
does not undo earlier effects or authorize their historical execution retroactively.

### Conflict, emergency and absent authority

Scope split must prove disjoint applicability; different labels alone are not proof.
No eligible decision owner yields blocked/escalated work with a named escalation
route, not automatic approval on timeout. Escalation follows local containment →
domain reconciliation → cross-domain board → strategic owner when applicable;
each level needs actual rights, evidence and due policy. Display unavailable owner
configuration as an owned setup gap, never an invented approver.

Emergency access is a separately authorized, narrow, expiring grant, with reason,
evidence, affected action/target/context and mandatory after-action owner. It cannot
override immutable deny, artifact mismatch, residency or the fact that the actor
lacks emergency authority. Validity is [effectiveAt, expiresAt); equality at expiry
blocks new work even if cleanup jobs lag. Already accepted remote effects remain
visible pending reconciliation. After-action review does not turn an unauthorized
past effect into an authorized one.

### Stewardship and disclosure consistency

Canonical term reconciliation requires typed identity, scope and provenance plus
eligible review, not name matching. Preserve aliases and source-ID crosswalks;
unrelated same-named entities stay distinct. Handover separates proposal, successor
eligibility, acceptance, effective interval and revoked predecessor rights. An
authorized substitute may approve the handover on behalf of the absent party,
but does not silently become the new accountable owner. In T-82-AC3 the accepted
successor remains owner-b; both paths must record the actual accepting principal.

Classification changes participate in the same authoritative publication barrier
as policy. Protected reads, downloads, search/retrieval, event streams and exports
check current classification/reader authority; stale projections or signed URLs
cannot expose data after denial is known. For revocable private downloads, use an
authorization-gated path or equivalently qualified revocation mechanism, not a
long-lived public object URL. Already delivered copies cannot be remotely erased;
record prior disclosure instead of promising recall. Access revocation is not deletion.

Quality assessments pin formula, unit, source revision, sample eligibility/window,
denominator and threshold. Example: 8 invalid of 100 breaches maximum 5 of 100;
2 of 100 passes. Zero observed rows during an outage means unknown, not 0% invalid.
Store old and new results separately, and keep the issue open until the required
improvement window/evidence is met. Evidence sample quality does not imply all
enterprise data meets the same standard. Each issue has an actual accountable owner.

Offboarding stops new source reads but leaves an inventory of retention, holds,
active decision dependencies, disposal dates and owners. Deletion remains blocked
when any applicable hold or required retention/dependency prevents it. After those
constraints cease, actual disposal requires separately authorized workflow and
readback evidence. Do not mark “erased” from the request status. Specialist systems
of record remain explicit; OrgWard cannot certify their deletion without evidence.

Property meaning, physical mapping, declared authority, consumer compatibility and
observed reads are distinct versioned records. Compatible source rename preserves
semantic identity and old mappings; breaking shape needs reviewed consumer migration.
Missing telemetry yields owned unknown edges and denominator gaps, not invented
conformance. An observed authority bypass cannot silently redefine accepted authority.

### Ledger admission, causal history and independent trust

Ledger is governance evidence, not the economic accounting ledger. Each material
event binds tenant, principal, command, aggregate revision, causation/correlation,
payload/evidence digest, schema version and recorded time. A unique logical event
ID deduplicates delivery; it does not hide duplicates in diagnostics. Same event ID
with changed bytes is a conflict/integrity failure, not an update.

Domain state, command result and audit intent/outbox share a transaction. This slice's
protected-effect fixture selects **required audit admission before dispatch**: an
unavailable required sink leaves the accepted request durably pending and blocks new
protected effects. Recovery deduplicates delivery, obtains verifiable admission and
rechecks current authority. Unavailability of the authoritative audit-intent store
rejects the command. Never silently substitute an in-memory log. Local durable admission
as a different deployment policy needs explicit proof of equivalent protected durability;
it is not a runtime fallback when the selected policy fails.

Out-of-order receipt is not necessarily tampering: record pending predecessor gaps,
then verify/reconcile on arrival. Do not assert completeness without the required
checkpoint/manifests. Immutable integrity failure and missing data remain distinct.
For concurrent module events, a/b share parent root and c depends on both. Required
edges are root→a, root→b, a→c, b→c; there is no a→b or b→a. Display sort order can be
deterministic but must be labeled noncausal. A per-stream signed checkpoint may
commit a serialization order without claiming wall-clock order proves business causality.

Export manifests bind exact included bytes/references, redactions/omissions, format/
module versions, gap declarations, public certificate/key metadata and checkpoint
trust. Signatures cannot prove factual truth or absence of all undisclosed events.
Independent offline verifier takes a customer-pinned trust anchor outside the bundle;
trusting a root supplied only by an attacker-controlled bundle is insufficient.
Report cryptographic integrity, chain completeness, permission redaction and trust
as separate dimensions. The AC1 bundle intentionally has valid signatures and a
declared gap, so it is authentic-as-recorded but incomplete, never wholly verified.

Routine key rotation preserves valid historical verification under the versioned
trust policy. Compromise revocation and routine retirement are different. Offline
verification is bounded by the supplied independently authenticated revocation/trust
snapshot and its as-of time; it cannot know newer revocations without refreshed data.
Stale required trust metadata yields unknown/untrusted, not current assurance.
Private signing keys never belong in exported bundles. Restore preserves evidence,
public trust history and current fencing/revocation; it never revives old grants.
Exact signature algorithm/library/version is pinned and security-reviewed in the
implementation packet, not a new homemade cryptographic primitive.

### Overseer, shared budgets and intervention

Profile definition, evaluated version, agent identity, assignment, session and attempt
are separate records. Evaluation binds actual model/provider/tool/instruction/context
and fixture versions; changed relevant inputs invalidate applicability. Grant the
intersection of role, policy and autonomy envelope, never their union. A new identity
does not acquire wider rights or independent-review eligibility. External tools still
go through Warden and the shared effect broker, not a second Overseer scheduler.

Every child intent records parent/ancestry, pinned workflow/node/iteration, context,
typed artifact and independent evaluation, capability intersection, depth and shared
reservation IDs. Persist child plus ancestry and job/outbox atomically. Bound fan-out,
depth, time, tokens, cost and tool calls independently. Ambiguous/contradictory
instructions cannot override hard policy and route clarification before affected work.

Budget example: parent limit 1,000 tokens; reservations 400+500; reconciled usage
300+450=750. Release unused reservations 100+50, giving 250 available. Never count
both settled usage and its old reservation as separate spend; never release an unknown
provider charge merely because a worker crashed. Concurrent 200-token reservation
when 900 is already held must fail. Provider overrun remains measured as actual usage
and a limit breach with new dispatch blocked; do not clip the ledger to a convenient
cap. No fallback to another billing account or automatic budget expansion.

Pause/cancel records durable parent intent and invalidates descendant dispatch before
claiming stopped. Acknowledged pause means a supported safe boundary, not message
receipt. Restart reconciles every child by durable ancestry/fence; no orphan privileged
jobs. Retain unknown external work until observed reconciliation. Qualification targets
remain <=30s revocation enforcement and <=30s cancellable-stop acknowledgment; these
are upper bounds, not permission to dispatch when current revocation is known. Record
monotonic observed timestamps under the qualified topology. Uninterruptible remote
work is outside physical-cancel guarantees and must remain visibly pending.

Human instruction changes create a reviewed successor attempt under the workflow's
safe-boundary rules, with new instruction/context/evaluation applicability. Old outputs
and approvals remain historical; stale approvals do not transfer. Diagram/forms expose
the same delegation, checkpoint, bounded-loop and escalation controls. Mandatory policy,
reviewer independence and budget constraints remain enforced even if visual nodes move.

Agent evaluation uses actual authorized isolated provider runs with independent
rubrics and usable artifact checks. The saved 18/20 quality fixture and zero safety
violations are a test-profile threshold, not a universal quality benchmark or measured
product score. Pin task-specific thresholds before evaluation. A harmful attempted
tool escalation can fail activation even when the broker prevents the actual effect;
include defended benign/adversarial controls to avoid claiming every poisoned document
necessarily compromises an otherwise safe agent. Restrict raw canary incident evidence
and redact public summaries. Never substitute generator self-rating for independence.

Fallback needs its own passing compatible evaluation plus current residency, budget,
tool/context/output contracts. Create an explicit linked successor attempt and keep
uncertain primary-provider usage reserved. No silent model or account switch. Failed
business outcome despite a passed agent evaluation stays a failed business outcome;
learning proposes reviewed change, not automatic authority expansion.

## How to implement and verify without shortcuts

Materialize complete schema-valid seeds and pinned bytes from aliases; enumerate every
matrix row from a fresh seed unless explicitly sequential. Record row IDs/results so
aggregate zero-failure assertions cannot hide omitted cases. Derive observations from
authenticated UI/API actions, database/outbox readback, independent provider/broker logs,
actual exports and external verifier output—not endpoints returning expected booleans.
Use real race barriers and restart faults. Implement accessible laptop forms/lists and
diagram equivalents, version/diff previews, exact validation, loading/empty/stale/denied/
conflict/failure states and recoverable drafts. No prose drawer counts as the action.

Full aggregate schemas, input/output/error examples, migration/index design, complete
seed adapters and genuine independent packet review remain required. These vectors
are not approved packets or executed acceptance tests. The comparator builds synthetic
reports from expectations to test comparison only. Existing 36 tests remain regression
evidence for the demonstrator, not these enterprise stories. All 132 tasks planned,
all 480 original acceptance cases not_run; P 4/12, E 0/16, WF 0/16 unchanged.

Next bounded definition slice: **T-90–T-99**, advanced SDLC, governed business effects,
connectors, accessible role UX and modular installation. Later T-100–T-132 remain
required; next numbering does not grant permission to skip implementation dependencies.
Research use remains 1/5, four available; no new mission in this increment.
