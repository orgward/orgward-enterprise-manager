# Bounded implementation prompt

For issue #1 affected packets, verify reviewed CR-019 digest, closed-loop requirement
IDs and bounded contribution tests. Preserve immutable failed evaluations and route
semantic/context/authority problems to their owners; do not weaken tests to advance.

Use $orgward-implement for [task/slice] from [packet path/digest].
Authority: [current request]. Dependency/review receipts: [paths].
Owned paths, non-goals and limits: [scope]. Stop at [bounded result].

Verify readiness. Implement independent contract tests, durable behavior, API and
usable UI. Exercise success, denial, conflict, stale, race, restart and recovery;
observe actual state/effects, not copied expected values or static labels.
Retain failures exposing flawed requirements and use change control; pause affected
semantics for review. Record actual model/effort, revision, commands, raw evidence
and findings. No next-task auto-start, push/deploy or live effects without authority.
Checkpoint and wait on quota.
