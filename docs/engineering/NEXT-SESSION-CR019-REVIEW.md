# Copy-ready prompt for the next Codex session

Use the repository `/srv/orgward/orgward-enterprise-studio`. Work as an independent
engineering reviewer using the repository's `orgward-review` skill. Use Sol High
reasoning if model selection is available; record the actual model and effort.

Read `AGENTS.md`, the product brief/release gates it references,
`docs/engineering/WAYS-OF-WORKING.md`, `docs/engineering/CHANGE-CONTROL.md`,
`.agents/skills/orgward-review/SKILL.md` and
`docs/engineering/prompts/review.md` before acting.

Review CR-019 at the exact pushed revision. Its source is GitHub issue #1 as pinned
in `docs/production/ISSUE-1-SOURCE-19.json`; its candidate is bound by
`contracts/enterprise/closed-loop-manifest-19.json` and
`docs/engineering/changes/CR-019.json`. Review all 24 requirements, 18 delivery
slices, four supplementary cases, 17 schema definitions, the architecture/control
specification, UX, canonical backlog/architecture links, start guards and tests.
Compare them with the original 132 tasks/480 criteria and WF-01–WF-16. Do not rely
only on the author's summary or saved expected values.

Specifically challenge:

- whether every issue checkbox is preserved without weakening existing obligations;
- enterprise-state ownership versus workflow/runtime ownership and avoidance of a
  disconnected second orchestrator or second truth graph;
- clarification value-of-information policy, excessive questioning, inaccessible
  context, human authority and durable answer reconciliation;
- proof-obligation completeness, evaluator provenance/calibration/disagreement,
  Goodharting, hidden fixtures and deterministic-versus-semantic choice;
- diagnostic routes, bounded/no-progress loops, budget continuity, editable
  diagram/form parity and behavior under restart, concurrency and stale context;
- evidence-derived acceptance, distinct implementation/release/outcome states,
  immediate reconciliation, immutable history and institutional Learn semantics;
- tenant isolation, permission-safe trace queries, current effect authority,
  unknown external effects, migration compatibility and recovery;
- whether slice dependencies and bounded contributions are implementable by future
  agents without requiring a prerequisite task to prove a downstream full runtime;
- false-readiness paths in the checker, candidate hashing and change lifecycle.

Run at least `npm run check`,
`node ops/check-spec.mjs --self-test --verify-sources`,
`node ops/check-closed-loop.mjs`, and appropriate adversarial/mutation checks you
add outside the candidate or as review-only diagnostics. Inspect actual source and
test behavior. Structural green checks are not semantic approval.

Save a revision- and candidate-digest-bound review under `ops/checks/`, using
`docs/engineering/templates/review.md`. Include severity, exact artifact/criterion,
counterexample, impact, required repair and re-review condition. Record authentic
reviewer/session/model/effort and explain the independence boundary. Do not claim
customer, security, legal or release certification.

Do not edit the candidate during the review. If findings require changes, set the
review decision to `changes_requested`, update CR-019 only with the authentic review
metadata allowed by the change contract, leave the proposal unapproved, and stop
with an exact repair handoff. If the exact candidate passes, record an `approved`
engineering review and move CR-019 only to `reviewed`; do not mark it `approved` or
`applied`, do not change `closed_loop_obligations-19.json` to adopted, do not start
CL-001/002 implementation and do not promote any product gate. Those are a separate
integration/adoption session after review.

Preserve user work. Make no deployment, live external effect, issue comment, paid
fallback, automatic model dispatch or Git push unless explicitly requested in that
new session. End with: review disposition, findings, exact checks, changed files,
current P/E/WF/CL counts, and the next bounded action.
