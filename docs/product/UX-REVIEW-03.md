# Whole-portfolio intent, UX and functional review — revision 3

Completed specification increment 2026-09-19. Scope: the user's expanded OrgWard vision, not just the first Studio/Financial SDLC demonstrator. Method: inspect existing implementation/specifications and reuse 27 hash-pinned local research/platform/framework/SDLC sources; trace each intent through users, model, screen, command/state, cross-product dependencies and qualification. No new external research mission, browser qualification, public deployment or production feature implementation is claimed.

## Conclusion

Revision 2's 48-task core plan did not adequately preserve the full portfolio. In particular, multi-perspective refinement and change propagation, the original Sentinel compiler/rules, named governance modules, and enterprise variation/exit paths needed explicit contracts. Those are now specified and structurally checked. The current application remains a development demonstrator/foundation with known UI and backend gaps; it is not enterprise production-ready.

This review addresses specification gaps, **not implementation defects**. All 24 revision-2 findings remain open unless subsequently closed by actual implementation receipts. No screen, enterprise control or task was completed merely by adding these documents. Existing first-increment P-01–P-04 receipts remain historical scoped evidence; the broader new stories do not automatically pass based on them.

## Findings and preserved obligations

| ID / priority | Gap and enterprise consequence | Required remedy / task ownership | Current disposition |
|---|---|---|---|
| R3-01 Critical | Portfolio collapsed into generic services; Sentinel and named modules could disappear during implementation. | Product boundaries, PC-01–PC-12 and module feature tasks T-65–T-89 in PORTFOLIO-CONTRACT. | Specified; all module implementation/acceptance pending. |
| R3-02 Critical | No sufficiently explicit shared identity/scope/time axes; lenses could become inconsistent duplicate models. | EM-01–EM-03; T-49–T-51 with canonical IDs, typed relations, legal/organisational scope and temporal context. | Specified; executable schema/query fixtures pending. |
| R3-03 High | Interactive map implied browsing, not cross-perspective editing/refinement. | Sixteen lenses, D0–D5, split view, typed link commands and reverse trace; SC-13/T-51/T-54/T-61. | Specified; current map does not satisfy target. |
| R3-04 Critical | Version history lacked adequate branch/merge, future-effective and running-effect semantics. | EM-05/06, SC-14, T-53/T-63/T-108; immutable old runs, compensating revisions, stale approvals. | Specified; concurrency/recovery tests pending. |
| R3-05 Critical | SDLC could detach from enterprise intent and judge only generated code/tests. | T-90–T-95; baseline/claim/policy context manifests, independent intent-derived evals, bidirectional correction. | Specified; fixture SDLC is not proof. |
| R3-06 Critical | Sentinel source requirements could be reduced to generic graph validation. | SN-01–SN-05; every R-01–R-28 and AT-01–AT-33 mapped to tasks and planned test fixtures. | Source IDs preserved; tests not implemented/run. |
| R3-07 Critical | Authority, human approval and tool effect could diverge across modules or after revocation. | T-76–T-81/T-87–T-89; bound tuples, current effect checks, independent quorum, no self-delegation escalation. | Specified; effect-boundary adversarial qualification pending. |
| R3-08 High | Data ownership, property semantics, quality and evidence trust were underdeveloped. | T-82–T-86; Steward responsibilities, semantic lineage and independently verified governance Ledger. | Specified; not an MDM/accounting replacement. |
| R3-09 High | Broader enterprise work could be lost to software-centric planning. | Twenty-four ES scenarios, ten dimensions, commitments/capacity/value/manual/physical/continuity tasks T-56–T-62/T-96/T-101/T-102. | Scope/adapter/pack distinctions explicit; working scenarios pending. |
| R3-10 High | Self-hosted ownership was incomplete without module dependency, extension certification and customer exit. | T-97/T-99/T-100/T-107/T-108; compatibility, drain/recover, portable manifests, hold/retirement and safe import. | Specified; independent customer qualification pending. |
| R3-11 High | Visual/functionality criteria could be satisfied by cards and prose drawers. | SC-13–SC-20 inherit real commands/persistence/states and accessible laptop workflows; task-based role studies. | Current visual defects remain open; no new browser evidence. |
| R3-12 Critical | Task counts could give false assurance despite missing cross-product failure combinations. | Twenty F families, twelve PC mutations, eight X intersections, twelve PQ journeys and requirement coverage validation. | Structure verified only; integrated tests unrun. |
| R3-13 High | Conflicting source meanings could be silently resolved by implementation guesswork. | Ten explicit local compatibility decisions: OADL scope, claim extensions, severity/disposition, inheritance, manual realization, Ledger naming, storage and lifecycle. | Planning decisions documented; executable ADR/profile fixtures required. |
| R3-14 Critical | Earlier final milestone could declare completion without new modules/features. | T-106 closure includes every one of 108 tasks; requirement/source/scenario/boundary records require passing evidence. | Dependency/coverage checks pass; release qualification remains not run. |

## Saved specification and verification scope

The master PORTFOLIO-ROADMAP links 108 stable tasks/stories and 384 task acceptance cases. T-01–T-48 retain their original requirements; T-49–T-108 add 60 full-target requirements. There are nine product/platform responsibility areas, sixteen perspectives, twenty screen contracts, twenty-four enterprise scenarios, twenty scenario families, twelve boundary mutations, eight required high-risk combinations and twelve additional qualification journeys. Sentinel retains 28 rules and 33 source acceptance cases. These counts are coverage inventory, not a maturity score.

`npm run check:spec` verifies dependency acyclicity, complete final-task closure, source IDs, mapped requirement/task/acceptance references, feature-level product/lens coverage, screen/model/journey contracts and evidence prerequisites. Negative mutations prove that removal, unknown references, unsupported scope, missing recovery and false completion are rejected. `--verify-sources` verifies all 27 local source hashes. These checks do not establish semantic completeness, UI usability, actual security or running enterprise behavior.

See `../../ops/checks/ux-review-03-2026-09-19.md` for actual commands/results and revision digest. Existing application regression tests are rerun to detect accidental disruption; they do not execute the new portfolio stories. Research allowance unchanged: zero new missions; sibling sources/history untouched. No git commit is claimed in this non-git workspace.

## Handoff and limits

The roadmap now makes the missing work explicit, dependency-linked and reviewable. It cannot make uncritical task execution by an LLM sufficient for production: executable contract review, realistic negative/recovery tests, independent security assessment and customer/operator acceptance remain mandatory. Each task must resolve its implementation ADRs and split into bounded verifiable changes before coding. Unresolved safety, authority, data-loss or semantic questions block dependent implementation.

Next build: T-01/T-02 with revision-3 schema/profile constraints, then only eligible tasks. Stop this review after files and checks are saved. The user can review the model, lenses, scenario catalogue and UX contract before authorizing the next functional increment.
