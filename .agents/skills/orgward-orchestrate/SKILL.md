---
name: orgward-orchestrate
description: Order OrgWard implementation tasks and coordinate explicitly authorized parallel work using the concise TASKS.md backlog.
---

Read `AGENTS.md` and `TASKS.md`. Use the numbered work order, active section
order, checkboxes and cursor in `TASKS.md` to choose a bounded user outcome within
the first unchecked, dependency-ready PR. PR IDs do not set sequence. Read current
completion from `TASKS.md` every time; the skill is not a second status ledger.
Finish the saved-design-to-result customer journey before standalone broad
security, resilience and operations qualification. Within later PRs, deliver each
customer-visible end-to-end journey first, including the authority, tenant,
secret, intervention, approval/effect and audit controls needed to execute it
safely. PR-17 precedes PR-16/PR-18 while dependencies permit. PR-10 closes the
customer outcome and next-action path; PR-11 carries T-39–T-44 standalone
operations work and core qualification after the customer paths. PR-19 is final
qualification. Implement any operation PR-10 needs for safe use within PR-10;
do not defer a path blocker.
Deliver any part of T-39–T-44 required by PR-12–PR-18 within the dependent PR;
PR-11 closes only the remaining standalone scope and qualification.

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
progress in `TASKS.md`, integrate code, have Luna run focused tests, review the
implementation, then have Luna run `npm run check` once at task end. Give Sol only
bounded design or security questions with only the necessary code slice and request
concise findings. Sol does not run routine tests or broad repository searches. One
Luna owner runs each test suite once when the slice is ready; a long regression may
run alongside independent review, but its result must be checked before closing the
task. Summarize tool output instead of copying passing logs into chat. Never infer
permission for pushes, deployments, paid services or live effects.
