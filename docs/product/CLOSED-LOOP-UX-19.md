# Closed-loop customer interactions — checkpoint 19

Proposed enrichment of existing SC-02/03/06/07/08/10/11/24, not extra disconnected
screens or implemented UI. Read CLOSED-LOOP-CONTROL-19 and configurable workflows.
Main user is a laptop operator; responsive layout remains required. Show the same
canonical records in chat, forms, diagram, lists and cross-perspective impact views.

## Intent → questions → reviewed meaning (SC-02 / SC-08)

Product owner says: “Let customers book a service, including recurring bookings.”
Intent panel separates quoted request, inferred details, known facts, preferences,
hard constraints, non-goals, unknowns and measurable outcomes. Each line has source,
version and responsible owner. A low-risk conventional display choice is recorded
without interrupting. Available repository facts are retrieved with citations.
Whether a booking may charge automatically is a high-consequence owner question,
not a guessed default. No live charging is enabled by answering it.

Question card: why this matters, affected requirements, alternatives/consequences,
who can answer, due date, assumption if explicitly permitted, and blocked work.
Controls: answer, attach evidence, request clarification, defer with owner/reason,
cancel proposal. A read-only participant can inspect permitted scope, not answer
on behalf of an accountable owner. Keyboard traversal covers all fields/actions.
The owner can answer “book only; payment is outside this release.” The impact
preview shows candidate intent v2, affected proof obligations and stale plan items.
Confirming a duly authorized reconciliation saves v2, not just a chat message.

Reload reopens the same question/version. Concurrent answer shows both authorized
interpretations and requires reconciliation; no last-write-wins. Offline draft is
marked unsent. Canceled/superseded questions cannot resume work. Denied questions
reveal no hidden objects or counts. Investigation failure retains the unresolved
question and offers an owned next action, not an infinite spinner.

## Proof and gap workbench (SC-08 / SC-11)

Requirement rows display explicit/inferred origin, architecture/plan/artifact links,
proof coverage, evaluator type/version, independence, evidence age, result and owner.
Separate filters: no obligation, not evaluated, failed, indeterminate, evaluator
error, stale, disputed, accepted under a permitted scoped exception. Never use
one green percentage to combine untested, failed and out-of-scope rows.

Selecting a proof opens expected behavior, actual observations, source spans,
input/dependency manifest, calibration, finding severity, diagnostic category and
next allowed route. Show “tests passed; recurring bookings still missing” when
outcome evaluation finds missing work. Request reevaluation does not edit the
test threshold. Changing a criterion opens a versioned change/impact review.
Designer, evaluator, reviewer and release authority have distinct action rights.
Evidence access is checked at read/download time; a revoked link is not cached as
accessible content. Trace queries retain baseline/watermark and explain filtered gaps.

## Repair routing and editable process (SC-06 / SC-07 / SC-08)

Diagram overlay and equivalent Outline/Steps/Criteria forms show current node,
iteration, required proofs, waits, remaining budgets and historical attempts.
Choose a failure route from a registered diagnostic category, inspect its target
node/subprocess and simulate fail/unknown/denied paths before review/publication.
Editing a route never changes a live pinned run silently. Display source profile
and enabled successor side by side; unsupported in-flight migration is explicit.

For missing recurring-booking work, show Plan → Implement → Evaluate as a new
iteration with a reason and linked failed proof. For a storage consistency conflict,
show Architecture review instead. Human can pause/cancel, inspect impact, propose
an alternate diagnosis, or reject infeasible work within decision rights; cannot
click “force green.” Exhausted same-input repairs show “No new evidence: strategy
review required,” attempts, budgets and safe next actions. No automatic paid fallback.

Persist selections/filters in URLs or view preferences, not semantic graph writes.
Undo route edits creates inverse draft commands; completed execution stays immutable.
Loading shows scoped skeletons; empty shows missing prerequisites; stale offers
refresh/compare; conflict preserves edits; failed offers command-status lookup;
denied explains permitted alternatives; success names saved revision; recovery
shows pending runtime delivery/effect reconciliation separately from application save.
Announce status changes without focus theft; provide text equivalents for color,
edges and badges. Large graphs use filtered/table navigation without hiding controls.

## Continuous enterprise impact (SC-03 / SC-24)

During implementation the provider is observed to be eventually consistent while
ADR-A assumes synchronous reads. Evidence drawer records source/activity/time and
confidence. Sentinel finding links the assumption, requirement, ADR, plan and proof.
Proposed reconciliation appears immediately, not after Learn. Existing accepted
authority remains unchanged until its owner acts; dependent protected work is
blocked by the mandatory finding/current-generation rules in the meantime.

Impact tree shows why each field is affected, applicability CURRENT/STALE/INVALID/
UNCERTAIN/SUPERSEDED, underlying truth/evidence status, responsible owner and active
effects. Accepting an authorized successor atomically invalidates downstream uses;
maps may display “Updating from generation 7 to 8” but never offer stale approval
as valid. Unrelated label changes do not stale every tenant object. A hidden object
does not leak via counts, titles, search completion or graph edge endpoints.

## Release, observation and institutional learning (SC-09 / SC-10 / SC-11)

Show independent evidence cards for implementation, verification, release decision,
deployment, service health, outcome observation and acceptance. Observation panel
displays baseline, target, units, source, window, minimum sample and pending gaps.
Healthy software with failed business objective opens outcome/frame work. Late or
duplicate telemetry cannot satisfy the minimum sample twice. Insufficient window
is indeterminate with next evaluation time, not failure or success.

Production regression offers only policy-authorized mitigation/rollback and displays
unknown/irreversible effects honestly. Historical acceptance remains inspectable;
current acceptance may become stale or failed. Learn proposes reusable regression,
rubric or policy updates across runs. Reviewer sees original correction, privacy/
classification, expected behavior, holdout eligibility and impact before adoption.
It never rewrites history or backfills a fabricated earlier pass.

## Golden E2E journey: booking, with deliberately green-but-incomplete code

1. Owner opens intent I1: single and recurring bookings; payment undecided. Record
   safe display assumption; ask one payment-authority question, not available facts.
2. Answer “no payment”; reconcile I2 with explicit non-goal and pinned sources.
   Register O-single and O-recurring plus independent release/outcome obligations.
3. Retrieve authoritative booking API contract and pin architecture/plan/profile.
   Implementer delivers single booking; unit checks pass, but independent actor
   scenario cannot create a recurring series. Persist separate pass and fail.
4. Diagnose missing_work. Controller routes to planning, adds a traced recurring
   increment and returns through implementation/evaluation in a bounded iteration.
   It does not rerun the same implementation indefinitely or delete O-recurring.
5. Independent reviewer verifies a recurring series, conflict handling and deny
   cases. Authorized human release decision binds exact artifact/context; deploy
   to the qualified test target through the effect broker.
6. Seed test observation policy: ten distinct successful authorized bookings in
   sixty minutes, no unauthorized acceptance. Nine at minute 59 is indeterminate;
   replay of an existing ID still counts nine. At minute 60 the tenth valid event
   completes the window. Only then derive outcome_accepted for current I2.
7. Stop the controller after result commit and before workflow notification.
   Restart with no chat transcript. Reconstruct intent, proofs, budgets, decisions,
   pending transition and next action; reconcile once without a second deployment.

Fixture thresholds are test inputs, not universal business promises. Real user
outcome targets require configured accountable owners and evidence. Observe UI,
API, database revisions, outbox, runtime history and actual test-provider effects;
do not construct observed results from the expected-value files.

Mandatory counter-journeys: architectural contradiction → rearchitect; ambiguous
criterion → clarify; revoked authority → wait/deny; broken evaluator → repair judge;
production regression → mitigate/reconcile/rollback; infeasible goal → reject;
simultaneous revision/eval → historical-only result; second tenant → no trace leak;
budget exhaustion → owned stop; two conflicting qualified evaluators → escalate.
