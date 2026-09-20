# Configurable workflow + continuation checkpoint 10 — 2026-09-20

Revision: `tree-sha256:1227869b1e384e0fdbbb90bf58728ff1440bcaad98c0b842369904cc16916dc5`, 235 hashed files.
Manifest: [configurable-workflow-10-tree.json](configurable-workflow-10-tree.json).
Raw checks: [configurable-workflow-10-check-results.json](configurable-workflow-10-check-results.json).
The manifest and this receipt are excluded from their own hash scope.

## User-requested design change

The SDLC process is now a mandatory editable, versioned workflow definition,
not a fixed twelve-stage runtime. Diagram and structured forms must both support
steps/substeps, actions/criteria, conditions, parallelism, bounded loops,
subprocesses, human decisions, simulation, history and safe active-run migration.
Template stages retain historical traceability; required policy obligations do
not depend on their labels or presence as diagram nodes.

[Contract](../../docs/product/CONFIGURABLE-WORKFLOWS.md) and
[ADR-010](../../docs/production/ADR-010-CONFIGURABLE-WORKFLOW.md) choose bpmn-js
for the diagram adapter and Temporal for the planned durable runtime, with an
optional LangGraph adapter inside agent actions. This deliberately changes the
earlier PostgreSQL-only process scheduling baseline, retaining PostgreSQL domain,
authority, effects and outbox ownership. Runtime isolation and current broker
authorization remain mandatory; durable retries cannot repeat unknown effects.

The workflow skill guidance informed the distinction between orchestration and
external steps; no library runtime, cloud account or dependency was installed.

Sixteen mandatory WF obligations are linked in both backlog and architecture.
The specification check enforces active-packet linkage, per-task contribution
evidence and final integrated WF qualification. Contribution scope avoids making
prerequisite schema tasks depend circularly on downstream runtime qualification.
Old draft packets are not automatically approved. Global WF results remain 0/16.

## Continued original roadmap

Added 24 original-criterion vectors, 120 expected observations, for T-50–T-55:
organisation scopes, synchronized lenses, advanced processes, semantic merge,
progressive realization/reverse trace and loss-aware interchange.

Cumulative 188/480 original scenarios, 1,049 observations across 59/132 tasks;
292 scenarios across 73 tasks still lack that vector layer. The 16 new workflow
obligations are additional acceptance, not included or hidden in 480.

## Verified checks

| Check | Observed result |
| --- | --- |
| npm run check | Pass: syntax, all 36 existing app tests, specification suites |
| Final check-spec --self-test --verify-sources | Pass; 27 pinned local sources match |
| Domain comparator | 188 synthetic positive / 1,237 negative comparisons |
| Invalid vector / source index | 13 / 10 rejected mutations |
| Workflow guard | 16 rejected mutations; 1 synthetic bounded-contribution structure check |
| Earlier rejection suites | 8 plan, 16 portfolio, 17 architecture/packet, 37 draft/example, 365 supplemental schema/type |
| Preservation | 35 runtime/UI/test/package files and 3 earlier vector modules unchanged; all 132 original task objects match historical packet hashes |
| DST fixture sanity | Both stated UTC instants format to London 01:30 using this host Intl; not scheduler qualification |
| New actual domain or workflow acceptance | 0 |
| New independent reviewed packets | 0 |

The application behavior is unchanged. There is no implemented visual workflow
editor, Temporal bridge, runtime conformance, real provider call, browser journey,
active-run migration or self-host qualification from this increment. Metadata
checks do not authenticate reviewer identity or prove actual production behavior.

## Fixed release gates

| Gate | Retained status |
| --- | --- |
| P-01 | verified historically |
| P-02 | verified historically |
| P-03 | verified historically |
| P-04 | verified historically |
| P-05 | pending |
| P-06 | pending |
| P-07 | pending |
| P-08 | pending |
| P-09 | pending |
| P-10 | pending |
| P-11 | pending |
| P-12 | pending |

Private gates remain 4/12. Production remains 0/16: E-07/E-15 in_progress,
all other E gates pending. No gate was promoted; all original task/acceptance
statuses remain planned/not_run.

## Research and next boundary

RM-WORKFLOW-10 opened three official pages, no searches. Shared allowance now
1/5 used, four remaining. Local ledger reserves/completes this unique mission;
the read-only sibling ledger awaits reconciliation and must not reset the count.
The research receipt records its 12m33s documentation-inclusive elapsed time,
including the default ten-minute target overrun. No further research followed.

Next original scenario slice: T-56–T-67. Before feature implementation, complete
actual schemas/seed bytes, adapter contracts and independently reviewed bounded
packets, including the new WF contribution. No deployment, remote write,
purchase or source commit was performed. Saved locally; stop after this increment.
