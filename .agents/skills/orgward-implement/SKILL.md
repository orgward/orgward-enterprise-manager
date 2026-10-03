---
name: orgward-implement
description: Implement an OrgWard task in real state, API and UI code with focused behavior and recovery tests. Use for feature work, fixes and vertical slices.
---

For the active continuation, GPT-6.1 Sol owns implementation. Read `AGENTS.md`,
the `TASKS.md` queue header and active outcome, plus only the code needed for the
slice. Implement the smallest complete user-visible behavior. Preserve actual
runtime integrity controls even though broad hardening and qualification are
deferred to `HARDENING-TASKS.md`. Prefer behavior coverage over generated vectors
or structural metadata checks. Sol reviews the diff; Luna is the sole test runner
and runs focused tests only when the tree is ready and verification is requested.
At parent-task completion, freeze the source and have Luna run `npm run check`
once; rerun it only to repair a failed check.

Do not invent product completion from labels or mocks. Preserve unrelated user
work, server-side secrets and explicit authority for external effects. Do not
require a paper packet or pre-implementation review. Record concrete behavior,
verification evidence and remaining functionality directly in `TASKS.md` without
rewriting historical receipts.
