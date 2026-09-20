# People, governance and agents in a configurable SDLC — scenarios 13

Required future behavior; not a report of implemented UI. See
[handoff 13](../production/DOMAIN-FIXTURE-HANDOFF-13.md) for exact fixtures,
transaction/recovery choices and remaining implementation evidence.

## 1. Change policy without silently changing permission

A policy owner drafts a stricter release policy. They compare old/new decisions
on authorized redacted requests, inspect affected queued work and see mandatory
recovery that would be stranded. Simulation performs no effects. An eligible
reviewer approves a bounded staging rollout; other workspaces stay on their current
assignment. A rollback creates a new policy activation—it does not turn a previous
denied deployment into an approved one. An outage pauses protected work visibly.

## 2. Ask the right people and preserve the decision

A release case shows the precise artifact, environment, configuration, evidence,
current eligible reviewers and required quorum. Two independent reviewers vote
with rationale. A requester cannot count again through another role, alias account
or child agent. If a reviewer leaves, their history remains but current eligibility
is recomputed; an authorized substitute must cast a new vote. No reviewer available
means blocked/escalated, never “approved because nobody objected.”

Changing the artifact or evidence returns the request for fresh review. A lost
response or concurrent vote reconciles against the durable decision, not a second
approval. An appeal has its own review and may create a superseding decision while
preserving the old record. Emergency access is narrow and expiring; even an admin
cannot waive immutable denial or a mismatched artifact. Already dispatched external
work remains visible for reconciliation and after-action review.

## 3. Govern the information the system will use

A steward resolves “Customer” and “Client” as aliases of one entity, while leaving
an unrelated same-named entity in another scope alone. Ownership transfer requires
acceptance, not merely frequent usage. Departure creates visible orphan-control
work until an eligible successor takes responsibility.

The steward tightens email evidence to restricted. Old downloads and retrieval
permissions are rechecked before further disclosure, even if a map still shows an
older projection. A quality view reports 8 invalid records out of 100, the source,
window and owner. A later 2-of-100 result can show improvement; source outage shows
unknown, not perfect quality. Holds and active decision dependencies block disposal
with a reason. Removing a connector does not mean all its evidence was erased.

## 4. Delegate implementation while keeping one authority and budget boundary

A supervisor selects an evaluated agent version, instructions, permitted tools,
repository scope and budget. The resulting capability is the intersection of the
role, policy and autonomy envelope. Adding a new tool or model invalidates relevant
evaluation; the old green badge cannot enable broader work.

The SDLC owner visually adds two specialist substeps or edits them in structured
forms. Handoffs carry exact evaluated artifacts and context, narrowed capabilities
and shares of the same budget. With 1,000 tokens total, reservations of 400 and 500
do not create 900 extra tokens for each child. Usage of 300 and 450 leaves 250
available after reconciliation. Unknown provider spend stays reserved.

The owner can add a human checkpoint, bounded repair loop and escalation path.
Pausing the parent fences new descendant effects and shows which remote actions
remain uncertain. After an acknowledged safe pause, revised instructions create
a successor attempt; old outputs remain, and stale approvals do not transfer.
A planner-created “reviewer” agent cannot independently approve its parent's work.

## 5. Inspect what happened and whether it worked

The auditor follows design → decision → effect intent → provider observation using
actual identities, revisions and causal references. Concurrent actions need not
have a fabricated total order. Duplicate events, missing predecessors and tampering
are distinct findings. If required audit admission fails, protected dispatch blocks.

An authorized export includes versions, hashes, public trust history and declared
gaps, never signing secrets. An independent offline verifier can find valid
signatures and still report incomplete evidence. Key rotation preserves historical
verification under its trust policy; stale revocation information limits the claim.

Finally, a technically qualified agent can still produce a proposal that misses
the business target. The owner sees evaluation success and business failure as
separate facts. Learning creates a reviewed correction. Provider fallback also
requires its own evaluation, permitted data location and available budget—not an
invisible change of model or billing account.

All journeys need real persisted commands, readable failure/recovery states,
keyboard/list alternatives and evidence after reload/restart. Configurable diagrams
must change process behavior; they must never bypass these underlying controls.
