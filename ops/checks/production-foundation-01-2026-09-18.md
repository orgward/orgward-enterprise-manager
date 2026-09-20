# Production foundation 01 receipt

- Checked at: `2026-09-18T20:09:02Z`
- Product revision: `tree-sha256:614f918fded05480adfccfd83b27864ccb3910488792d349826253aab5d37fd8`
- Revision scope: sorted SHA-256 digest of `.gitignore`, `server.mjs`, `package.json`, `README.md`, and files under `src/`, `public/`, `tests/`, `docs/`, and `workers/`
- Product check: `npm run check`
- Product result: **PASS — 35 passed, 0 failed, 0 skipped**
- Generated-system check: `node --test` in the live generated inventory-service workspace
- Generated-system result: **PASS — 1 passed, 0 failed**
- Laptop-browser flow: Chromium 153 at 1440 × 900
- Browser result: **PASS — request → independent approval → execute → six artifacts → evidence/activity view; no overflow, console errors, or uncaught page errors**

## Verified implementation

- The API exposes only administrator-configured execution profiles; browser requests cannot specify an executable, arguments, shell fragment, environment, or workspace path.
- Profiles require an absolute executable and fixed string arguments. Process invocation uses `shell: false`.
- A requester creates an immutable work item; the same claimed identity cannot approve it and the `execution-approver` role is required.
- Approval binds to the work-item hash. A changed work item cannot execute under stale approval.
- Each run receives a unique workspace beneath the profile's configured root.
- Artifact inspection skips symlinks and enforces file-count, per-file-size, and aggregate-size limits.
- Stdout/stderr are bounded and common credential patterns are redacted before API exposure.
- Run state, approval, events, hashes and result survive reload. Tenant-scoped reads reject another tenant.
- A control-plane restart converts a persisted `RUNNING` record to `INTERRUPTED` rather than presenting it as successful.
- The live included worker created `Dockerfile`, `README.md`, `orgward-manifest.json`, `package.json`, `src/server.mjs`, and `test/service.test.mjs` with content hashes.
- The generated inventory service's own HTTP health test passed.
- The public run view exposes `workspace:<run-id>` rather than a server filesystem path.

## Deliberately unverified

This receipt does not complete a production-readiness gate. The current identity and roles are request claims, not authenticated enterprise principals. Execution is synchronous and local, not queued or scheduled. Filesystem separation is not container/microVM isolation. There is no network egress policy, secret-manager integration, Git provider, real coding-model provider, build farm, artifact registry, deployment target, HA, backup/restore validation, penetration test, or pilot installation.

Those requirements remain pending in `PRODUCTION-READINESS.json`. The synthetic SDLC's 14/14 score remains a reference-contract score only.
