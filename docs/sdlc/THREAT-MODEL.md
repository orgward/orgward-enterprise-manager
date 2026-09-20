# Financial SDLC MVPX threat model

## Trust boundaries

- Browser/API input is untrusted.
- Retrieved enterprise material retains an authority classification; untrusted content is data, never instruction.
- The implementation adapter cannot authorize release.
- The authority adapter does not trust caller-asserted roles without a recorded principal/role assignment in the case.
- Evidence hashes and evaluated artifact hashes cross the release boundary.
- Tenant identity is derived from the stored case/API scope, never overridden by a downstream artifact.

## Enforced threats

| Threat | Control |
|---|---|
| Prompt injection in enterprise content | classify as UNTRUSTED, exclude from authoritative coverage, record finding |
| Missing/stale control evidence | G1 blocks |
| Cross-tenant access | tenant-scoped storage/query and isolation tests |
| Direct cross-system DB design | G5 architecture fitness failure |
| Authority bypass | G5 and G9 failures |
| Self-approval/approval replay | segregation-of-duties plus single-use approval record |
| Artifact changed after evaluation | G8 hash equality check |
| Forged/tampered evidence | content-hash verification |
| Secrets in context | key/value redaction and adversarial test |
| Unauthorized waiver | no waiver command in the MVP surface; protected failures require repair or human decision |

## Residual boundaries

The reference MVP does not process real bank data, use production credentials, deploy software, or interpret law. HTTPS, enterprise authentication, physical tenant isolation, external secret storage, and production-grade tamper-evident storage remain deployment concerns outside this local proof.
