# Task 002: Machine-Readable Task Registry

## Goal

Introduce a minimal version-controlled registry so future automation can identify task IDs, recorded lifecycle status, specifications, feature branches, and implementation PRs reliably.

## Scope and constraints

Change only `docs/tasks/registry.json`, `docs/tasks/README.md`, and `docs/tasks/002-task-registry.md`. Do not change `AGENTS.md`, the Task 001 specification, application source, IndexedDB schema, styles/assets, package files or lockfile, workflows, runtime configuration, or existing untracked HTML files. Do not introduce an orchestrator, database, application dependency, or automatic updater.

## Registry contract

The standard JSON top-level object contains exactly `schemaVersion` (integer `1`) and `tasks` (array). Each entry contains exactly `id`, `status`, `spec`, `branch`, and `pr`.

- `id`: unique string matching `^TASK-[0-9]{3,}$`; allocate sequential IDs padded to at least three digits, such as `TASK-001`, `TASK-002`, and `TASK-1000`. IDs are immutable and never reused.
- `status`: `draft`, `ready`, `in_progress`, `in_review`, `done`, or `blocked`.
- `spec`: nonempty repository-relative path to an existing specification.
- `branch`: exact nonempty branch name or `null`.
- `pr`: positive integer implementation PR number in this repository or `null`.

## Lifecycle and authority

`draft` means requirements being prepared. `ready` means specification and independent requirements review complete, with implementation authorized. `in_progress` means implementation started. `in_review` means implementation PR open. `done` means implementation merged and required post-merge verification completed. `blocked` means a decision or external action is required.

`in_progress` requires branch; `in_review` and `done` require branch and PR. Requested fixes stay `in_review` while the PR is open. If it closes and implementation continues without an open PR, status may return to `in_progress`. After a blocker resolves, resume at the stage matching actual work state.

The registry on `main` is authoritative recorded orchestration state. GitHub is authoritative PR, review, CI, merge, and deployment evidence. `AGENTS.md` is authoritative for review and merge gates. Status cannot bypass those gates. If GitHub evidence is unavailable or contradicts recorded state, stop and reconcile. Never restart implementation merely because the registry is stale; a missing PR value does not prove no implementation exists.

## Initial entries and implementation sequence

Verify TASK-001 against repository/GitHub evidence before recording `done`, specification `docs/tasks/001-pr-ci-validation.md`, branch `codex/001-pr-ci-validation`, PR `1`.

Create branch `codex/002-task-registry`. Initially record TASK-002 as `in_progress`, specification `docs/tasks/002-task-registry.md`, branch `codex/002-task-registry`, PR `null`. Validate, stage only the three permitted files, show staged names and summary, commit, push, and create the implementation PR. Its description must map changes to acceptance criteria and report validation and limitations.

Once the actual implementation PR exists, update only the registry entry to `in_review` with its actual positive integer PR number, validate again, commit, and push to the same branch. Do not merge or delete the branch during implementation.

## Documentation and post-merge reconciliation

Document field types, ID allocation, statuses/invariants, mapping rules, authority boundaries, stale-state handling, and completion evidence in `docs/tasks/README.md`. Completion includes required deployment verification when applicable.

The implementation PR must never set TASK-002 to `done`. After merge and required post-merge verification, a separate registry-only reconciliation PR changes its status to `done`. This is maintenance for TASK-002, not a new task, and preserves its implementation references. Consumers must recognize already-merged implementation and reconcile rather than start duplicate work.

## Acceptance criteria

1. Registry parses as standard JSON; top-level keys are exactly `schemaVersion` and `tasks`, version is integer `1`, and tasks is an array.
2. Entries have exactly the five required fields with correct types; IDs match the format, are unique, immutable, and never reused.
3. Statuses use the six-value enum and satisfy lifecycle invariants, including open-PR fixes and blocked resumption.
4. Specification paths are repository-relative and exist; branch/PR references reflect actual implementation.
5. TASK-001 mapping and completed state are verified against repository/GitHub evidence.
6. TASK-002 initially has the required `in_progress` entry and subsequently records the real PR as `in_review`; no premature `done` is recorded.
7. README documents allocation, mappings, lifecycle, authority, stale-state safety, completion evidence, and separate registry-only reconciliation for the same task.
8. Registry status cannot bypass GitHub evidence or `AGENTS.md` gates; unavailable or contradictory evidence stops dependent action, and missing PR does not justify duplicate implementation.
9. Only the three permitted files change; untracked HTML contents remain identical.
10. JSON/consistency checks, `npm run lint`, and `npm run build` pass, including TypeScript checks.

## Validation and review

Follow `AGENTS.md`: independent requirements review, implementer self-review against every criterion, independent code review, and configured merge gates. Validate exact keys, version/types, ID uniqueness/format, enum/invariants, specification paths, TASK-001 evidence, and permitted-file scope. Run lint and build before the initial commit and repeat validation after the PR registry update. Report branch, commits, PR, final entry, validation, changed files, and before/after HTML hashes. No test framework is configured or introduced.

## Assumptions and limitations

One implementation PR per task is the normal case; GitHub PR numbers are repository-local and distinct from task IDs. Maintenance is manual and can lag GitHub. Identity preservation and external evidence require review; this task adds no enforcement service or new runtime behavior.
