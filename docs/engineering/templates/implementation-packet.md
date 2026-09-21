# Packet integration checklist — not an approved packet

Populate a real JSON packet conforming to contracts/enterprise/work-package.contract.json.
Resolve every entry; use justified not-applicable only where valid. Never register
this checklist as an approved packet.

- taskId/sliceId, actor, trigger, observableOutcome; acceptanceIds and applicable
  workflowObligationIds/contributions; nonGoals and source/architecture digests.
- dependencyReceipts and authentic independentReview; no fabricated readiness.
- For issue #1 affected slices: closedLoopRequirementIds, closedLoopContributions
  (requirementId, bounded scope, testPath), approved CR-019 candidate digest; intent,
  uncertainty dispositions, context sufficiency, proof strategy, diagnostic routes
  and supplemental CL-X cases. Review the proposal before treating it as adopted.
- schemas: full fields/enums/nullability/units/time/typed refs/scopes/invariants,
  input/output/error examples and invalid counterexamples.
- operations: registered command or method/path, request/success/error examples,
  current permission matrix including denials and safe disclosure.
- transitions: from/command/to/precondition/durable result/failureRecovery,
  replay/new-attempt distinction, expectedVersion/head and current epochs.
- transactionBoundary, events/outbox/consumers, idempotencyRule, invalidationRule,
  indexes/isolation, broker/effect reconciliation and secret boundaries.
- migrationRecovery: existing data, compatibility, active runs/effects,
  rollback or forward recovery and immutable history.
- uiStates: loading/empty/stale/conflict/failed/denied/success/recovery; real fields/
  controls, validation, keyboard/screen reader, diagram/form parity and reload.
- fixtures: positive/negative/concurrent/recovery/isolation/end_to_end/cross_boundary;
  complete independent seeds, actual inputs, expected stored/events/effects,
  actual observation adapter and real testPath per acceptance contribution.
- observability, diagnostics, exact versions/topology/providers, bounds and
  verification commands with revision-bound raw results.
- sourceDecisions, nonGoals, unresolved findings, actual review receipt/digest/
  disposition, resume condition and owner.

Complete a parent only after every original AC and child contribution is verified.
Structural validation alone proves neither approval nor product behavior.
