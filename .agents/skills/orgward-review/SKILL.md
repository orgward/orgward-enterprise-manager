---
name: orgward-review
description: Review OrgWard design packets, requirement changes or implementations against intent, contracts and actual evidence. Produces findings, not automatic release certification.
---

Paths below are repository-root relative. Read product AGENTS.md,
docs/engineering/WAYS-OF-WORKING.md, docs/engineering/CHANGE-CONTROL.md and
docs/engineering/prompts/review.md. Inspect exact candidate revision, raw source
requirements and original acceptance, not only the author's summary. Use
docs/engineering/templates/review.md.

Trace actor to interaction, command, durable state, effect and observable outcome.
Check denial/recovery/concurrency/isolation, current authority, immutable history
and workflow diagram/form equivalence. Look for copied expected values, vacuous
zero-effects, omitted matrix rows, mock substitution and false readiness claims.

For changes compare old/new obligations, lost intent, control weakening, stale
dependent reviews and migration consequences. Run scoped diagnostic checks; do not
edit the candidate during review without a separately authorized new revision.
Record reproducible findings with file/criterion, severity, impact and repair.

If you authored the candidate, label self-review, not independent approval.
Another model's agreement does not establish independence or customer/security
certification. An independently scoped agent review supplies engineering findings
when authorized; required accountable sign-off remains separate. Never impersonate
an absent reviewer. Leave missing evidence and approval explicitly pending.
