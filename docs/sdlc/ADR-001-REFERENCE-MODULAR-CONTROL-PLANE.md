# ADR-001 — Embed MVPX as a modular reference control plane

- Status: accepted
- Date: 2026-09-18

## Context

Enterprise Studio is a dependency-free Node application with atomic JSON project persistence. The merged MVPX contract requires durable domain semantics, ports, deterministic gates, synthetic fixtures, a private operator UI, and no production credentials. It does not require distributed infrastructure for the reference proof.

## Decision

Implement Financial SDLC as a separate bounded module under `src/sdlc/`, separate persistence under `data/sdlc/`, separate `/api/sdlc/*` routes, and a separate browser surface. Domain/evaluation code remains independent of HTTP and storage. The existing enterprise-blueprint source of truth is not duplicated or changed.

Use an append-oriented evidence/event ledger inside each ChangeCase and atomic JSON aggregate writes with optimistic version checks. Enterprise context is a synthetic adapter-owned fixture; authority is an Authlayer-shaped policy adapter; implementation is behind a provider-neutral port and initially realized by a deterministic reference coding adapter that produces a real versioned change artifact and check evidence without external credentials.

## Consequences

- The proof remains locally runnable, inspectable, and deterministic.
- Bounded-context ownership and deny-by-default release authority are preserved.
- JSON persistence is suitable for the single-node private MVP but is not claimed as the production distributed topology.
- Real model, Git/CI, OrgWard, Authlayer, and observability providers can replace adapters without changing the domain contracts.
- No production release or legal/regulatory interpretation is performed.
