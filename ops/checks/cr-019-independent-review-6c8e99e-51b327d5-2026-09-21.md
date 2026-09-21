# CR-019 independent engineering review

Candidate revision/digest; source/packet digests:

- Git revision: `6c8e99ed7114a7285146ca00c64904cfb35a11e5`; verified as local `HEAD` and pushed `origin/main`.
- Candidate digest: `51b327d5bf810e9290cadfecb9c453d5f223db1a5a52a8d4a4657d602daffbc6` over the 26 entries in `contracts/enterprise/closed-loop-manifest-19.json`.
- Base revision: `38294934987c9ec5b528dd6105656a16edcf2a02`.
- Pinned issue-body digest: `9e36a8585731acc644b0c6208836f1468ecf909a4528cf659871b72dcc524c6c`.
- Preserved original-semantics digest: `bae6cc764818772670970f4979da2c8bc3c94d0c57b252c339713a57f6f06320`.

Task/slice/AC/WF scope:

- All 24 `CL-R01`–`CL-R24` source obligations, 18 `CL-001`–`CL-018` delivery slices, four `CL-X01`–`CL-X04` supplementary cases and 17 draft payload schema definitions.
- All 49 mapped parent tasks and 171 mapped original acceptance criteria, checked against the unchanged 132-task/480-criterion baseline.
- WF-01–WF-16, P-01–P-12 and E-01–E-16 were checked for preservation and status separation; no product, enterprise, workflow or closed-loop result was promoted.

Author and reviewer/session; actual model/effort:

- Candidate author: `codex-root-checkpoint-19`.
- Reviewer: `codex-cr019-independent-review-2026-09-21`, separately scoped review-agent session `/root/cr019_review`.
- Actual review model/profile: `gpt-5.6-sol`, high reasoning (Sol High).

Independence evidence and limits of authority:

The reviewer session did not author candidate revision `6c8e99ed7114a7285146ca00c64904cfb35a11e5`, was separately instructed to derive findings from the pinned source and exact candidate, and made no candidate repair. This is independent engineering review evidence within the Codex session boundary. Model identity alone does not establish organizational independence. This receipt is not customer acceptance, security certification, legal review, accountable-owner approval or release qualification.

Raw artifacts inspected; commands actually run:

- `AGENTS.md`, the product brief/delivery plan/release gates, engineering operating/change-control documents, the complete `orgward-review` skill, review prompt/template and `NEXT-SESSION-CR019-REVIEW.md`.
- Pinned issue #1 source; CR-019; candidate manifest; all obligation, example and schema files; control/architecture and UX specifications; canonical backlog/architecture links; workflow obligations; change and start-guard checkers; tests and status ledgers.
- `git rev-parse HEAD`, `git ls-remote origin refs/heads/main`, manifest/source digest recomputation and all 26 per-file candidate hashes.
- `npm run check` on the exact clean candidate before review metadata was recorded — pass: 55 tests, 0 failures; includes specification and engineering checks.
- `node ops/check-spec.mjs --self-test --verify-sources` — pass: 27 pinned source hashes verified; 132 tasks, 480 scenarios, 16 WF obligations with 0 pass, 24 CL obligations with 0 pass; no runtime acceptance executed.
- `node ops/check-closed-loop.mjs` — pass as structural validation: 24 requirements, 18 slices, four supplementary cases, 17 schema definitions, four valid/eight rejected draft-schema examples, 0 CL product passes and 0 runtime tests.
- `node --test tests/closed-loop-spec.test.mjs` on the exact clean candidate before review metadata — pass: 11/11.
- `npm run check:engineering` — pass as engineering-asset structure validation.
- Review-only in-memory mutations (no repository candidate edit): omitted/rewritten source, premature affected-task start, unreviewed adoption and T-132 completion without CL evidence were rejected. Separate mutations reproduced the first two findings below. A structurally valid zero-proof `AcceptanceAssessment` was accepted by the draft schema; this was adjudicated as an explicit staged boundary, not a separate finding, because the proposal states schema conformity proves nothing, assigns cross-field derivation to CL-009/CL-R11 and leaves that runtime acceptance `not_run`.
- Post-record checks after adding only the permitted CR lifecycle/review metadata: `node ops/check-closed-loop.mjs`, `npm run check:engineering` and `node ops/check-spec.mjs --self-test --verify-sources` passed. `node --test tests/closed-loop-spec.test.mjs` failed 10/11 and `npm run check` failed 54/55 at the same assertion because `tests/closed-loop-spec.test.mjs:16` hard-codes `change.status === 'proposed'` and `change.review === null`. This is finding 3, not a candidate repair made by the reviewer.

| Finding | File / criterion | Reproduction / evidence | Severity / impact | Repair |
| --- | --- | --- | --- | --- |
| CR-019 material semantics and the reviewed Git revision are not bound by the candidate/review digest. | `contracts/enterprise/closed-loop-manifest-19.json`; `docs/engineering/changes/CR-019.json`; `ops/check-closed-loop.mjs`; CR-019 lifecycle/candidate-staleness invariant. | The manifest omits `docs/engineering/changes/CR-019.json`, while `change.after.candidateDigest` is only `sha(JSON.stringify(manifest.files))`. An in-memory mutation changed `after.proposal` and `impact.security` without changing the recorded digest; `validateClosedLoop` still passed. Review metadata binds a candidate digest but has no validated reviewed Git SHA. | **High.** Material proposal, impact, preservation, invalidation or resume semantics can drift while retaining an apparently current review. That defeats revision- and candidate-bound re-review guarantees. | Add a canonical CR semantic projection to the candidate hash, excluding only mutable lifecycle/reviewer fields; bind and validate the exact reviewed Git revision; add mutations proving proposal, every impact category, task/AC preservation, invalidation and resume changes stale review. Recompute the candidate digest and request re-review. |
| Supplementary cases have no task-level ownership or start/completion evidence guard. | `contracts/enterprise/closed-loop-obligations-19.json` `CL-X01`–`CL-X04`; `ops/check-closed-loop.mjs`; parent-task bounded-contribution/start guard. | Ordinary CL requirements carry `taskIds`, `taskEvidence`, packet linkage and completion guards. Supplementary cases carry only requirement/slice links. In a review-only simulated adopted state, T-21 could enter its mapped trajectory work with CL-R06 linkage but no enforceable CL-X01 packet contribution/evidence; only the final T-132 global guard eventually catches an unrun supplementary case. | **Medium.** A parent task can start or complete without the adversarial behavior assigned to its slice, postponing the missing obligation until final integration and weakening bounded contribution accounting. | Give every CL-X case explicit owner task(s), packet contribution/test linkage and task evidence; enforce those links before applicable task start and evidence before task completion; add start/completion mutations for all four cases. Recompute the candidate digest and request re-review. |
| The candidate regression suite rejects the authentic review lifecycle state required by CR-019. | `tests/closed-loop-spec.test.mjs:16`; `docs/engineering/changes/CR-019.json`; required post-review `npm run check`. | Before metadata, the test passes by asserting `status === 'proposed'` and `review === null`. After recording this digest-matched `changes_requested` review and moving CR-019 to `reviewed`, the targeted suite is 10/11 and the full suite is 54/55; the failure is the hard-coded `reviewed` versus `proposed` assertion (and the following null-review assertion would also reject a review if status stayed proposed). | **High.** The repository cannot both record the required authentic review and keep its mandatory check green. That makes the review lifecycle internally inconsistent and prevents a truthful reviewed-state validation receipt. | Replace the snapshot assertion with lifecycle-aware cases: pristine proposal has no review; `reviewed + changes_requested` remains unapproved and blocks adoption/start; `reviewed + approved` is eligible only for separate approval; stale digest/revision fails. Rerun the full suite after repairing findings 1–3 and request re-review. |

Coverage reviewed and explicitly unreviewed:

The issue checkbox text, proposed ownership, clarification policy, evaluator taxonomy/calibration/disagreement, diagnostic and no-progress routing, restart/concurrency behavior, acceptance-state separation, reconciliation/Learn semantics, tenant/permission/effect safety, migration/recovery, slice graph, canonical links and checker lifecycle were reviewed. Product implementations, materialized migrations/seeds, transport schemas, real observation adapters, actual provider effects, customer usability, production security, legal/compliance and release readiness do not exist in this candidate and were not reviewed or certified.

Changed-intent/compatibility/dependency-invalidation assessment:

The candidate preserves the 24 issue checkboxes verbatim and leaves the original 132 tasks, 480 criteria, P12/E16 and WF16 denominators intact. The proposed ownership model avoids a second orchestrator/truth graph and preserves current authority/evidence distinctions. The three findings concern review staleness, enforceable bounded contribution and the review lifecycle test, not removal of source intent. Repairs are material candidate changes and must invalidate this review through a new digest/revision.

Actual disposition: **changes requested**.

CR-019 remains unapproved and unapplied. `closed-loop-obligations-19.json` remains `proposed_pending_independent_review`; CL-001/002 implementation must not start.

Unresolved findings, owner decisions and re-review triggers:

- Repair all three findings in one bounded CR-019 candidate revision without changing the source obligations or existing denominators.
- Regenerate the manifest/candidate digest, add the stated adversarial mutations, run the full required command set and obtain independent engineering re-review of the exact new pushed SHA/digest.
- Only a passing re-review may move CR-019 toward governed approval/adoption. Architecture/security authority, implementation packets and product qualification remain separate.

Current counts at review stop: P `4/12`; E `0/16` verified (`E-07` and `E-15` remain in progress, not complete); WF `0/16`; CL `0/24`, with supplementary cases `0/4`; 18 CL slices planned; 132 tasks remain planned; 0 approved implementation packets.
