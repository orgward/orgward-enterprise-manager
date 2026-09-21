# Independent engineering review prompt

Use $orgward-review for [packet/change/implementation] at [revision/digest].
Scope: [task/AC/WF IDs]. Raw sources/artifacts/results: [paths].
Author/session and actual reviewer authority/independence: [identities].

Derive expectations from sources, not the author's desired conclusion. Inspect
UX, commands, shared state, current permissions, real effects and recovery.
Challenge substantive counterexamples; detect mocked acceptance, vacuous counts,
omitted matrix rows and changed intent. Do not edit candidate during review.

Return findings with evidence, severity, criterion, repair and re-review conditions.
Distinguish pass/fail/not_run. Missing independence/authority/evidence stays explicit.
Never approve your own work or impersonate customer/security/release qualification.
