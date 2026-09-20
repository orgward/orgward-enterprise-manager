# Financial SDLC MVPX runbook

## Start and verify

Run `npm start` from the product root. The service binds to `127.0.0.1:4310` by default. Run `npm run check` for syntax, domain, mutation, API, restart, and isolation verification.

## Golden scenario

Open `/sdlc.html`, create the golden beneficial-owner case, and choose **Run to checkpoint**. The case advances deterministically to protected release approval. Approve as a release approver/control owner, advance release, record the reference outcome, then generate learning. The final traceability view must show the chain from intent through follow-up.

## Negative scenarios

Create a case using a mutation. Run to checkpoint and confirm the expected gate blocks. Mutations are immutable fixture conditions; create a clean case for the positive flow.

## Recovery

Each successful command atomically persists the complete case. Repeating a command with the same idempotency key returns the prior state. After process restart, reload the case and continue from `currentStage`. A version mismatch returns HTTP 409 rather than overwriting concurrent work.

## Safety

The release action records a synthetic release only. It has no deployment connector and cannot affect an external system. Stop the Node process to stop the application. Back up `data/sdlc/` to retain cases; restore only when the service is stopped to avoid replacing a live aggregate.
