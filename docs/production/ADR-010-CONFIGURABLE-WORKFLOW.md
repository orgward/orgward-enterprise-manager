# ADR-010 — The process is a governed, editable product object

Decision: accepted as a **design requirement**, implementation/review pending.
User instruction 2026-09-19 explicitly requires visually configurable SDLC
steps/substeps, loops, criteria and actions. This supersedes any earlier wording
that fixes S0–S11 as the only executable sequence. No runtime is migrated here.

## Decision and framework boundaries

1. Define a versioned **OrgWard Workflow Profile**: portable typed data for
   business/SDLC orchestration, not generated executable JavaScript or a model
   prompt. The diagram and structured form edit this same canonical definition.
2. Select **bpmn-js** for the browser diagram adapter, alongside schema-driven
   native forms/tree/table editing. It provides embeddable/extensible BPMN modeling;
   it is not our execution engine or permission system. [Official toolkit](https://bpmn.io/toolkit/bpmn-js/).
3. Select **Temporal with TypeScript workers** as the planned durable workflow
   backend. Its workflow history/replay and activity boundary fit long-running
   orchestration. OrgWard will interpret a pinned compiled profile using a versioned
   deterministic workflow implementation; users need not write Temporal code.
   [Official workflow concepts](https://docs.temporal.io/workflows).
4. **LangGraph is optional inside an agent action**, through a pinned adapter.
   Its checkpointers/stores support agent persistence; this does not itself define
   OrgWard's authorizations, business schemas or process editor. Do not make a
   particular model library the canonical enterprise workflow format.
   [Official persistence documentation](https://docs.langchain.com/oss/javascript/langgraph/persistence).
5. Keep PostgreSQL authoritative for domain definitions, approvals, policies,
   grants, budgets, effect intents/results and audit/outbox; S3-compatible storage
   for immutable bytes. Temporal owns orchestration history, not business truth.
   Add `src/platform/workflows/` for compilation, runtime bridge and reconciler.

This is a deliberate refinement of A-02's PostgreSQL-only scheduling baseline:
Temporal owns durable process continuations, timers and orchestration scheduling;
PostgreSQL jobs remain for outbox/projection/compiler/connector work. Do not run
the same process under two competing schedulers. Isolated effect workers remain
behind the broker; a Temporal Activity is **not** an OS security sandbox.

Tradeoff: self-hosting gains a Temporal service/persistence/worker dependency.
Installation, release locks, security boundaries, backup/restore, capacity,
observability and upgrade/replay tests must cover it. No hosted account, purchase,
deployment or dependency installation is authorized by this ADR. Exact package,
server/image and browser-adapter versions are pinned in tested implementation
packets; choosing a brand is not qualification. Failure to qualify is a visible
blocker requiring an explicit revised ADR, not an unrecorded library substitution.

Alternatives: retaining a wholly custom durable process scheduler would leave
timers, recovery and versioned replay as substantial bespoke infrastructure;
we choose reuse plus an explicit adapter. LangGraph remains suitable for agent
internals but is not selected as business authority. Workflow DevKit guidance
reinforces the separation of replayable orchestration from external steps; it
is not adopted in parallel. Eve is not selected: this is an established modular
enterprise stack, not a migration to a filesystem-first agent application.
These choices are project engineering judgments, not comparative benchmark claims.

## Runtime consistency contract

- `StartRun` commits domain run identity + profile/compiled digest + start-intent
  + outbox atomically in PostgreSQL. Workflow identity derives from tenant/run/
  generation. Dispatch retries reconcile the same identity; changed digest under
  it conflicts. Missing runtime acknowledgment remains starting, never running.
- A single generic, versioned deterministic interpreter consumes immutable compiled
  data. Profile edits do not regenerate/redeploy arbitrary worker code. Runtime
  implementation upgrades use a tested compatible replay/version-routing strategy;
  old interpreter builds remain available while their histories need them.
- Activities submit idempotent domain commands and consume durable receipts. Crash
  after a PostgreSQL effect/result commit but before runtime completion returns the
  same result on retry. External effects remain brokered and reconciled: runtime
  retry is not permission to repeat an unknown provider action.
- Human decisions arrive through authenticated OrgWard commands. Runtime messages
  carry decision IDs, never caller-trusted `approved: true`. Replayed/wrong-run/
  expired decisions cannot resume protected work. Signal delivery is outboxed and
  deduplicated; receipt is not evidence the subsequent effect has occurred.
- Runtime history stores references/digests and minimal classified payloads, not
  credentials or unrestricted model traces. Namespace/queue is not the sole tenant
  boundary. Domain access, storage paths, worker identity and effect-time policy
  must enforce tenant scope independently.
- Read UI status from a reconciled projection with domain/runtime watermarks.
  Runtime outage leaves accepted intent and owned recovery visible. Never fall
  back silently to an in-memory scheduler or second engine to appear healthy.
- Restore fences the prior dispatcher generation, reconciles domain and runtime
  histories plus accepted provider effects, then enables one owner. Runtime history
  availability/retention must be included in RPO/RTO, holds and tenant exit policies.

## Mandatory delivery slices within existing tasks

| Slice | Owners | Required deliverable before completion |
| --- | --- | --- |
| WF-S1 semantic contract | T-01/T-19/T-52 | Versioned profile/node/action/criterion schemas, typed expressions, registry, compiler and deterministic simulation fixtures |
| WF-S2 editing | T-03/T-19/T-28/T-51/T-52/T-63 | Diagram + structured editor with equivalent commands, validation, keyboard access, undo, diff and saved drafts |
| WF-S3 publication | T-13/T-53/T-121–T-124 | Immutable template/profile versions, inheritance/override provenance, impact and review; enablement separate from publication |
| WF-S4 execution bridge | T-20/T-21/T-23/T-28/T-52 | Temporal adapter, brokered activities, decisions/timers, bounded iterations, nested budgets, crash/replay/fence evidence |
| WF-S5 operations/interchange | T-08/T-41/T-42/T-43/T-55 | Self-host runtime setup, recovery/replay upgrades, diagnostics, loss-aware BPMN/profile interchange |
| WF-S6 qualification | T-45/T-47/T-48/T-106/T-132 | Real user changes SDLC without code edits, executes both versions, injects faults and proves invariant enforcement |

Existing task IDs and original 480 criteria remain intact. The new WF obligations
are additional required acceptance, not replacement criteria or extra P/E gates.
`ops/check-configurable-workflow.mjs` enforces the overlay and packet linkage in
`check:spec`; original draft packets are historical and do not automatically
satisfy this expanded contract. No workflow task can be completed from a diagram
alone, and no final qualifier can pass while mandatory WF results remain unrun.

Each owning task supplies evidence for its **bounded contribution**, recorded in
`taskEvidence[taskId]` and mapped by `workflowObligationIds` in its reviewed packet.
For example T-01 supplies schema/invalid-fixture evidence, T-08 the installed
runtime, T-41 restore evidence and T-52 advanced runtime semantics. Do not require
the entire cross-task journey before a prerequisite task can finish: that would
create circular dependencies. The global WF result is adjudicated from integrated
evidence; T-132 requires all sixteen passed in addition to all original acceptance.
