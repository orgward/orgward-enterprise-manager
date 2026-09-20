# Domain-definition checkpoint 12 — Sentinel and Warden

Date: 2026-09-20. Workdir: /srv/orgward/orgward-enterprise-studio.
Revision: `tree-sha256:5414bfe6b495cde1693386b74a7bf9f2ef58ab0582d222158dc840cebb3d013d` (242 files).
[Tree manifest](domain-vectors-12-tree.json); [raw results](domain-vectors-12-check-results.json).
Saved locally; no commit/push, deployment, dependency install or provider effect.

## Saved deliverables

32 source-bound original acceptance definitions for T-69–T-76, 245 observations;
28 Sentinel trigger/control pairs with a versioned local profile and structural
guard; [user journey](../../docs/product/SENTINEL-WARDEN-INTERACTIONS-12.md);
[handoff](../../docs/production/DOMAIN-FIXTURE-HANDOFF-12.md);
roadmap, entry docs and local status ledgers updated.

The detailed decisions preserve typed graph identity and loss-aware OADL;
unknown scope versus global; canonical severity versus exception disposition;
heuristic versus deterministic findings; explicit property inheritance; source
coverage versus design retraction; immutable historical evidence; and Warden
deny/obligation/grant precedence. Configurable workflows remain mandatory and
cannot bypass broker controls by changing a diagram.

All source R-01–R-28 and AT-01–AT-33 IDs are preserved. Local severity range choices,
thresholds, grouping, exception compatibility and conservative actionability
measurement are disclosed in the handoff, not attributed as unchanged source text.

## Executed checks and limitations

| Check | Actual result |
| --- | --- |
| npm run check | Exit 0; syntax checks, all 36 existing tests and specification checks passed |
| check-spec --self-test --verify-sources | Exit 0; all 27 pinned source hashes verified |
| Comparator self-tests | 268 constructed reports accepted; 1,806 mutated/missing reports rejected |
| Definition/index guards | 13 malformed-vector and 10 registry/source mutations rejected |
| Sentinel fixture guard | 28 rule pairs / 56 subcases structurally present; 10 invalid-profile/fixture mutations rejected |
| Workflow guard | 16 invalid contract mutations rejected; one synthetic contribution check passed |
| Preservation | 42 files byte-identical to increment 11: 35 runtime/UI/test/package files, five previous vector files and canonical backlog/architecture |
| Status assertions | All 132 tasks planned; 480 original cases not_run; P/E/WF gates and research budget unchanged |

The initial source-manifest lookup used the wrong docs subdirectory; corrected
using file discovery. This read-only diagnostic failure changed no files.
No browser test or new application acceptance was run. The synthetic comparator
documents are built from expectations and cannot prove domain implementation.
Rule pairs are test definitions, not a rule engine or 56 completed acceptance cases.

Cumulative: **268/480 definitions**, **1,538 expected observations**, **79/132 tasks**.
Remaining definition layer: **212 scenarios / 53 tasks**.
Combined vector digest:
`a402b873d5cbdba06d3c46e4e70cf9a837708baa4cd6ab92b313352b8bf09445`.
Full schema seeds, real observation adapters, runtime/UI implementation and genuine
independent review are still required. Approved implementation packets remain zero.

## Fixed release gates

| Gates | Unchanged status |
| --- | --- |
| P-01 business chat; P-02 blueprint; P-03 integrity; P-04 map | Historically verified; regression checks pass, no expanded qualification claimed |
| P-05 editing/versioning; P-06 roles/instructions | Pending |
| P-07 runnable plan; P-08 intervention; P-09 real agent task | Pending |
| P-10 full persistence; P-11 readiness; P-12 end-to-end demo | Pending |

Private **4/12**, enterprise **0/16** (E-07/E-15 in progress, all others pending),
additional WF **0/16**. The demonstrator is still not enterprise-ready.

## Research and next boundary

No new research mission. Shared usage **1/5**, four available. Keep
RM-WORKFLOW-10 awaiting read-only sibling-ledger reconciliation; never reset it.

Next bounded definition slice: T-78–T-89, policy lifecycle and Arbiter/Steward/
Ledger/Overseer. T-77 already has high-risk vectors from 07. Follow dependency and
independent packet review rules before any implementation. Stopped at this saved
specification increment.
