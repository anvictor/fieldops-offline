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
gate. A user's instruction to stop with the PR open overrides proceeding to merge.
When deployment or completion verification applies, read
[CONVENTIONS.md](../../CONVENTIONS.md); a push to main triggers Pages deployment,
which requires successful deployment and live verification. Only after merge
and applicable verification may a separate registry-only reconciliation PR mark
a task done, retaining its original implementation references.
