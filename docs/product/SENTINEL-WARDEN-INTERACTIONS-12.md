# Sentinel finding to governed SDLC correction — user scenarios 12

Required future experience, not implemented screens. Continues the business/SDLC
walkthroughs and CONFIGURABLE-WORKFLOWS. Task and fixture detail lives in
[handoff 12](../production/DOMAIN-FIXTURE-HANDOFF-12.md).

## A. Understand the problem without modeling everything first

An architect connects an authorized source subset and opens Sentinel's inbox.
It shows actual coverage, fresh or last-good snapshot and prioritized findings.
They can use a searchable list and keyboard controls without a large graph.
Opening “Two sources claim authority for Customer” reveals the two exact claims,
their evidence, overlapping scope, rule/profile version and business dependencies.
The architect can switch to the graph without losing selection or context.

Low confidence does not hide an accepted contradiction. Unknown scope says
“clarify overlap,” not “these are definitely separate.” A manual business process
does not receive a missing-software defect just because it has no repository.
The user sees what is known, uncertain and outside source coverage separately.

## B. Repair the design and watch the actual resolution

The architect selects supersede, prove a legitimate scope split, or propose a
supported correction. They inspect impact and request an eligible review. Another
reviewer approves the precise change; the claims update, but the graph says
“pending compile.” Only the matching successful compile shows the resolved finding
and exact added/removed relations. A failed compile retains last-good evidence
and a safe retry action. Acknowledging the notification never resolves the issue.

An unrelated conflict remains open. History explains what used to be asserted,
who changed it and why. A physical-column rename preserves its business property's
identity and old lineage rather than replacing all linked knowledge with new names.

## C. Request a temporary exception when correction cannot happen yet

A migration owner proposes a staging-only exception for one candidate, with
rationale, compensating control, evidence, review date and expiry. Independent
review records the bound decision. The finding remains visibly CRITICAL; its
disposition says excepted within that scope, not “fixed” or “low severity.”

The same exception cannot authorize production or another artifact. At expiry,
queued work blocks even if a notification job is delayed. Reviewer revocation
also triggers re-evaluation. The owner receives an actionable reassessment item.
An immutable deny cannot be overridden by any approval. Work already accepted by
an external system is reconciled, not pretended undone by expiry.

## D. Carry integrity into the configurable SDLC process

Sentinel detects a generated onboarding step reading customer email from a replica
instead of the accepted authority. The finding links property → read trace → step
→ process → business outcome. A corrective SDLC case pins those versions, independent
evaluations and policy requirements. Observation alone does not change the accepted
authority to match the faulty implementation.

The process owner can add a data-steward review, collect tests in parallel, or
repeat implementation/test up to a configured bound, using either diagram or forms.
They simulate, review, publish and enable the new workflow version. Existing runs
stay pinned unless explicitly migrated at a safe boundary. Neither removing a
review node nor renaming a task removes required Warden controls.

If relevant authority/evidence changes while release is queued, the old context,
evaluation and approval become stale. The release UI explains the exact dependency
and required repair. Warden checks current authority, artifact/config/context,
budget and obligations at the effect boundary. It does not trust the stage's green
badge. After correction, independent tests and a new bound decision allow the
eligible brokered effect; deployed observations feed a new evidence cycle.

## E. Distinguish source loss, drift and qualification

A connector outage changes coverage/freshness, not design authority. Late evidence
retains both observation time and arrival time. A delayed old compile cannot
replace the current graph. The delta view distinguishes real semantic change,
source coverage change and rule-profile interpretation change.

Customer administrators inspect qualification separately: which source acceptance
cases and rules actually ran, failures, supported profile, restore/failure evidence
and performance measurements. Independent reviewers assess a frozen finding sample,
with disagreements and false positives visible. A passing UI smoke test, attractive
graph or generated sample score cannot make Sentinel production-ready.
