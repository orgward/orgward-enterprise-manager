# OrgWard Enterprise Studio

## Current continuation scope (2026-10-03)

The 17 stable functionality IDs are PR-01–PR-10 and PR-12–PR-18. Derive live
progress from `TASKS.md` and `npm run task:next`, rather than from this
instruction. Broad hardening, security, resilience, operations and release
qualification is a later phase tracked in `HARDENING-TASKS.md`; do not start it
during this functionality pass. This defers broad qualification, not integrity
required for working product paths: keep tenant isolation, server-only secrets,
exact candidate identity, explicit approval/effect authority, intervention and
audit controls where those flows need them.

For this continuation, GPT-6.1 Sol owns implementation, orchestration, design and
code review. Luna is the sole verifier/test runner and may provide focused
text/document support. Keep tool use, context and reads concise and bounded to
the active slice; Luna runs focused tests only when a slice is ready and the
integrator coordinates verification, then runs one full check against the frozen
parent task tree. Preserve historical receipts and completed PR-01–PR-07 status.

Build the private product in this repository. The user outcome is a working
enterprise-design workspace: conversation, saved blueprint, interactive maps,
editable human/agent responsibilities, runnable work, intervention and durable
results.

## Active workflow

`TASKS.md` is the functionality queue. Pick the first unblocked task and
implement the behavior across state/API/UI as needed. Run focused tests for each
bounded slice only when ready, then freeze the source tree and run `npm run check`
once at parent-task completion. Do not run parallel or duplicate full checks.
Rerun a full check only to repair a failed run; review the repair before
rerunning. Keep task status honest.

Follow the priority phases in `TASKS.md`: finish the customer functionality
journeys before standalone broad hardening and qualification in
`HARDENING-TASKS.md`. Keep actual runtime integrity, necessary authority, tenant
isolation, secret, effect-boundary, intervention and audit controls inside each
customer flow. Deferred broad qualification does not make these product controls
optional or close any release gate. PR numbers are stable identifiers, and
the order of active queue sections determines the next task. Mark implementation
tasks separately from production gates, whose evidence and status remain in their
own ledger. At the start of a continuation, run `npm run task:next`; its read-only
check derives the first open PR from the active checkboxes in `TASKS.md` and fails
if the written cursor disagrees. Read the queue header and the active PR outcome
at the printed line; search its receipts only for a concrete decision.
Current checkboxes and passing receipts override older goal snapshots, increment
narratives and archived backlogs. If a required resource blocks that PR, keep it
open and check later queue sections for work whose
dependencies are ready. Do not block the whole goal while such work remains.
Change a PR checkbox and the cursor together only after its complete behavior,
checks and implementation review pass. After the last PR, set the cursor to
`COMPLETE` and keep release-gate qualification separate.

Do not require change records, manifests, generated vectors, packet digests or
review receipts before ordinary implementation. The files under `contracts/`,
`docs/production/` and older `ops/checks/` remain useful design history, but they
are not implementation gates and do not count as passing product tests.

Review happens after implementation. Review observable behavior, failure handling,
persistence, tenant/permission boundaries, usability and regression coverage. Fix
findings in code and tests. Do not create review loops around metadata.

## Product and safety boundaries

- Preserve the product direction in `../orgward-research/PRODUCT-BRIEF.md` and the
  twelve release outcomes in `../orgward-research/RELEASE-GATES.md`; implement them
  through tasks and executable tests rather than paper coverage matrices.
- Reuse the current Node.js application and its persisted stores. Avoid duplicate
  implementations and static UI claims that have no backing behavior.
- Keep secrets server-side, tenant data isolated and protected effects explicitly
  authorized. Exercise denial, conflict and restart paths when they matter.
- Do not deploy, push, send external messages, spend money or perform live business
  effects unless the user explicitly asks.
- Preserve unrelated user changes. Work in bounded increments and report what is
  actually implemented and tested.

Luna is the sole verifier and test runner. Keep logs on disk; report counts,
elapsed time, skips and relevant failures accurately. The runner's shared
PostgreSQL cluster per invocation, per-fixture database isolation and
`--test-concurrency=2` remain unchanged: this VPS has 2 CPUs and limited `/tmp`
tmpfs headroom. Legacy specification validators are optional historical
diagnostics. Keep investigations and reads focused; do not duplicate test runs.
