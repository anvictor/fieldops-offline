# Task 003: Share Online Status Through React Context

## Goal

Refactor online status into a single Provider-owned state shared through React Context, preserving the public `useOnlineStatus(): boolean` contract and current application behavior.

## Scope and constraints

Change only `src/hooks/useOnlineStatus.ts`, `src/main.tsx`, new `src/contexts/OnlineStatusContext.ts` and `src/contexts/OnlineStatusProvider.tsx`, this specification, and `docs/tasks/registry.json`.

Preserve App workflows, reconnect queue logging, IndexedDB/schema, styles, assets, dependencies, runtime configuration, workflows, existing task documents, local AGENTS.md edits, and untracked HTML files. Do not implement server synchronization or merge the PR.

## Acceptance criteria

1. One Provider wraps App inside the existing StrictMode root and owns online status initialized with `useState(navigator.onLine)`.
2. The Provider subscribes to browser online/offline events in an effect; cleanup removes both using the same handler references, including StrictMode replay and unmount.
3. The existing named `useOnlineStatus(): boolean` hook at its existing path consumes Context only; multiple descendants share one status owner and subscription pair.
4. An explicit undefined Context default distinguishes absent Provider from offline false; usage outside the Provider throws a descriptive error rather than silently creating independent state.
5. Current status UI, inspection CRUD/filtering/persistence, and App's reconnect pending-queue logging remain unchanged. Its online listener remains a logging side effect, not another owner of status state.
6. Lint and production build, including TypeScript checks, pass. Validate shared consumers, initialization, event transitions, and cleanup; manually check application connectivity and inspection workflows where browser access permits, documenting any limitation.
7. TASK-003 uses specification `docs/tasks/003-shared-online-status.md`, branch `codex/003-shared-online-status`, initially in_progress with null PR, then in_review with the actual implementation PR number. Prior entries remain unchanged; do not predict done.
8. Self-review and independent review check scope, behavior, architecture, regressions, error handling, security, and validation coverage. The PR states what/why, acceptance criteria, validation, and limitations. Do not merge.

## Assumptions and decisions

The browser-only application mounts one Provider for all consumers. No SSR support, external store, dependency, or test framework is introduced. Separate Context and component modules preserve React Refresh lint conventions. A provider is now required for hook consumers; existing App integration supplies it.

## Validation and completion

Follow AGENTS.md review gates and the task registry convention. Run `npm run lint` and `npm run build`, check registry structure/references and the complete diff, and preserve unrelated local files. Completion requires a later merge, applicable deployment/live verification, and separate registry reconciliation.
