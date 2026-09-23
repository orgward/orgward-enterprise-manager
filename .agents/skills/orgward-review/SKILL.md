---
name: orgward-review
description: Review implemented OrgWard code and tests for correctness, security boundaries, persistence, failure behavior and usability. Use after implementation, not as a paperwork gate.
---

Read `AGENTS.md`, `TASKS.md`, the implementation diff and the affected tests. Use
the implementer's focused test result and inspect actual state/API/UI behavior; ask
Luna to run an additional focused test only when a concrete finding needs it. Look for missing functionality,
unsafe permissions, tenant leaks, stale-write races, non-idempotent retries, restart
loss, misleading UI and tests that only assert labels or copied expectations.

Report findings first with file/line, impact and a concrete repair. If no material
finding remains, say so and list the tests run. Review the implementation that exists;
do not require manifests, digests, vector coverage or formal receipts, and do not
claim customer, legal, security or release certification.
