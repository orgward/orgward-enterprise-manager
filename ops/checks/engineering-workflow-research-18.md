# RM-WOW-18 — repository engineering skills and model guidance

2026-09-20. One bounded mission for T-01/T-131 and E-15, counted before browsing
in the local DELIVERY-STATUS ledger. Two search queries, two opened official
sources; no new package/provider research. Sibling research ledger is read-only.
Shared allowance is now 2/5 used, three remaining; reconcile by mission ID.

Question: how to make the requested engineering skills portable with the repo and
retain appropriate model/effort choices without implying automatic authorization?

The [official skill documentation](https://learn.chatgpt.com/docs/build-skills)
describes repo-local `.agents/skills`, SKILL.md name/description metadata,
explicit/implicit invocation and progressive loading. We use that location for
project-specific skills; sessions started outside the repo can explicitly read
their absolute SKILL.md paths. No global configuration or plugin installation.

The [official model guidance](https://learn.chatgpt.com/docs/models) distinguishes
Sol for complex work, Terra for everyday work and Luna for clear repeatable tasks;
increased reasoning trades resources for deeper analysis. Availability depends on
client/account. Exact task assignments and High/XHigh choices are our engineering
recommendations, not published OrgWard benchmarks or guaranteed model availability.
Existing 132-task recommendations are retained. No automatic model switch or paid
fallback; an unavailable requested profile must be disclosed.

Outcome: unblocked repo skills, reusable prompts/templates and deterministic
recommendation checks. Documentation verification does not qualify product behavior.
