# Domain-definition checkpoint 16 — SaaS and migration preparation

Date: 2026-09-20. Workdir: /srv/orgward/orgward-enterprise-studio.
Base Git commit: db1d93cfd9e7af3054d7bf7f8149d33d5cf8d5c4; earlier local
checkpoints 14 and 15 are preserved.
Saved revision: `tree-sha256:cdfe9454d4e730b72952d529754a2be515f64ac0baafb097ee7c03c2f5bf3b3f` (255 files).
[Manifest](domain-vectors-16-tree.json); [raw checks](domain-vectors-16-check-results.json).

## Saved work

40 original scenario definitions and 200 expected observations for T-109–T-118.
[User walkthrough](../../docs/product/SAAS-MIGRATION-INTERACTIONS-16.md) and
[handoff](../../docs/production/DOMAIN-FIXTURE-HANDOFF-16.md) detail scoped
whole-business inventory, tenant provisioning/identity/usage/support/residency,
source discovery/mapping/coexistence and migration validation/shadow/rehearsal.

Existing supplemental operations are integrated as contract obligations rather than
replaced. Full aggregate schemas/seeds/observation adapters and legitimate independent
packet review remain required. Updated entry documents and both local ledgers.
No runtime/UI code, dependency, server configuration, research, commit or push changed.

## Actual checks

| Check | Result |
| --- | --- |
| npm run check | Exit 0; syntax, all 36 existing regression tests and specification checks passed |
| check-spec --self-test --verify-sources | Exit 0; 27 pinned source hashes verified |
| Comparator self-tests | 432 constructed reports accepted; 2,796 altered/missing reports rejected |
| Definition/index guards | 13 invalid definitions and 10 registry/source mutations rejected |
| Sentinel fixture guard | 28 pairs retained; 10 invalid mutations rejected; no engine acceptance |
| Workflow guard | 16 invalid mutations rejected; one synthetic contribution check passed; no runtime acceptance |
| Preservation | 47 files match checkpoint 15: 35 runtime/UI/test/package files, nine old vector batches, Sentinel fixtures and canonical backlog/architecture |
| State audit | 132 tasks planned, 480 original criteria not_run; P/E/WF states and research allowance preserved |

Cumulative **432/480 definitions across 120 tasks**, **2,364 observations**.
Remaining **48 original scenarios across 12 tasks** without this layer.
Vector digest: `00763122922a6424ef4e6e0aee94a09cd7921cb1fb1c05dd25a50c614ce18d21`.
Comparator reports are synthetic expected-value comparisons, not product behavior.
No real tenant provisioning, identity recovery, relocation, migration or provider
qualification was performed. Approved implementation packets remain zero.

## Fixed gates and next slice

P-01 conversation, P-02 blueprint, P-03 integrity and P-04 map remain historically
verified. P-05 editing, P-06 roles/instructions, P-07 runnable plan, P-08 intervention,
P-09 real agent execution, P-10 complete persistence, P-11 readiness and P-12 full
demo remain pending. Original 4/12; enterprise 0/16 (E-07/E-15 in progress);
additional workflow 0/16. No product gate promotion.

Research 1/5 used, four remain. Next: remaining T-120–T-132 except already-covered
T-123; T-119 also already has older definitions. Preserve all dependency edges,
including T-117's prerequisite T-124. T-132 remains the final qualification target.
