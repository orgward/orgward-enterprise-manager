---
name: orgward-implement
description: Implement an authorized bounded OrgWard packet with contracts, backend, usable UI and evidence-backed recovery tests. Not for status questions or unapproved packet drafts.
---

Paths below are repository-root relative. Read product AGENTS.md,
docs/engineering/WAYS-OF-WORKING.md, the approved packet,
dependency/review receipts and docs/engineering/prompts/implement.md. Confirm actual
readiness; a vector or template is not approval. Use the existing product directory.

Implement the reviewed slice from independent seed/oracle and contract tests to
durable domain/API/worker behavior and usable UI. Read-only work need not invent
writes. Verify stored state, artifacts and actual effects independently of labels;
exercise denial, races, restart and recovery. Preserve parent acceptance mappings
and applicable bounded workflow contributions.

If a failure exposes a specification flaw, retain it and follow
docs/engineering/CHANGE-CONTROL.md. Pause affected semantics, not unrelated safe
authorized work. Never weaken an oracle or bypass an unmet prerequisite silently.
Use relevant installed framework/browser skills where applicable.

Record actual model/effort, packet/source digests, commands, raw results and limits
with docs/engineering/templates/evidence-receipt.md. Baseline npm run check is not
full enterprise acceptance. Preserve user work; no push/deploy/live effect beyond
current authority. Stop after the slice, or checkpoint on quota/blocker.
