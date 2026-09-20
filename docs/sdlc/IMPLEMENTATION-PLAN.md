# Financial SDLC MVPX implementation plan

Source contract: `orgward/orgward-autonomous-stack@11fb942f4ea7aee0767ae6132294778dec08d74c`, especially `docs/MVPX_FINANCIAL_SDLC.md`.

## Outcome

Add a second, isolated product surface to Enterprise Studio that can take the synthetic beneficial-owner change from ambiguous intent through governed context, impact, requirements, architecture, delivery, implementation evidence, assurance, human-authorized release, observation, and a follow-up proposal. The same runtime must demonstrate that missing context, invalid design, defective requirements, and unauthorized release are blocked by the intended gates.

The implementation is a private reference control plane. It uses synthetic financial data and a deterministic reference execution adapter, requires no production credentials, performs no deployment, and does not represent legal advice or a production bank change.

## Increment map

| Increment | Product outcome | Objective evidence |
|---|---|---|
| MVPX-001 | Typed ChangeCase, stages, gates, events, optimistic concurrency, idempotency, persistence | lifecycle/unit/restart tests |
| MVPX-002 | Synthetic financial organization and golden impact neighborhood | fixture and traversal tests |
| MVPX-003 | Provenance-bearing context discovery and sufficiency coverage | missing AML/control mutation blocks G1 |
| MVPX-004 | Direct/indirect impact set with an independent completeness critic | omitted reporting consumer blocks G2 |
| MVPX-005 | Synthetic obligation/control mapping and human-judgment escalation | unresolved interpretation returns NEEDS_HUMAN at G3 |
| MVPX-006 | Atomic traced requirements and independent quality evaluation | contradictory/untestable requirement mutation blocks G4 |
| MVPX-007 | Baseline/target architecture delta and fitness functions | cross-system DB and authority-bypass designs block G5 |
| MVPX-008 | Dependency-valid WorkItems and immutable bounded ContextPackages | orphan/cycle/incomplete plan blocks G6 |
| MVPX-009 | Provider-neutral execution contract with deterministic reference coding adapter | bounded change artifact plus implementation evidence |
| MVPX-010 | Twelve-dimension assurance registry and release readiness | failing checks and evidence/hash mismatches block G7/G8 |
| MVPX-011 | Authlayer-shaped authority decision, segregation of duties, approval, release bundle | unauthorized/self-approved production release blocked |
| MVPX-012 | Technical/control/business outcome evaluation | technical PASS + business FAIL produces evidenced result |
| MVPX-013 | One-command autonomous progression to human/authority boundaries | golden scenario reaches approval with complete lineage |
| MVPX-014 | Tenant isolation, adversarial provenance, injection, crash/resume and runbook | hardening test suite and operational documentation |

## Delivery sequence

1. Establish contracts, fixture, evidence hashing, events, and pure evaluators.
2. Implement the durable orchestration and persistence adapter.
3. Expose the command/query HTTP surface with version and idempotency checks.
4. Add an operator UI for stage state, gates, evidence, lineage, impacts, requirements, architecture, work, assurance, approval, and outcomes.
5. Execute positive, mutation, adversarial, isolation, and restart scenarios.
6. Record a source digest and actual check receipt. Only objective passes are reported.

## Acceptance boundary

Complete means the reference scenario and specified negative behaviors run locally from a clean private workspace. It does not mean production deployment, real regulatory interpretation, real customer data, real bank integration, or unrestricted autonomous release. Those are explicitly excluded by the merged MVPX contract.
