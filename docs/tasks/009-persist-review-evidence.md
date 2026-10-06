# Task 009: Persist Independent Review Evidence

## Goal and problem

Make independent Agent B review evidence durable, attributable and auditable in
GitHub before implementation and merge. TASK-008 exposed missing persisted
verdicts and misattributed post-merge evidence. Prevent recurrence without
reconstructing historical reviews or expanding the always-loaded context.
Preserve the lazy-loaded architecture introduced by TASK-008.

## Preparation boundary

This first phase prepares only this specification and the TASK-009 draft registry
entry, committed and pushed for independent requirements review. No workflow
implementation, implementation PR or merge is authorized in this phase.

Base: remote main `355f5b1a6cb454cfbe175e05bcb294c0bb9c7d8b`, containing
TASK-008 reconciliation PR #15. Use `codex/009-persist-review-evidence` for this
preparation and subsequent authorized implementation. Since the branch exists,
record it exactly; keep `status: draft` and `pr: null` during preparation.
The pushed preparation commit is the requirements-review target; record its full
SHA in the review evidence, not a self-referential SHA inside this document.

## Required future procedure and acceptance criteria

1. **Requirements review before implementation.** Agent A first drafts and pushes
   the specification. Agent B independently interprets the original user request
   before reading Agent A's interpretation, then reviews the specification at an
   identifiable full commit SHA. Before implementation starts, Agent B persists
   its verdict in a GitHub commit comment on that requirements commit. An existing
   explicitly identified requirements-review GitHub conversation is also valid
   if it links the exact commit and specification. No implementation PR is needed
   to obtain requirements review.
2. **Evidence format and attribution.** Both requirements and implementation
   evidence identify task ID, review phase, reviewer role `Agent B`, verdict
   `APPROVE` or `REQUEST CHANGES`, full reviewed SHA, blocking findings (explicit
   `None` when absent), and material non-blocking findings when relevant. Evidence
   identifies the specification path for requirements review. Preserve the GitHub
   evidence permalink for later audit. Agent B authors its own verdict. A shared
   GitHub account may require a top-level comment instead of formal approval;
   the role/phase/SHA must still be explicit. Agent A may link genuine evidence
   but must not impersonate Agent B, invent verdicts or reconstruct missing review
   evidence from memory, summaries or chat. Missing evidence blocks its dependent
   action; obtain an actual review rather than backdating an approval.
3. **Requirements staleness.** Material changes to goals, scope, constraints,
   acceptance criteria or agreed design invalidate requirements approval and
   require a new Agent B review before affected implementation proceeds. Compare
   the reviewed specification to current requirements. Pure implementation or
   registry-progress commits do not themselves change approved requirements.
   Record the basis for treating a specification edit as non-material; if unclear,
   obtain re-review. Approval alone is not implementation authorization.
4. **Exact-head implementation review.** Agent B reviews the final implementation
   head and persists the evidence in that implementation PR's Conversation before
   merge. Any subsequent branch-head change invalidates that approval, including
   documentation, registry and merge/rebase commits. Obtain a new exact-head
   review; do not silently carry approval forward.
5. **Merge gate.** Immediately before merging, verify the current head equals the
   reviewed SHA, required CI succeeded for that same SHA, approval evidence already
   exists in GitHub, and no blocking findings remain. Preserve all existing root
   gates, branch protections and user stop/no-merge instructions. Use expected-head
   protection where supported so head movement cannot silently bypass review.
   An internal-agent summary without durable evidence is insufficient. This task
   documents the procedure; it introduces no automated enforcement or CI changes.
6. **Completion and reconciliation.** Retain existing deployment and live checks.
   Before requesting reconciliation to done, persist applicable post-merge evidence
   in the implementation PR Conversation: merge SHA, deployment run/result for that
   SHA when applicable, live checks performed/results and limitations. Distinguish
   direct verification from linked/reported evidence; do not invent missing facts.
   A reconciliation PR cites these durable links, changes only registry status,
   preserves original implementation references, and receives Agent B approval
   against its own exact final head before merge, with applicable exact-head CI
   and all existing gates. Its approval also becomes stale if its head changes.
7. **Lazy context.** Root AGENTS.md receives only the minimal mandatory invariant
   that independent approval evidence must be persisted for the exact reviewed
   head before merge. Put detailed requirements/implementation evidence procedures
   in `docs/agent-context/workflow.md`, lifecycle/reconciliation rules in
   `docs/tasks/README.md`, and optional exact-head validation clarification in
   `docs/agent-context/validation.md`. Preserve startup ordering, conditional
   routing, authority boundaries and concise root guidance. Do not default-load
   human README files, historical task specs or the documentation tree; no recursive
   preloading or duplicated detailed procedures in the root.
8. **Lifecycle and scope.** Preserve the registry schema and prior entries.
   TASK-009 progresses to ready only after genuine persisted requirements approval
   and implementation authorization, then in_progress when implementation starts.
   Once its actual implementation PR exists, record in_review and that PR number.
   Never predict done in the implementation PR. Completion requires later verified
   reconciliation. No runtime or application behavior changes.

## Allowed and protected files

Preparation may change only:

- `docs/tasks/009-persist-review-evidence.md`
- `docs/tasks/registry.json` (new TASK-009 entry only)

After requirements approval and separate implementation authorization, scope is
limited to those two files plus:

- `AGENTS.md` (minimal invariant only)
- `docs/agent-context/workflow.md`
- `docs/tasks/README.md`
- `docs/agent-context/validation.md` (only if clarification is necessary)

Protect all other files: application/backend source, tests, GitHub workflows,
dependencies, manifests/lockfiles, runtime configuration, migrations, assets,
TASK-001–008 specs and existing registry entries, `.codex/config.toml`, unrelated
local changes and untracked files. Do not rewrite historical review evidence.

## Validation and self-review

For preparation: parse standard registry JSON; verify exact keys/types/version,
unique IDs and numeric identities, status enum, lifecycle invariants, spec paths,
actual branch existence, null PR and unchanged prior entries. Inspect the diff
against the verified base for exactly the two preparation files; run
`git diff --check`, `npm run lint` and `npm run build` as required by registry
conventions. Inspect this specification against every user requirement. No
implementation or hosted PR validation is claimed during preparation.

For later implementation: check changed Markdown links/targets, routed ownership,
absence of recursive/default history loading, evidence templates and the stale
review rules above. Self-review every criterion and protected path. Run all
configured automated gates and exact-head hosted CI per the validation module;
record results and unavailable prerequisites honestly. Agent B independently
reviews the final head; this specification does not constitute that approval.

## Assumptions, questions and limitations

GitHub remains authoritative for review/CI/merge/deployment evidence; registry on
main records lifecycle state and AGENTS.md owns mandatory gates. Feature-branch
registry edits remain proposals until merged. This is manual workflow guidance,
not cryptographic identity verification, branch-rule configuration or an
orchestrator. A commit-comment permalink provides pre-PR requirements evidence
without changing registry schema. Agent B should explicitly assess that proposed
location and the material-change distinction. No blocking drafting questions
remain; implementation waits for persisted requirements review and authorization.
