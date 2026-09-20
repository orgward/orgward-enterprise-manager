# RM-WORKFLOW-10 — bounded framework decision

Status: completed. Started 2026-09-19 23:49:55 UTC; decision checkpoint
2026-09-20 00:02:28 UTC. Three primary pages opened, zero search queries.
Elapsed through decision documentation: 12m33s, exceeding the default ten-minute
mission target during documentation; no extra sources or research continuation.
Blocker: user's hard requirement for visually editable, versioned SDLC steps,
substeps, criteria, branches and loops. Tasks T-19/T-20/T-28/T-52; P-07/P-08/E-07.
Budget: at most three primary documentation pages, no broad survey or installation.
Reserved one of five shared missions in DELIVERY-STATUS.json before browsing.
Sibling PROGRESS.json was read as zero missions and is read-only in this scope;
the reconciled union must include RM-WORKFLOW-10, leaving four, not five.

Evaluate LangGraph durable-agent scope, Temporal execution/hosting boundary and
bpmn-js visual modeling. Deliver a fixed architecture decision with explicit
tradeoffs and framework qualification obligations, not runtime implementation.

Sources opened:

- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence):
  agent state checkpoints and cross-thread stores. Requested durable-execution URL
  redirected here; no additional page was fetched. Agent persistence does not
  itself define OrgWard's business workflow or authority model.
- [Temporal workflows](https://docs.temporal.io/workflows): code-defined workflow
  execution, event-history replay and external activity boundaries. Chosen as the
  planned orchestration adapter, with OrgWard profile interpretation and effect
  policy outside the workflow history. Not a benchmark or installed integration.
- [bpmn-js](https://bpmn.io/toolkit/bpmn-js/): browser BPMN modeling/embedding and
  extensions. Chosen as diagram adapter alongside equivalent forms; execution
  semantics and supported interchange subset remain OrgWard contracts.

Decision and tradeoffs: docs/production/ADR-010-CONFIGURABLE-WORKFLOW.md.
No dependency installed, no remote system changed, no model/provider called.
The shared allowance is now 1/5 used, four remaining. Local reservation and
completion share RM-WORKFLOW-10; do not add a second mission during reconciliation.
