---
name: orgward-design
description: Turn an OrgWard product outcome or discovered behavior gap into a small implementation task and focused acceptance tests. Not for producing governance packets or paper coverage.
---

Read `AGENTS.md`, `TASKS.md` and the relevant runtime/UI code. State the actor-visible
outcome, the smallest coherent implementation boundary and the important success,
denial, conflict and restart cases. Add or refine the task in `TASKS.md` when needed.

Use historical product documents only to clarify intent. Do not create manifests,
vector batches, change records or approval packets. If a requested change would
weaken tenant isolation, secret handling or live-effect authority, make that tradeoff
explicit instead of silently removing the safety behavior.

Return an implementation-ready task and test outline. Continue into implementation
when the user asked to build, rather than stopping at design paperwork.
