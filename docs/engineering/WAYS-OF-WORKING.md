# Engineering workflow

The workflow is intentionally small:

1. Select the next unblocked item in `TASKS.md`.
2. Define the user-visible success and important failure/restart cases as tests.
3. Implement the behavior in real state, API and UI code.
4. When the slice is ready, run its focused tests; repair failures in that scope.
5. Review the implementation diff and repair concrete findings.
6. Run `npm run check` once after review; if it fails, repair the affected scope and rerun it.
7. Mark the task complete only when the behavior and task-end check pass.

Historical specifications, vectors, manifests and receipts may explain prior intent,
but they are not prerequisites and are not product evidence. Add process only when it
prevents a demonstrated engineering or safety failure.

Preserve ordinary safety boundaries: tenant isolation, explicit authority for live
effects, server-side secrets, concurrency checks where state can race, recoverable
persistence and no deployment/push without current user authority.
