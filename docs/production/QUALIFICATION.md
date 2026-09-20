# Production qualification and acceptance evidence

Revision-3 addition: PORTFOLIO-QUALIFICATION.md adds PQ-01–PQ-12, full module/source fidelity and cross-product scenario obligations. These Q-01–Q-07 and fixed P/E gates remain required; none alone qualifies the expanded portfolio. All thresholds below remain targets until supported by actual revision-bound test results.

Revision 2. These are explicit product targets, not measured performance claims. Existing 36-test success establishes only the current development behavior. Counts of stories/tests do not establish readiness.

## Supported baseline to freeze before execution

T-01/T-08 pin a supported Linux x86-64 release, container runtime and image digests, Node LTS runtime, PostgreSQL version, S3-compatible artifact provider, OIDC provider, secret manager, Git provider, model provider and isolated deployment adapter. Use one working adapter per required class, with authenticated conformance tests. No `latest` tag in release artifacts. Record CPU/RAM/storage and network topology used by every qualification run.

Baseline load target: 100 concurrent signed-in users, 10 workspaces, 10,000 enterprise objects and 50,000 typed edges per workspace, 100,000 audit events, 1,000 queued tasks and 10 concurrent worker tasks. Seed includes large/empty/conflicting/denied/stale cases. Query p95 ≤500ms and p99 ≤2s under that load; asynchronous command acknowledgement p95 ≤1s excluding identity-provider login; initial usable primary screen ≤3s on the documented laptop/network; 1,000-node map neighborhood interactive ≤2s with list alternative. Never render all 50,000 edges at once.

Chosen pilot service objectives: 99.5% control-plane monthly availability, backup RPO ≤15 minutes, clean restore RTO ≤4 hours, queued-work recovery ≤60s after eligible lease expiry, revocation prevents new effects within 30s, cancellation acknowledged within 30s for cancellable workloads. Uninterruptible remote effects are visibly pending reconciliation and cannot be claimed cancelled. These are initial release targets; changing one requires an explicit versioned rationale and requalification, not a failing-test waiver.

Single-node pilot evidence does not establish HA. E-16 additionally requires documented redundant control-plane/database/storage topology and failover testing at the agreed load, plus 24h soak and fault injection with no lost acknowledged commands/evidence or duplicated external effects. Availability SLO cannot be proven by one short test; pilot monitoring and operational ownership are required.

## Q-01 — Founder to operating business

New tenant, no fixtures preinstalled. A founder enters a circular-furniture service using their own wording, corrects an assumption, reviews evidence and publishes a blueprint spanning all ten enterprise dimensions. They edit a process and a role, compare versions, see impacted dependencies, enter price/cost/capacity assumptions, assign a human and an agent, and start a bounded proposal-preparation process. The real model drafts a usable output; a human checkpoint prevents progression, revised instructions create a new version and authorized resume saves the result. Restart, reopen and trace output to the original scope. A falsified margin assumption creates a reviewable follow-up.

Required evidence: browser recording, persisted IDs/versions, real provider request/result metadata with secrets redacted, output rubric, intervention/audit events, restart results, P-01–P-12 acceptance receipts. Also run with a different non-bank business and no scenario-specific code changes.

## Q-02 — Real software change through outcome

Owned isolated test repository and authorized test deployment target. Start from an existing service and request a meaningful behavior change. Produce atomic requirements and architecture delta; create plan with checkpoint; agent changes real files/branch; failing tests trigger repair within budget; distinct reviewer approves PR; required checks produce signed immutable candidate. Independent release approver approves exact environment/candidate/evidence tuple; deployment verifies running digest. Inject bad health, execute compatible rollback, and separately record business outcome as failed/unknown. Learning creates a proposed change, not silent production mutation.

Negative cases: swapped artifact, changed environment config, approval revocation, self-approval, stale PR checks, forged/replayed webhook, denied tool, leaked-secret canary, insufficient budget, unknown provider result and irreversible schema change. Every case must show the intended block/recovery and no unauthorized effect.

## Q-03 — Existing enterprise, identity and isolation

Import an existing blueprint with duplicate/conflicting source records, preserve unresolved provenance, reconcile IDs and publish a changed version. Two tenants/workspaces with overlapping human/agent names attempt cross-scope reads/writes, event subscriptions, searches, exports, artifact downloads, queue claims and storage keys. Revoke a user's session and agent assignment mid-run; next action fails without leaking scope. Concurrent edits produce an inspectable conflict, not last-write-wins data loss.

## Q-04 — Installation, upgrade, recovery and audit

Customer-like operator follows only shipped documentation on a clean supported host. Install, configure identity and providers, create workspace and complete Q-01. Run backup, corrupt/remove test storage, restore into a separate clean installation with keys, verify hashes/relationships and reconcile work without repeating effects. Upgrade N-1 → N with queued/running tasks; test failed migration and supported recovery. Auditor exports authorized evidence, verifies its manifest independently, and attempts a prohibited export. Show retention/hold enforcement and key-rotation history.

## Q-05 — Worker, model and effect failures

Kill worker before lease, during execution, after artifact upload and after remote effect but before local commit. Kill control plane during approval and outbox publication. Deliver duplicated/out-of-order events. Exceed CPU/memory/disk/log/time/token/cost limits. Introduce provider timeout/rate limit/malformed output; unavailable credentials; malicious repository symlink/path escape; prompt injection attempting tool escalation; lost DB/storage connectivity. Assert terminal/unknown states, reservations, orphan cleanup, no bypassed checkpoint, no accepted stale result and operator recovery.

## Q-06 — Visual usability and accessibility

Review actual screenshots at 1440×900 and 1280×800; 320px reflow/400% zoom; Chromium, Firefox and WebKit supported stable versions recorded at execution. Verify real keyboard completion of creation/editing/assignment/intervention/release/export, native semantics, focus order/visibility/restoration, errors, dialogs, no-result/offline states, forced colors and reduced motion. Use automated accessibility checks plus manual screen-reader workflow evaluation against the chosen WCAG 2.2 AA target. Record findings individually; a no-console-errors pass is not an accessibility pass.

Moderated pilot: at least five representative participants spanning enterprise owner, operator, delivery/release and administration/audit roles; all critical journeys completed without developer intervention or undocumented commands. Capture task completion, critical errors, confusion and repair time. Any incorrect release/authority understanding or inability to recover a critical task blocks signoff. This is a minimum qualification exercise, not statistical proof of all usability.

## Q-07 — Operations, security and scale

Run baseline load/24h soak and redundant-topology failover; retain raw results with percentiles, resource use and failures. Alert on oldest queued task, exhausted budget, failed/unknown effects, storage/DB failure, backup age, auth failure spikes and evidence-export failures. On-call operator follows runbook to diagnose an injected failure from a correlation ID.

Threat model covers browser/session, tenant scope, prompt/context, SCM/webhooks, worker/runtime, credentials, evidence and deployment. Independent security review/penetration testing must evaluate implemented controls and resolve release-blocking findings. Dependency and container scans alone cannot satisfy E-14/E-16. Verify SBOM/provenance/signature from outside the building worker.

## Evidence and gate adjudication

Receipt includes task/story/acceptance IDs; git revision or documented content digest; test environment/provider versions; fixture/input IDs; exact commands; time; raw outputs; expected/actual results; permitted effect scope; reviewer; unresolved findings. Secret values never enter a receipt. Failed and skipped criteria remain visible. Each gate links every applicable required criterion and a real combined scenario, not just a story count.

| Gate | Required backlog evidence plus combined qualification |
|---|---|
| P-01–P-04 | T-09–T-12/T-14; Q-01/Q-03 (historical slice receipts retained, production revalidation still required) |
| P-05–P-06 | T-13/T-17/T-18; Q-01/Q-03 |
| P-07–P-09 | T-19–T-24; Q-01/Q-05 |
| P-10 | T-04/T-09/T-18/T-20/T-39/T-41; Q-01/Q-04 |
| P-11–P-12 | T-15/T-16/T-24/T-36/T-48; Q-01/Q-06 |
| E-01 | T-08/T-42; Q-04 |
| E-02–E-03 | T-05/T-06/T-17/T-46; Q-03/Q-05 |
| E-04 | T-04/T-20; Q-03/Q-04/Q-05 |
| E-05 | T-07/T-21/T-40; Q-02/Q-05 |
| E-06 | T-29/T-30; Q-02 |
| E-07–E-08 | T-19–T-24; Q-01/Q-05 |
| E-09 | T-31/T-32; Q-02/Q-07 |
| E-10 | T-33–T-36; Q-02/Q-05 |
| E-11 | T-38/T-39/T-43; Q-04/Q-07 |
| E-12–E-13 | T-40–T-42; Q-03/Q-04 |
| E-14 | T-25–T-27/T-31/T-32/T-46; Q-02/Q-07 |
| E-15 | T-02/T-03/T-10–T-18/T-38/T-44/T-45; Q-01/Q-06 |
| E-16 | T-47/T-48; all Q-01–Q-07 on the release candidate |

Task links are coverage guidance; the full gate wording in ROADMAP and the original release contract remains authoritative. Regressions reopen acceptance even when a historical receipt passed. A complete backlog with a failed integrated outcome cannot be released.
