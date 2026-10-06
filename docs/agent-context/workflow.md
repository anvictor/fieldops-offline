# Workflow context

Required for planning, implementing, reviewing or opening PRs. Apply every
mandatory gate in [AGENTS.md](../../AGENTS.md); this module adds procedure.

## Requirements and implementation

Independently restate goal, constraints, acceptance criteria, allowed/protected
files, assumptions and unresolved questions. A separate requirements reviewer
first reads and interprets the original task without the implementer's account;
then compare interpretations against the request and criteria. Resolve critical
ambiguities before implementation. User authorization defines approved scope.

Implement focused changes and preserve unrelated local work/configuration.
Review every criterion and constraint yourself before opening the PR. A separate
implementation reviewer checks scope, architecture, regressions, errors,
security, maintainability and applicable coverage; record approve/request changes
and resolve findings. Status labels do not replace either review.

## Independent review evidence

Agent A drafts and pushes the task specification first. Agent B independently
interprets the original request before reading Agent A's interpretation, then
reviews the requirements at the full specification commit SHA. Before implementation
begins, Agent B authors and persists its own verdict in a GitHub commit comment
on that commit, or an explicitly designated requirements-review conversation
linking the exact commit and specification. Preserve its permalink. Requirements
approval and explicit implementation authorization are both required.

Use this evidence format for requirements, implementation and reconciliation
reviews; placeholders are not evidence:

```text
Task ID: TASK-NNN
Review phase: requirements | implementation | reconciliation
Reviewer role: Agent B
Verdict: APPROVE | REQUEST CHANGES
Exact reviewed SHA: <full commit SHA>
Specification path: <required for requirements review>
Blocking findings: None | <findings>
Material non-blocking findings: None | <findings when relevant>
```

After posting, return and retain the durable GitHub comment/review permalink.
Agent A links that evidence and the implementation authorization in the PR body.
A shared GitHub account may require a top-level comment rather than a formal
approval; role, phase and SHA must remain explicit. Agent A must never impersonate
Agent B or author reviewer evidence on its behalf. Do not reconstruct missing
approval from memory, chat summaries or implementer reports. Missing evidence
blocks the dependent action: obtain the actual review, never backdate it.

Material changes to goal, scope, constraints, acceptance criteria or agreed design
invalidate requirements approval. Stop affected implementation and obtain Agent B
review of the updated requirements SHA before proceeding. Compare the approved
specification with current requirements; pure implementation or registry progress
commits do not alone invalidate requirements approval. Record the basis for a
non-material specification edit; when uncertain, require re-review.

Agent B reviews the final implementation head and persists its verdict in that
implementation PR's Conversation before merge. Any later head change, including
documentation, registry or merge/rebase commits, invalidates implementation
approval. Obtain a new exact-head review; internal reviewer summaries without
durable GitHub evidence do not satisfy this gate.

## Cross-agent prompt safety

Every A/B handoff prompt must explicitly identify intended agent, role, task ID
and phase, for example:

```text
TO AGENT B - INDEPENDENT REVIEWER
TASK: TASK-NNN
PHASE: IMPLEMENTATION REVIEW
```

Use Agent A / IMPLEMENTER for implementation work and name the actual phase.
If a prompt is addressed to the other agent, stop without actions, do not adopt
its role, and return a clear `WRONG AGENT` message identifying the intended agent.

## Commits and pull requests

Use short imperative commit subjects and focused commits. For registered tasks,
PR titles begin `Task NNN:`; include the exact `TASK-NNN` ID and a specification
link in the body. Describe what/why, satisfied criteria, validation and limitations
or assumptions; include screenshots for visible UI changes and relevant issue
links. Never invent PR numbers or represent an unrun check as passing.

When allocating or updating task lifecycle, read [registry conventions](../tasks/README.md).
Check current main registry plus matching branches/PRs before starting duplicate
work. Normal lifecycle is draft → ready → in_progress → in_review → done.
After the real implementation PR exists, update its registry entry to in_review
with actual branch/PR on that same feature branch. Historical records remain
unchanged unless the authorized task is their reconciliation.

## Validation and completion

Read [validation](validation.md) when choosing or running gates. Do not merge
unless criteria, self-review, independent review and green CI satisfy the root
gate. Immediately before merge, verify the current head equals Agent B's reviewed
SHA, the approval permalink already exists in GitHub, no blocking findings remain,
and required CI succeeded for that same SHA. Use expected-head protection where
supported so a moved head fails the merge. Never bypass branch protection.
A user's instruction to stop with the PR open overrides proceeding to merge.
When deployment or completion verification applies, read
[CONVENTIONS.md](../../CONVENTIONS.md); a push to main triggers Pages deployment,
which requires successful deployment and live verification. Only after merge
and applicable verification may a separate registry-only reconciliation PR mark
a task done, retaining its original implementation references.

Before requesting reconciliation, persist post-merge evidence in the implementation
PR Conversation: merge SHA, applicable deployment run/result for that SHA, live
checks/results and limitations. Distinguish direct verification from linked or
reported evidence. Follow the conditionally loaded registry completion rules;
reconciliation requires its own exact-head Agent B approval and applicable CI.
