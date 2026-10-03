---
name: orgward-review
description: Review implemented OrgWard code and tests for correctness, security boundaries, persistence, failure behavior and usability. Use after implementation, not as a paperwork gate.
---

For the active continuation, GPT-6.1 Sol owns implementation review. Read
`AGENTS.md`, the `TASKS.md` queue header and active outcome, the implementation
diff and only affected tests. Inspect actual state/API/UI behavior and the
available focused test result; ask Luna for an additional targeted test only for
a concrete finding and coordinate its run. Look for missing functionality,
unsafe permissions, tenant leaks, stale-write races, non-idempotent retries,
restart loss, misleading UI and tests that assert only labels or copied
expectations.

Report findings first with file/line, impact and a concrete repair. If no material
finding remains, say so and list the tests run. Review the implementation that
exists; do not require manifests, digests, vector coverage or formal receipts, and
do not claim customer, legal, security or release certification. Broad security
and release qualification remains in `HARDENING-TASKS.md`.
