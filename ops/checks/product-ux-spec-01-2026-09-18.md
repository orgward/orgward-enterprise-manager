# Unified product UX specification 01 receipt

- Checked at: `2026-09-18T20:41:42Z`
- Product revision: `tree-sha256:3f759ffcacacdfe19d4963a6f4cf72309a6ed24963f6d2829952c8ef8f5de2b5`
- Revision scope: sorted SHA-256 digest of `.gitignore`, `server.mjs`, `package.json`, `README.md`, and files under `src/`, `public/`, `tests/`, `docs/`, and `workers/`
- Normative contract: `docs/product/UX-SPEC.md`
- Review surface: `/platform.html`
- Product check: `npm run check`
- Product result: **PASS — 36 passed, 0 failed, 0 skipped**
- Browser: Chromium 153
- Laptop walkthrough: **PASS — 1440 × 900 and 1280 × 800; no viewport overflow, console errors, or uncaught page errors**
- Narrow regression: **PASS — 390 × 844; no viewport overflow, console errors, or uncaught page errors**

## Verified experience contract

- Seven goal-oriented areas cover the intended operating experience: Command center, Enterprise, Change portfolio, Work & agents, Releases, Evidence, and Administration.
- The demonstrator joins the complete journey: business conversation → blueprint → governed change → requirements/architecture → human and agent work → controlled execution → assurance/release → outcomes/evidence.
- Every capability is explicitly classified as **Live slice**, **Foundation**, or **Specified**.
- Selecting a capability exposes its user stories, required system response, backend service contracts, acceptance gates, and—when not live—the demonstrator boundary.
- The future experience includes authenticated identity and authority, immutable versions, durable workflows, real repositories and models, secret brokerage, artifact assurance, protected environments, outcome observation, audit export, installation, upgrades, and recovery.
- Existing live data is integrated only where it exists: health, persisted execution runs, and synthetic change cases. API-supplied run labels are HTML-escaped.
- The page complies with the existing restrictive Content Security Policy; it contains no inline style declarations.
- Browser verification exercised navigation, enterprise coverage, specification inspection, change stage rail, work view, releases, evidence, administration, and command search.

## Original 12-gate impact

| Gate | State after this increment | Evidence interpretation |
|---|---|---|
| P-01 Business-design conversation | Verified (unchanged) | Existing live slice is represented in the unified journey. |
| P-02 Structured organisational blueprint | Verified (unchanged) | Existing live slice is represented in the Enterprise view. |
| P-03 Blueprint integrity checks | Verified (unchanged) | No implementation change to the verified evaluator. |
| P-04 Interactive organisational maps | Verified (unchanged) | Existing live map remains linked from the product surfaces. |
| P-05 Editable design and version history | Pending | User experience and backend contract are specified only. |
| P-06 Human/agent responsibility and instructions | Pending | User experience and backend contract are specified only. |
| P-07 Runnable process/task plan | Pending | Synthetic/foundation material is visualized; general durable workflow is absent. |
| P-08 Human intervention controls | Pending | Checkpoint experience is specified; production authority is absent. |
| P-09 Bounded internal agent execution | Pending | Local fixed executable is a foundation, not a real governed agent/model service. |
| P-10 Persistent enterprise workspace | Pending | Existing slice persistence is partial; complete object/run/artifact persistence is absent. |
| P-11 Coverage and readiness dashboard | Pending | A reviewable demonstrator exists; production projections and actions are absent. |
| P-12 Runnable private product/end-to-end demo | Pending | The product journey is clickable but non-live capabilities perform no effects. |

Result: **4 of 12 original release gates remain verified; 8 remain pending.** No gate was promoted by a specification-only interaction.

## Production-gate impact

E-15 (Production UX and API) moves from `pending` to `in_progress` because the complete information architecture, primary journeys, state rules, screen contracts, backend boundaries, maturity semantics, and responsive demonstrator now have evidence. It remains incomplete: production authentication, server-enforced permissions, complete live workflows, stable public APIs/events, WCAG 2.2 AA audit, supported-browser matrix, and user/pilot qualification are absent.

All other production gates retain their previous status. The product remains **0 of 16 production gates complete** and must not be represented as production-ready.
