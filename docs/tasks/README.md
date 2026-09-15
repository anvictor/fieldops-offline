# Task Registry Convention

`registry.json` records task identity, lifecycle state, and implementation references. Maintenance is manual; no orchestrator or automatic updater is implemented.

## Format and identity

Use standard JSON: no comments or trailing commas. The top-level object contains exactly `schemaVersion` (integer `1`) and `tasks` (array). Each task contains exactly:

- `id`: string matching `^TASK-[0-9]{3,}$`, for example `TASK-001` or `TASK-1000`.
- `status`: one of the six strings defined below.
- `spec`: nonempty repository-relative path to an existing task specification; never an absolute path or a path outside the repository.
- `branch`: exact nonempty implementation branch name, or `null` before it exists.
- `pr`: positive integer implementation PR number in this repository, or `null` before it is known.

Allocate the next unused sequential numeric ID after checking the registry on current `main` and outstanding allocation PRs. Pad to at least three digits. IDs are unique, immutable, and never reused; retain existing entries and avoid alternate padding for the same numeric ID. Resolve concurrent allocation conflicts before merge. GitHub issue and PR numbers do not allocate task IDs.

## Mapping

`TASK-002` maps to `docs/tasks/002-task-registry.md`, branch `codex/002-task-registry`, and its actual implementation PR number. Use `docs/tasks/NNN-<slug>.md` and `codex/NNN-<slug>` for new tasks. PR titles use `Task NNN:` and PR bodies include the exact `TASK-NNN` ID and specification link. Store exact existing references; do not rename historical task files or branches. Retain implementation references after completion or branch deletion. Reconciliation PRs do not replace the implementation PR number.

## Lifecycle

- `draft`: requirements being prepared.
- `ready`: specification and independent requirements review complete; implementation authorized.
- `in_progress`: implementation started.
- `in_review`: implementation PR open.
- `done`: implementation merged and required post-merge verification completed.
- `blocked`: progress requires a decision or external action.

Normal progression: `draft → ready → in_progress → in_review → done`.

`in_progress` requires a non-null branch. `in_review` and `done` require both branch and PR. Requested fixes remain `in_review` while the implementation PR is open. If it closes and implementation continues without an open PR, status may return to `in_progress`; retain its historical PR reference until a replacement is established. A blocked task resumes at the stage matching actual work state after resolution. Never infer approval from a status label.

## Authority and stale state

The registry on `main` is authoritative recorded orchestration state. Feature-branch edits are proposals until merged. GitHub is authoritative for PR, review, CI, merge, and deployment evidence. `AGENTS.md` is authoritative for review and merge gates; registry status cannot bypass those gates.

Before acting, compare the recorded task references and state with GitHub evidence. If evidence is unavailable or contradicts the registry, stop the dependent action and reconcile; do not guess. Never start duplicate implementation merely because recorded state is stale. A missing `pr` value is not proof that implementation does not exist: inspect matching branches and PRs by task ID and branch. If an implementation PR is already merged, determine whether verification or reconciliation remains instead of restarting implementation.

## Completion and reconciliation

Completion evidence means the implementation PR is merged, required reviews and checks satisfied the gates, and required post-merge verification is complete. When deployment applies, verify the successful deployment for the merged commit and the live result as required by `CONVENTIONS.md`. A green pre-merge CI run or merged PR alone does not prove deployment success. Cite evidence in the reconciliation PR; do not add evidence fields to the registry.

An implementation PR must never predict `done` for its own task. Initially TASK-002 is `in_progress` with its branch and `pr: null`. After its implementation PR exists, update its entry to `in_review` with the actual PR number on the same feature branch.

After merge and required completion verification, a separate registry-only reconciliation PR changes TASK-002 to `done`. This is administrative maintenance for TASK-002, not a new task. Retain its implementation references, follow applicable `AGENTS.md` gates, and change only `docs/tasks/registry.json`. Until reconciliation merges, consumers must recognize that recorded state can lag GitHub evidence.

## Validation

Parse with a standard JSON parser. Check exact keys, version, types, ID format and uniqueness, allowed statuses, lifecycle invariants, and existing specification paths. Compare IDs with history to prevent reassignment or reuse. Verify references and completion claims against repository/GitHub evidence. Check the diff for scope compliance and run `npm run lint` and `npm run build` (including TypeScript checks). No new dependency or test framework is required.
