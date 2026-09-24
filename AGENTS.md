# OrgWard Enterprise Studio

Build the private product in this repository. The user outcome is a working
enterprise-design workspace: conversation, saved blueprint, interactive maps,
editable human/agent responsibilities, runnable work, intervention and durable
results.

## Active workflow

`TASKS.md` is the implementation queue. Pick the first unblocked task, write or
update focused behavior tests, implement the behavior across state/API/UI as needed,
review the implementation diff, then run `npm run check` before marking the task
complete. Keep task status honest.

Follow the priority phases in `TASKS.md`: finish the saved/editable business
design and the founder-to-operating end-to-end journey before standalone broad
security, resilience and operations qualification. Keep the necessary authority,
tenant isolation, secret, effect-boundary, intervention and audit controls inside
each customer flow; defer no release gate. PR numbers are stable identifiers, and
the order of active queue sections determines the next task. Mark implementation
tasks separately from production gates, whose evidence and status remain in their
own ledger. Follow the active cursor in `TASKS.md`: PR-01–PR-05 are complete,
PR-06 is first open, and PR-07 follows. Older increment narratives and archived
backlogs cannot reset that cursor; change it only when the task checkbox is
supported by passing behavior checks and the implementation review.

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
owner runs affected tests when a task slice is ready, reviews the diff, then runs
`npm run check` once; rerun only to repair failures. A long check may run in the
background while the source tree stays fixed, but the task remains open until its
result is reviewed. Keep logs on disk; report counts, time and relevant failures.
Legacy specification validators are optional historical diagnostics.

Consult Sol only for a rare material design or security boundary. Send the exact
question and minimum code slice; request a short finding and recommendation, with
no routine tools or tests. Preserve strong design and review judgment. Use targeted
search and narrow file reads, avoid duplicate checks across agents, and keep chat
updates concise.
