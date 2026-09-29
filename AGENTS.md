# OrgWard Enterprise Studio

Build the private product in this repository. The user outcome is a working
enterprise-design workspace: conversation, saved blueprint, interactive maps,
editable human/agent responsibilities, runnable work, intervention and durable
results.

## Active workflow

`TASKS.md` is the implementation queue. Pick the first unblocked task, write or
update focused behavior tests, and implement the behavior across state/API/UI as
needed. Run the relevant focused tests for each bounded slice, then review the
implementation diff. When the parent PR/task is ready to complete, freeze the
source tree and run `npm run check` once before marking it complete. Do not run
parallel or duplicate full checks. Rerun a full check only to repair a failed run;
review the repair before rerunning. Keep task status honest.

Follow the priority phases in `TASKS.md`: finish the saved/editable business
design and the founder-to-operating end-to-end journey before standalone broad
security, resilience and operations qualification. Keep the necessary authority,
tenant isolation, secret, effect-boundary, intervention and audit controls inside
each customer flow; defer no release gate. PR numbers are stable identifiers, and
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

Use Luna for implementation, routine investigation and every test run. One Luna
owner runs affected focused tests for each bounded slice and reviews the source
diff before the final check. Run one full `npm run check` per parent PR/task, only
after its source tree is frozen and before that parent is marked complete. Never
run duplicate or parallel full checks. If a full check fails, repair the cause,
review the repair and rerun the full check. A long check may run in the background
while the source tree stays fixed, but the task remains open until its result is
reviewed. Keep logs on disk; report counts, elapsed time, skips and relevant
failures accurately. The runner's shared PostgreSQL cluster per invocation,
per-fixture database isolation and `--test-concurrency=2` remain unchanged: this
VPS has 2 CPUs and limited `/tmp` tmpfs headroom. Legacy specification validators
are optional historical diagnostics.

Consult Sol only for a rare material design or security boundary. Send the exact
question and minimum code slice; request a short finding and recommendation, with
no routine tools or tests. Preserve strong design and review judgment. Use targeted
search and narrow file reads, avoid duplicate checks across agents, and keep chat
updates concise.
