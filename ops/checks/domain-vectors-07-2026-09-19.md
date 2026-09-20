# Domain-fixture elaboration 07 — verified checkpoint

Checked: 2026-09-19 15:09:04 UTC
Revision: `tree-sha256:9e2788709bed11cb41f078989e4d349d870ceb9d096e29d74fcdc1a182f0e634` (222 files).
[Tree manifest](domain-vectors-07-tree.json) · [raw checks](domain-vectors-07-check-results.json).

## Saved work

38 concrete domain scenario vectors, 226 expected observations, covering all
listed acceptance IDs for T-02–T-07, T-49, T-68, T-77, T-119 and T-123.
Inputs, actual interaction/fault schedules and expected UI/storage/event/effect
observations are authored before implementation. The
[handoff](../../docs/production/DOMAIN-FIXTURE-HANDOFF-07.md) specifies how future
real test adapters collect independent observations and prohibits copying the
expected result or substituting helper-only tests.

The comparator is executable; the application adapters/tests are not implemented.
Its positive self-tests deliberately construct synthetic documents from expected
values. That tests the comparator, not the product. No domain acceptance pass,
reviewer, provider result or observed runtime safety property is claimed.

## Observed checks

- `npm run check`: exit 0, 36/36 existing application tests.
- `node ops/check-spec.mjs --self-test --verify-sources`: exit 0.
- 38 comparator positive self-tests; 264 wrong/missing observation rejections;
  13 invalid vector-definition rejections.
- All prior draft/additional-command/architecture/portfolio checks retained.
- 27 pinned local research hashes verified.
- 35 runtime/UI/existing-test/package files match increment 06 unchanged.
- No browser journey, database race, credential revocation timing, remote effect
  or cutover was executed by this domain-specification check.

## Remaining and release accounting

442/480 original scenarios across 121 other tasks still lack this concrete-vector
layer. These 38 also need domain review, actual adapter implementation and test
execution. All 132 packet reviews remain unapproved; all original task acceptance
statuses remain not_run. Original source/task/story IDs and dependencies retained.
No claim that one vector exhausts every nuance of a compound original scenario.

P-01 conversation, P-02 blueprint, P-03 integrity, P-04 map: historically verified.
P-05 editing, P-06 responsibility, P-07 plan, P-08 interventions, P-09 real model,
P-10 full persistence, P-11 coverage, P-12 full demo: pending.
Original gates remain 4/12; production remains 0/16, with E-07/E-15 in progress.
No AI/SQ/source acceptance promoted; research mission allowance unchanged.

Also preserved from preceding increment: 73 specified secondary command
definitions and model recommendations for all 132 parent tasks. Neither model
choice nor more detailed test definitions establish production readiness.

Saved locally in the existing product folder. No feature implementation,
deployment, Git commit/push, server permission change or external transaction.
