---
name: orgward-orchestrate
description: Order OrgWard implementation tasks and coordinate explicitly authorized parallel work using the concise TASKS.md backlog.
---

Read `AGENTS.md` and `TASKS.md`. Choose the smallest unblocked user outcome, identify
real code dependencies and assign non-overlapping files only when parallel work was
explicitly authorized. Keep one integrator for shared state/API contracts.

Do not generate packet digests, model-routing matrices or review bureaucracy. Track
progress in `TASKS.md`, integrate code, have Luna run focused tests, review the
implementation, then have Luna run `npm run check` once at task end. Give Sol only
bounded design or security questions with only the necessary code slice and request
concise findings. Sol does not run routine tests or broad repository searches. One
Luna owner runs each test suite once when the slice is ready; a long regression may
run alongside independent review, but its result must be checked before closing the
task. Summarize tool output instead of copying passing logs into chat. Never infer
permission for pushes, deployments, paid services or live effects.
