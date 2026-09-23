---
name: orgward-implement
description: Implement an OrgWard task in real state, API and UI code with focused behavior and recovery tests. Use for feature work, fixes and vertical slices.
---

Read `AGENTS.md`, `TASKS.md` and the affected code. Implement the smallest complete
user-visible slice. Prefer behavior tests over generated vectors or structural
metadata checks. Exercise relevant success, denial, conflict, isolation and restart
paths, then run the focused tests when the slice is ready. Review the diff, repair
findings, and run `npm run check` once at task end; rerun it after any fix to a
failed full check.

Do not invent product completion from labels or mocks. Preserve unrelated user work,
server-side secrets and explicit authority for external effects. Do not require a
paper packet or pre-implementation review. Hand the finished diff to code review;
record concrete failures and remaining tasks directly in `TASKS.md`.
