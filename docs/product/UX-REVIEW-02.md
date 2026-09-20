# UX, functionality and delivery-readiness review

Reviewed 2026-09-18 against the original user intent, fixed P-gates, production endpoint, research schemas, SDLC plan, actual UI/source, and recorded receipts. This review supersedes the claim in UX specification revision 1 that the complete intended experience was already captured. The existing UI is a capability catalogue with selected live slices, not a complete interaction prototype or an implementation-ready enterprise specification.

## Verdict

The user's concern is supported by the evidence. Revision 1 described destinations and services but omitted important journeys, field contracts, effect semantics, recovery behavior and measurable qualification. A task-executing agent could reasonably produce a set of attractive disconnected screens and service stubs while believing it had followed that roadmap. The current UI compounds this by presenting static operational success and quantitative coverage alongside live data.

The revision-2 contract adds outcomes, ten-area domain detail, screen behavior, state/authority/data contracts, 48 dependency-linked stories/tasks with 144 specific acceptance scenarios, and seven integrated qualification scenarios. This materially reduces interpretation gaps. It remains a planning baseline: executable schemas/adapters, user validation and independently verified implementation are required before production claims.

## Evidence and method

- Reused the product brief, delivery plan, original 12 release gates, org-core micro-model, blueprint schema and pinned SDLC reference; no new external research or missions.
- Inspected `public/platform.{html,js,css}`, existing enterprise/execution contracts, API routing and status ledgers.
- Ran Chromium at 1440×900 against an isolated instance with empty temporary stores and local execution disabled. Inspected all seven main screens and screenshots, keyboard behavior, edit action, role preview, no-result search and simulated 503 API responses. No real execution or external effect was performed.
- Raw observations: `ops/checks/ux-review-02-browser-observations.json`. Screenshots viewed at `/tmp/orgward-review-command.png` and `/tmp/orgward-review-enterprise.png`; these temporary images are supplemental, not permanent gate evidence.
- No page overflow or uncaught JS errors was observed. Nevertheless 61 non-native clickable elements lacked keyboard focusability, and 378 visible leaf text elements used font sizes below 12px across the seven screens. The count is a diagnostic, not a complete accessibility audit.
- No user study, screen-reader audit, penetration test, production provider qualification or formal accessibility certification was performed. Planned criteria below must not be reported as passed.
- The former test title claiming a complete journey and truthful maturity has been narrowed to what its assertions actually verify: served catalogue assets and declared specification text. Its matching strings never demonstrated functional or data-truth acceptance.

## Findings and disposition

Severity: critical = permits a false product outcome or unsafe future effect; high = prevents a primary workflow or reliable implementation; medium = substantial usability/maintenance deficit. All implementation defects remain open; this turn repairs the specification and delivery plan only.

| ID | Severity | Evidence / missing behavior | Required correction / owner tasks |
|---|---|---|---|
| F-01 | Critical | `loadLive` replaces errors with empty data; Work still says connected and shows Complete, six artifacts with all APIs returning 503. Empty and disabled installation also exposes sample running work. | Explicit unavailable/empty/disabled states and data provenance; no fabricated fallback results. T-02. |
| F-02 | High | Enterprise displays 39 objects, 82 edges, 64–100% coverage and Saved/Live labels without querying enterprise projects. `readiness` is labelled live but values are hard-coded. | Label fixtures; live widgets bind actual object/ledger versions; coverage formula and evidence are inspectable. T-02/T-12. |
| F-03 | High | Edit draft opens inspector with zero inputs; compare/publish/assignment actions are contract descriptions. | Real form/diff/validation/persistence/recovery per SC-03/05; preview labels until implemented. T-13/T-17/T-18. |
| F-04 | High | New change case opens a fixed bank case; tabs open capability descriptions rather than case data. | General intent form, selected durable case, traced editable records and gates. T-25–T-28. |
| F-05 | High | Role selection says view changed but only shows a toast; no identity-backed role filtering or authorization. | Honest demo-role copy and production authenticated rights enforced throughout. T-02/T-05/T-06. |
| F-06 | High | Navigation is finance/software-centric. Founder's iterative business design, non-software operations and existing-enterprise import lack complete paths. | O-02/O-03/O-04, SC-02–SC-06, two non-bank qualification inputs. T-09–T-24/T-44. |
| F-07 | High | Economics, resources, capacity, obligations and lifecycle are labels/counts rather than useful domain records/actions. | Ten-dimension field/evidence contract; scenarios, resource reservations, handover/retirement. T-09/T-15/T-16. |
| F-08 | High | Workflow status vocabulary omits durable pause/cancel acknowledgement, fencing, compensation and unknown effects. | C-03/C-04 state and crash semantics with fault injection. T-19–T-23/T-35. |
| F-09 | Critical | Service names alone do not prevent browser authority claims, stale approval or effect replay. Existing tenant/role fields are development claims. | Authenticated scope, bound approval tuple, effect-time recheck, idempotency/reconciliation and isolation matrix. T-05–T-07/T-20/T-33/T-34. |
| F-10 | High | Enterprise, synthetic case and execution slices have disconnected source references and no enforced end-to-end version handoff. | Canonical aggregates, migrations and C-07 seam tests. T-01/T-04/T-28/T-48. |
| F-11 | High | “Real agents” lacks acceptance that excludes fixed scaffolds; budgets and malformed output recovery are unspecified. | Arbitrary scoped repository/task output, real provider, atomic budget reservations and independent evaluator. T-11/T-22/T-30. |
| F-12 | Critical | Green deployment/assurance examples and hash-valid text are not provider/evaluation evidence. | Immutable source/candidate/check/approval/environment handoff and independent provenance verification. T-31–T-35. |
| F-13 | High | Technical success can be mistaken for business/operating success; missing measurements have no contract. | Separate readiness dimensions and outcome categories; falsified assumptions generate governed follow-up. T-12/T-15/T-36/T-37. |
| F-14 | High | Every screen lists backend service names but no exact fields/errors/commands/events or concurrency behavior. | C-01/C-02, executable schemas/OpenAPI/events and idempotency fixtures before implementation. T-01/T-04/T-44. |
| F-15 | High | Main row/card actions include 61 elements not focusable by keyboard across seven screens. | Native controls and equivalent graph/list navigation, keyboard-complete task tests. T-03/T-14/T-45. |
| F-16 | High | Inspector leaves focus on underlying Edit draft and remains open after Escape. | Named panel/dialog, initial/return focus, explicit dismissal and correct modal/nonmodal behavior. T-03/T-45. |
| F-17 | Medium | Main data uses 7–11px text and low-emphasis metadata; large headings dominate decision detail. | 16px body/14px table/form/12px secondary targets, measured contrast and information hierarchy. T-03/T-45. |
| F-18 | Medium | Empty command search produces no explanation; `replaceState` and no history listener prevent ordinary back/forward screen history. | No-result feedback, semantic navigation and persistent deep-link state. T-03. |
| F-19 | High | No form state matrix, offline recovery, conflict resolution or long-running cancellation story. Existing smoke checks only assert headings. | All SC contracts inherit explicit state/recovery matrix; browser assertions inspect persisted effects. T-03/T-23/T-45. |
| F-20 | Medium | Map lines are decorative with no edge semantics; “Open full map” opens a description. | Typed directional relation selection, explainable missing nodes, responsive list parity. T-14. |
| F-21 | High | UI E-15 says pending while JSON says in_progress; stage and gate counts mix 12-stage/reference/private-release meanings. | One canonical status source; keep P-gates, E-gates and case stages distinct. T-01/T-02/T-25. |
| F-22 | High | Prior roadmap postponed enterprise operating UX until after engineering delivery, with no dependency graph. | Interleaved enterprise/engineering vertical slices; dependency-linked backlog and required non-software acceptance before release. TASK-INDEX/T-24/T-48. |
| F-23 | High | “Enterprise-ready” has no supported install topology, measured workload, RPO/RTO, operations ownership or real pilot criteria. | Pinned release baseline, clean install/upgrade/restore, measurable qualification and independent operator pilot. T-08/T-41–T-48. |
| F-24 | High | Existing receipts call a clickable catalogue the “complete intended experience”; no story-level negative evidence. | Preserve historical receipts but qualify their limited claims; 144 specific scenarios plus common rules and Q-01–Q-07. No gate promotion here. |

## Visual assessment

Retain the coherent navigation, restrained color palette and consistent panels. Their styling makes the product recognizable, but current density and small secondary type make the data harder to use than necessary. The founder's first question should be what to design/operate next, not how many OrgWard release gates are missing. Put product-release status in administrator/review mode and place owned decisions, blockers, outcomes and next actions in ordinary role home views.

The map must communicate relationship type/direction and selected-object context rather than look like a connected diagram. Use progressive detail for requirements/architecture/work, with an actionable inspector. A demo label at the bottom of a sidebar does not adequately qualify green “Verified” badges or fabricated percentages elsewhere. Screenshot aesthetics and no-overflow checks are useful but insufficient.

## What a future implementer must not infer

- A populated object is not an enabled enterprise capability.
- A label containing “agent” is not a real model invocation.
- A local directory is not workload isolation; a caller role is not authentication.
- An exit-zero executable is not a verified usable artifact or a deployed system.
- A hash is not trusted provenance, and a passing technical check is not an achieved business outcome.
- A document/fixture/mock or passing structural backlog validator is not implementation acceptance.
- Completion of all individual stories without integrated customer outcomes does not qualify release.

## Remaining decisions and review boundaries

T-01/T-08 choose exact supported versions/providers and record executable contracts; this review chooses the architecture shape and measurable default targets but does not invent infrastructure credentials or target environments. The information architecture and role assumptions remain hypotheses until customer task review in T-45/T-48. Do not freeze them merely because revision 1 said approval would freeze the navigation.

The next authorized build should begin with T-01 and T-02, followed by the shared UI/data foundations and complete enterprise operating slice. This review itself stops after saving and validating the improved contract; it does not silently start the production build.
