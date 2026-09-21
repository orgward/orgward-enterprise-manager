# OrgWard engineering operating guide

Checkpoint 19: when designing affected SDLC/evaluation/knowledge packets, load the
source-linked closed-loop-obligations-19.json and CLOSED-LOOP-CONTROL-19.md.
CR-019 is a proposed architecture enrichment, not an approved implementation packet.
Record intent/uncertainty/context/proof coverage and diagnostic failure routes in
packets. For our own work distinguish schema checks, product evidence and accepted
outcome; a failed test may require replanning or clarification, not repeated edits.
The proposed product controller does not automatically switch this coding model.

This governs work on OrgWard, not its product workflow runtime. Product execution
still requires the versioned workflow/Temporal/broker contracts. Keep the goal:
coherent enterprise design and operation, SDLC and governance—not a static demo.

## Start and route

Use the product root and AGENTS.md; inspect current work and latest receipt.
Select one user outcome, its canonical task/dependencies, draft, vectors and
applicable source/WF/journey obligations. “Continue” does not mean start all tasks.

| Work | Skill / prompt | Output |
| --- | --- | --- |
| Design/improve requirements | orgward-design / prompts/design.md | Exact packet or governed change proposal |
| Build reviewed slice | orgward-implement / prompts/implement.md | Working UI/API/state and actual recovery evidence |
| Evaluate candidate | orgward-review / prompts/review.md | Revision-bound findings and authentic disposition |
| Coordinate authorized work | orgward-orchestrate / prompts/orchestrate.md | Dependency-safe briefs and integration plan |

Skills are in `.agents/skills`. Start a Codex session in this repo for discovery,
or explicitly read the absolute SKILL.md path from an outside chat. No global
configuration is changed. See [official skills guidance](https://learn.chatgpt.com/docs/build-skills).

## Models and subtasks

Retain all 132 parent recommendations in
`contracts/enterprise/agent-assignment-policy.json`. Run
`node ops/engineering-task.mjs T-123 --role implement` for read-only routing.
It never starts a model, approves a packet or changes task status.

| Work | Preferred profile |
| --- | --- |
| Bounded implementation | Terra High unless parent already requires Sol |
| Requirements/design/integration/review/orchestration | Sol High |
| Authority/concurrency/temporal consistency/cutover/irreversible effects | Sol XHigh |
| Mechanical leaf with frozen reviewed semantics | Luna Medium |

These are project recommendations, not measured OrgWard benchmarks. Their role
split aligns with [official model guidance](https://learn.chatgpt.com/docs/models).
Record actual model/effort and divergence. Verify available IDs/settings in the
harness; do not silently downgrade high-risk work or switch billing/provider on
quota failure. Max is deliberate escalation for a demonstrated hard problem.
Astra would be an explicit future choice, not an unrequested migration. Ultra
or automatic delegation is not the default.

A tiny file can carry a high-risk decision. Luna may render approved controls or
transcribe independent fixtures, not invent authority, migrations, state machines
or acceptance. Leaf extraction under a Sol parent excludes those decisions and
retains stronger integration/review. Model identity does not prove independence.

## Readiness and review

Discovery → bounded proposal → exact packet → independent engineering review →
eligible implementation → actual verification → completion review. Customer,
security and release sign-offs remain separate required authorities.

Use `contracts/enterprise/work-package.contract.json`. The Markdown packet
template is a checklist, not a competing schema or approved packet. The original
480 criteria have definitions, but zero packets are approved by that alone.
A prerequisite schema slice need not pass a downstream full runtime; record its
bounded contribution and never equate it with that runtime passing.

Review raw sources and candidate artifacts, not author summaries alone. Record
reviewer/session, author relationship, actual model, exact digest, scope, findings
and disposition. Authorized independent agent review supplies engineering findings,
not impersonated customer/security/release approval. Missing reviewer means
ready-for-review, not self-approved. Material changes invalidate affected reviews.

## Orchestration and limits

This guide creates no standing delegation permission. When explicitly authorized,
parallelize concrete independent work that adds value alongside local work.
Otherwise use the same briefs sequentially. Each brief binds task/slice/AC IDs,
sources/digests, prerequisite receipts, owned files, operations, limits, profile,
independent oracle, expected evidence and stopping condition.

One integrator owns shared contracts/dependency graph/ledgers. Avoid overlapping
writers; use worktrees where supported without discarding user work. Recheck the
integrated revision after parallel work. Shared changes stale affected briefs and
reviews. Child success cannot close a parent with missing criteria. Never delegate
missing semantic decisions as if they were ready coding work.

Aggregate resource limits across children. Honor harness concurrency/permissions.
Two same-cause failed repair attempts trigger a checkpoint/replan, not blind loops;
a new diagnosis may justify another bounded attempt. Quota always checkpoints and
waits; no automatic billing, purchases or credit redemption.

## Evidence, resume and publication

For each AC capture inputs, independent expected results, actual UI/API/store/
event/artifact/provider observations, faults, revision, versions and raw results.
Never construct observations from expected vectors. Mocks, labels and structural
checks do not replace actual required behavior. Use relevant installed framework/
browser skills for implementation verification.

`npm run check` includes regressions, spec checks and engineering-asset checks;
also run packet-specific acceptance. Preserve P12/E16, additional WF16 and source
journeys. Process-only work passes no product gate. Fail/interrupted/unrun are explicit.

Save unfinished operation, packet/source digest, owned files, checks, pending
effects, blocker/owner and next safe step. Revalidate disk/remote/dependencies on
resume. Push/deploy/live effects need current authority. An authorized push is source
publication, not deployment. Review/scan staged bytes, commit, push without force,
verify remote SHA, and report accurately.

## Improvement and maintenance

Follow [change control](CHANGE-CONTROL.md) whenever evidence warrants improving
requirements, UX, architecture or acceptance. A plan must not force a known defect.
Update affected skills/prompts/templates/checks together when actual usage exposes
a gap. Keep skill entrypoints small; structural validation cannot prove obedience.
