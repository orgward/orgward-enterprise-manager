---
name: orgward-design
description: Turn an OrgWard product outcome or discovered behavior gap into a small implementation task and focused acceptance tests. Not for producing governance packets or paper coverage.
---

For the active continuation, GPT-6.1 Sol owns product design. Read `AGENTS.md`,
the `TASKS.md` queue header and active outcome, plus only relevant runtime/UI code.
State the actor-visible outcome, smallest coherent implementation boundary and
important success, denial, conflict and restart cases. Add or refine the
functionality task in `TASKS.md` when needed.

Use historical product documents only to clarify intent. Do not create manifests,
vector batches, change records or approval packets. If a requested change would
weaken tenant isolation, secret handling or live-effect authority, make that tradeoff
explicit instead of silently removing the safety behavior.

Return an implementation-ready task and focused test outline. Continue into
implementation when the user asked to build, rather than stopping at design
paperwork. Broad qualification belongs in `HARDENING-TASKS.md` and is deferred
until the functionality queue is complete; preserve all runtime controls a path
needs. Luna owns the verification and test runs.
