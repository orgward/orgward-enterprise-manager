---
name: orgward-orchestrate
description: Order OrgWard implementation tasks and coordinate explicitly authorized parallel work using the concise TASKS.md backlog.
---

Read `AGENTS.md` and the `TASKS.md` queue header, then run `npm run task:next` to
check the active cursor against the PR checkboxes. Read the active PR outcome at
the printed line; search receipts only for a concrete dependency. Use the
numbered work order and active section order to choose the first unchecked,
dependency-ready PR. PR IDs do not set sequence.

For the active continuation, GPT-6.1 Sol owns orchestration and implementation;
Luna is the sole verifier/test runner and may handle focused text support. Keep
tool use and context bounded to the current slice. `TASKS.md` contains only the
customer functionality queue; broad hardening and qualification are tracked in
`HARDENING-TASKS.md` and are out of scope until that queue is complete. Do not
confuse deferred qualification with runtime integrity controls needed by a
customer flow.
The current checkboxes and passing receipts override stale goal text, dated notes
and archived backlogs. If an external resource blocks the current PR, keep it
open and scan later sections for independently ready work before treating the
whole goal as blocked. This skill is not a second status ledger.
After the final PR is checked, set the cursor to `COMPLETE` and review release
gates in their own ledgers; `COMPLETE` closes this functionality queue only.
Broad hardening and release qualification remain pending in
`HARDENING-TASKS.md`. Deliver each customer-visible path with the runtime
authority, tenant, secret, intervention, approval/effect and audit controls it
needs. PR-17 precedes PR-16/PR-18 while dependencies permit. Include any
operations needed for safe customer use in the dependent functionality task;
defer only the remaining standalone qualification.

Historical increment notes, `docs/production/` roadmaps, task vectors, packet
instructions and archived backlogs supply requirements and dependencies, not a
competing implementation cursor. Do not restart checked work or treat generated
vectors as passing product tests. After each bounded increment, record one concise
behavior and actual test/demo receipt beside its PR item in `TASKS.md`, including
gaps and skips. Advance the PR checkbox and cursor together only after the entire
outcome, implementation review and required checks pass. Keep P/E release-gate
status and evidence in their separate ledgers. Identify real code dependencies;
assign non-overlapping files only when parallel work was explicitly authorized,
with one integrator for shared state/API contracts.

For customer-facing flows, verify the representative journey in a rendered
browser with `agent-browser` when available. Capture the visible state after key
transitions, check page errors and console output, and keep reload, app restart,
keyboard, and screen-reader evidence distinct. If browser tooling is unavailable,
record the gap in `TASKS.md`; do not infer a rendered or accessible journey from
static markup or API tests.

Do not generate packet digests, model-routing matrices or review bureaucracy. Track
progress in `TASKS.md`; Sol implements and reviews the code, then Luna runs focused
tests when the tree is ready and one `npm run check` at task end after source
freeze. Do not duplicate checks. Summarize tool output instead of copying passing
logs into chat. Never infer permission for pushes, deployments, paid services or
live effects.
