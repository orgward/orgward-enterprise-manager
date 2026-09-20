# OrgWard portfolio contract — revision 3

Revision-4 extension: [solution architecture](../production/SOLUTION-ARCHITECTURE.md), [change protocol](../production/CHANGE-PROTOCOL.md) and [migration/coverage](MIGRATION-AND-COVERAGE.md) govern the expanded SaaS/migration/all-angle consistency target. T-132 now qualifies the full target after the preserved revision-3 portfolio baseline. Original module semantics and source compatibility decisions below remain binding.

2026-09-18. Normative target specification, **not implemented capability, customer approval, compliance certification or production evidence**. This expands revision 2 in response to the user's explicit request for the whole OrgWard vision. It does not enlarge or reset the original 12 release gates or the 16 enterprise qualification gates.

## What the customer should be able to accomplish

Start with a conversation or existing evidence; construct and revise a coherent organisation; navigate it from any relevant perspective and level of detail; allocate authority, people, agents and resources; operate governed processes; turn system-level intent into delivered software; detect divergence; decide corrections; and prove what happened. A non-software enterprise must remain a first-class customer. Software delivery is a refinement and implementation path, not the definition of an organisation.

No finite checklist can enumerate every enterprise. The contract therefore combines a concrete baseline, named variation families, compositional invariants, and a governed extension mechanism. Unsupported combinations must be visible and must not acquire green readiness. Unknown industry or jurisdiction semantics require an accountable interpretation, not an LLM invention. All enumerated backlog items are required for the **full portfolio target**, though narrower releases may ship under accurately limited names.

## Sources and interpretation

`PORTFOLIO-SOURCES.json` pins local source files and their hashes. The existing research product brief owns Studio's enterprise-design/operating intent. The platform taxonomy owns the six integrity/governance module names. The pinned autonomous-stack contract in `../sdlc/` supplies the Financial SDLC reference, not universal production proof. Research primitives provide candidate extension concepts, not settled accounting or legal standards.

The older platform constitution excludes runtime orchestration and organisation design from OrgWard's original integrity control plane. The user's later Studio/runtime direction is an explicit **portfolio expansion**: Studio and SDLC own those new responsibilities; Sentinel retains its compile-time, evidence-based, non-orchestrating boundary. We do not silently amend a sibling constitution or OADL. Detailed Warden/Arbiter/Steward/Ledger/Overseer behavior below is a **proposed product elaboration** of names/responsibilities in the taxonomy, not a claim those modules already exist.

## Product boundaries and measurable outcomes

| Product ID | Users and job | Owns | Must not become | Full-target tasks |
|---|---|---|---|---|
| STUDIO | Founder, strategist, operating-model architect, process owner, frontline worker: design and run the organisation | Briefs, scoped enterprise model, views, versions, process definitions, readiness and learning | A software-only dashboard or a model that silently grants runtime authority | T-49–T-64, T-96, T-98, T-101–T-102, T-108 plus existing T-09–T-24 |
| SDLC | Product owner, engineer, tester, release manager, SRE: turn accepted system intent into evaluated running systems | Change cases, requirements/evals, architecture deltas, source/build/release references, outcome reconciliation | A hard-coded bank fixture or an agent empowered to approve its own changes | T-90–T-95 plus T-25–T-37 |
| SENTINEL | Domain architect, data steward, architecture board: see and resolve integrity gaps | Evidence-backed claims, deterministic compiler, integrity graph, rules, findings, snapshots and deltas | Runtime orchestrator, truth-inventing model, or unrestricted document warehouse | T-65–T-75 |
| WARDEN | Policy owner, security administrator, operator: prevent unauthorized effects | Versioned policy packages, enforcement decisions and revocation contracts at effect boundaries | A UI-only approval flag, or a second process engine | T-76–T-78 |
| ARBITER | Accountable owner, reviewer, governance board: resolve who may decide and settle conflicts | Decision rights, quorums, delegation, appeal, scoped decisions and exception adjudication | Autonomous selection of organisational truth or an unrestricted override | T-79–T-81 |
| STEWARD | Domain/data owner, custodian, privacy reviewer: govern information responsibility | Ownership assignments, definitions, classification, quality obligations, data contracts and stewardship remediation | A replacement transactional master-data database or automatic ownership inferred from usage | T-82–T-84 |
| LEDGER | Auditor, investigator, records manager: reconstruct and verify governance history | Append-oriented governance events, lineage manifests, retention and independently verifiable exports | The economic accounting ledger, or a claim that hashes prove factual correctness | T-85–T-86 |
| OVERSEER | Agent owner, evaluator, supervisor: govern human/agent autonomy | Agent capability/instruction/evaluation registry, scoped autonomy envelopes, delegation and intervention oversight | A parallel workflow engine or a source of self-granted tool authority | T-87–T-89 |
| PLATFORM | Customer installer, tenant admin, extension author, security/support teams | Identity, persistence, isolation, jobs, adapters, secrets, installation, support and compatibility | A hosted-only dependency or invisible cross-tenant trust | T-97, T-99–T-100, T-103–T-107 plus T-01–T-08, T-38–T-48 |

Modules may start as packages in one deployable process. Ownership is semantic and API-level, not a requirement to build nine microservices. One identity model, job engine, object identity space, effect broker and audit path serve all enabled modules. A standalone Sentinel install can ingest claims and compile without enabling execution; disabling Warden when execution requires it blocks effects rather than falling back to permissive mode.

## Cross-product contract chain

```text
Intent + sources -> Studio draft -> reviewed baseline / accepted claims
                                  -> Sentinel compiled snapshot + findings
baseline + snapshot + policies + evaluations -> pinned SDLC/process context
Arbiter decision -> Warden authorization -> Overseer-scoped worker/tool effect
artifact/deployment/process result -> observations -> proposed claims / learning
                                    -> Sentinel drift -> reviewed design correction
Ledger records provenance, decisions and effect reconciliation across the chain.
```

Contract edges (PC IDs are durable):

| ID | Producer → consumer | Exact boundary and rejection/recovery rule |
|---|---|---|
| PC-01 | Studio → Sentinel | Publishing a semantic design change emits accepted claims only through authorized review; visual layout changes do not. Claimed authority remains distinct from proposed design and observed usage. Publication and outbox are atomic; compile can lag but is marked stale. |
| PC-02 | Steward → Studio/Sentinel | Canonical IDs, definitions, scope, classification and ownership assignments reference exact revisions. Duplicate identities are reconciled explicitly, not matched solely by label. An ownership conflict creates a review item, not last-write-wins truth. |
| PC-03 | Sentinel → SDLC/Studio | Snapshot ID/hash, accepted claim-set hash, compiler/OADL/rule/extension versions, findings and evidence coverage are immutable context inputs. Compile failure retains last good snapshot and disallows presenting it as current. |
| PC-04 | Studio/SDLC → Warden/Arbiter | An effect request binds tenant, actor/delegation chain, purpose, target, environment, input/artifact digests, context, policy/evaluation versions, budget and idempotency key. Approval covers that tuple, never an arbitrary future tool call. |
| PC-05 | Arbiter → Warden | Signed/authenticated decision reference includes authorized reviewers, quorum, scope, expiry, reason and required evidence. Changed tuple, revoked reviewer authority or expiry invalidates future use. Human approval cannot override a non-overridable deny. |
| PC-06 | Overseer/Warden → worker | A short-lived scoped capability permits only specific tools/targets/data/effects. Check permission when the effect happens, not only when queued. Tool arguments and provider response are untrusted; worker cannot widen capability. |
| PC-07 | worker → Ledger/engine | A durable effect intent precedes dispatch; reconciliation records provider reference, actual outcome and evidence. Duplicate delivery is safe; unknown remote outcome enters reconciliation, not blind replay or asserted success. |
| PC-08 | observations → Sentinel/Studio | Collector/extractor versions, immutable source pointer, observation time, valid-time window, confidence and coverage accompany a proposed claim. Observed behavior never automatically approves itself or changes design authority. |
| PC-09 | finding/learning → change | Remediation creates a linked draft/change with affected IDs and preserved baseline. New accepted versions invalidate dependent evaluations/approvals; running work follows its explicit revalidation policy. Closing a notification does not resolve a finding. |
| PC-10 | all modules → Ledger | Events share tenant, aggregate revision, command/correlation/causation IDs, principal and references to redacted evidence. Outbox and business commit agree. Cross-module reconciliation detects missing/late events; unavailable audit storage blocks protected effects. |
| PC-11 | platform → modules | Compatibility manifest binds schemas, migrations, API/event versions, required modules, optional capabilities and support topology. Disable/upgrade/drain is dependency-aware; unavailable required module blocks the affected command. |
| PC-12 | installation → export/exit | Customer controls export, recovery keys and retention policy. Scope-authorized portable manifests preserve semantic IDs/provenance and disclose omitted/redacted/unsupported fields; import never activates external effects. |

## Source ambiguities resolved for this implementation plan

These are local compatibility decisions; core semantic changes require the upstream RFC path and a versioned implementation ADR before coding.

1. **OADL scope:** v0.1 retains its ten collections, typed references and explicit IDs. Broader organisation, commitment, process, time and execution models live in a separately versioned Studio schema. OADL export validates its supported projection and produces a loss report; it does not claim lossless whole-enterprise interchange or invent “OADL v0.2”.
2. **Claim vocabulary:** the compiler's seven closed v1 claim types remain the base profile. `EXECUTION_READ_CLAIM`, property authority and process lineage require an explicitly selected, versioned extension profile. Unsupported extensions fail closed or remain quarantined, never silently disappear.
3. **Authority scope:** intentional default/global scope is canonicalized explicitly. Unknown scope is not assumed disjoint from known scopes. Accepted conflicting authorities remain visible; zero authority is a gap, not an invented winner. Scope overlap uses typed dimensions, not string inequality.
4. **Severity:** store canonical rule severity separately from disposition/exception and display source severity mapping explicitly. An exception may change enforceability according to policy, but must not silently rewrite a CRITICAL contradiction into a low-risk truth. UI exposes both. Source INFO/WARN/HIGH/CRITICAL and policy low/medium/high/critical need explicit, tested normalization.
5. **Property inheritance:** inherited entity authority must be explicitly represented as an inheritance decision in the extension profile. An absent property record cannot ambiguously mean both intentional inheritance and unknown authority.
6. **R-16 heuristics:** authority leakage detection is a labeled heuristic with evidence/confidence and reviewer disposition; do not claim the same certainty as deterministic contradiction rules. R-26–R-28 require the extension profile and execution coverage metadata.
7. **Manual capabilities:** R-14's missing software realization is scoped to capabilities requiring a system. Intentionally manual capabilities remain valid with accountable human realization and documented applicability.
8. **Ledger naming:** governance Ledger stores traceability. Economic accounts/postings/commitments are Studio domain extensions and source-system references, not a promise of general-ledger, tax, payroll, payments or statutory filing implementation.
9. **Storage:** older GCS/Firestore/Neo4j suggestions are context, not mandatory hosted dependencies. T-01 freezes the supported self-host stack. Graph projections must be reproducible from authoritative records, whatever query engine is selected.
10. **Claim restoration:** base v1 supports proposed/accepted/rejected/superseded. Retraction/restoration is an explicit lifecycle extension with authorization and immutable events. No revision rewrites evidence history.

## Readiness and commercial claims

Keep four independent facts: design completeness; enabled operational controls; observed business outcomes; product release qualification. Module entitlement is a fifth fact, never evidence of the first four. A named module card is not implementation. A complete task requires executable contracts, working UX/backend, integration/negative/recovery tests and revision-bound evidence. A passing specification validator establishes none of those product facts.

The fixed P/E gates remain historical acceptance baselines. Additional portfolio module and integrated journeys in `PORTFOLIO-QUALIFICATION.md` are required to claim the full target; T-48 alone cannot declare the entire portfolio finished. New commercial or regulated claims need their own named supported scope and evidence, not an inflated percentage of the original MVP.
