# Improving requirements without losing intent

The user permits reasonable alterations that better realize OrgWard's goal.
A frozen packet is a review boundary, not a ban on learning. This engineering
process is distinct from customer business-model CP-01–06.

| Class | Handling |
| --- | --- |
| correction | Typo/refactor/detail with unchanged observable contract: ordinary reviewed diff/tests; record if shared semantics change |
| refinement | Clarify semantics/add needed edge cases/improve UX within agreed outcomes: change record, impact closure, independent engineering review |
| architecture | Runtime/storage/API/transaction/safety-mechanism change: record plus ADR, compatibility/migration analysis and appropriate architecture/security review |
| goal_change | Remove outcome, weaken mandatory controls, change fixed gate denominator or add materially different external/paid commitment: explicit user/authorized-owner decision plus required independent review |

If uncertain use stronger review, pausing only the affected decision. Ordinary
implementation details do not need user micromanagement. New authority, customer
policy, irreversible loss or material goal change does. “Better” never means
drop hard criteria, fabricate evidence, spend money or expose systems implicitly.

## Record and decide

Copy templates/change-proposal.json to docs/engineering/changes/CR-<id>.json
and register it in contracts/engineering/change-register.json. Initial state:
proposed, approvals null. Capture problem/evidence/failing test, affected actor/
outcome, alternatives, measurable benefit and before/after semantics.

Preserve old exact text/hash/revision. Enumerate impact on tasks/dependencies,
UX/perspectives, shared model, APIs/events, policy/isolation, workflows/active runs,
migration/compatibility, evidence/retention, operations/SLOs and P/E/WF/source
qualification. Record explicit not-applicable rationale, not omitted categories.
Name tests to rerun, reviews/packets to stale, owner and stop/resume condition.

Lifecycle: proposed → reviewed → approved → applied, or rejected/deferred.
Approval binds candidate digest and genuine independent review. goal_change also
binds a user/authorized-owner decision. Applied lists changed artifacts and actual
validation receipts, plus invalidated dependencies. Applied design is not product
implementation or qualification. Revision drift requires re-review.

Machine checks verify structure, IDs, separation labels and referenced files,
not reviewer authenticity or correctness of impact analysis. Review those separately.
Never manufacture approval to make the checker pass.

## Preserve lineage and update the entire affected chain

Keep original task/AC IDs and historical evidence. Prefer extra distinguishing cases
or children mapped to original obligations. For true semantic replacement retain
old exact text/hash/disposition and successor mapping; only update current canonical
contracts after approval. Old pass evidence does not automatically apply to new
meaning. Reset affected current applicability and rerun on the successor.

Synchronize UX, schemas/errors/transitions, vectors/source hashes, dependencies/
indexes, WF contributions, roadmap and support matrix. Review semantic diffs before
regenerating drafts/hashes—no bulk refresh hiding drift. Keep unrelated artifacts
unchanged. New criteria require independent vectors before exact coverage passes.
Preserve P12/E16 and old history unless explicitly revised by the user; never reset
denominators or the research budget to conceal work.

Run npm run check:spec, npm run check:engineering and affected real acceptance;
verify pinned sources when relevant. Discoveries outside the active increment
become owned proposals and next steps, not automatic expanded implementation.
Proposed/reviewed/applied design is not verified product functionality.

## Examples

- Repeated 01:30 timer: retain reproducer, specify timezone/version/occurrence,
  update schema/UI/recovery tests and stale the packet.
- Diagram cannot express the form's bounded loop: preserve WF parity; review the
  representation and compatibility change, not removal of the diagram requirement.
- Invalidation race: retain failing schedule, compare transactions, revise storage/
  commands/consumers/UX before resuming.
- Drop tenant isolation or human release review to save effort: mandatory safety
  change, not routine simplification; implementer cannot approve it.
