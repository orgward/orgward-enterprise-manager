---
name: orgward-orchestrate
description: Plan or coordinate authorized OrgWard slices, model assignments, independent review and resumable handoffs. Does not authorize agent spawning or product runtime execution by itself.
---

Paths below are repository-root relative. Read product AGENTS.md,
docs/engineering/WAYS-OF-WORKING.md and docs/engineering/prompts/orchestrate.md.
Use canonical dependencies and contracts/enterprise/agent-assignment-policy.json.
Run node ops/engineering-task.mjs T-01 --role design with the selected task/role
for a read-only recommendation; it is not a scheduler or approval.

Select one outcome and prerequisite closure. Use docs/engineering/templates/task-brief.json to bind
owned files, input/packet digests, independent oracle, allowed operations, limits
and stopping condition. Choose model/effort by semantic risk, not file extension.
Luna must not invent policy, migrations or acceptance even for a small diff.

Delegate only with explicit current user/applicable-instruction authorization and
useful separable work. Otherwise use sequential briefs. Model recommendations do
not override harness permissions/settings. No automatic billing/quota fallback.
Keep dependent work sequential and parallel writers nonoverlapping. An integrator
owns shared-contract changes, invalidation of affected briefs/reviews, conflict
resolution and combined checks. Child success does not close missing parent ACs.

Save commands, evidence, actual profile, unfinished step, pending effects and next
safe action in docs/engineering/templates/evidence-receipt.md. Stop on quota, unsafe ambiguity or
the bounded outcome. Never create reviewer loops to manufacture consensus.
