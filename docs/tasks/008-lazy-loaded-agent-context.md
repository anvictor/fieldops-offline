# TASK-008: Lazy-loaded agent context

## Goal and reading order

Refactor documentation so agents read only context required for the active task.
Start with [AGENTS.md](../../AGENTS.md), then [the registry](registry.json),
this active specification, and only the relevant routed documentation.
Do not recursively preload links or the documentation tree. TASK-001 through
TASK-007 are optional historical context, never default startup inputs.

## Scope and constraints

Remote `main` is the authoritative base. The previous isolated attempt and invalid
uploaded patch are not inputs. Use `codex/008-lazy-loaded-agent-context`.

Allowed changes: root `AGENTS.md`, root `README.md`, `server/README.md`, focused
Markdown modules under `docs/agent-context/`, this specification, and an additive
TASK-008 entry in `docs/tasks/registry.json`. Existing registry conventions remain
unchanged. Preserve historical TASK-001 through TASK-007 specifications and
registry entries exactly. Do not change application code, tests, workflows,
dependencies, manifests, lockfiles, runtime configuration, migrations or assets.

## Acceptance criteria

1. Root AGENTS.md is a concise always-read router. It retains all mandatory
   requirements-review, implementation, self-review, PR, independent-review,
   deterministic-validation and merge gates, including the seven-part restatement
   and prohibition on implementation with critical ambiguity.
2. Reading tiers explicitly distinguish always-read, conditionally required and
   optional/history context. Active flow is AGENTS.md → registry.json → active
   specification → only relevant routes; cross-cutting work loads the union of
   applicable modules without recursively preloading linked material.
3. `docs/agent-context/` contains README/routing and ownership, workflow, frontend
   and offline synchronization, backend and database, and validation modules.
   Each has a focused responsibility and explicit conditional source links.
4. README.md remains human/recruiter/developer facing. server/README.md retains
   usable API/database setup and REST guidance. Current frontend Vitest tests
   and implemented client-to-server replay replace stale claims of no tests/sync.
5. Preserve documented IndexedDB offline behavior, replay ordering and limits,
   retry/acknowledgment/discard semantics, single-writer and no-fencing limits,
   no initial download or multi-device conflict resolution, Pages/PWA boundaries,
   loopback-only unauthenticated development API, disposable test database and
   credential hygiene. Documentation changes do not claim new runtime behavior.
6. Run lint, frontend build/type checks, backend build/type checks, frontend
   tests, real PostgreSQL integration tests, documentation link checks, registry
   and scope checks, and whitespace checks. Record outcomes and limitations.
7. Complete independent requirements review before implementation, implementer
   self-review and independent implementation review. Use connected GitHub account
   `anvictor` for commits/push and PR creation. PR title begins `Task 008:` and its
   body identifies TASK-008, links this spec, and states change/reason, criteria,
   validation and assumptions. Do not merge.
8. Follow [registry lifecycle rules](README.md): draft → ready after specification
   and independent requirements approval → in_progress on the implementation
   branch → in_review only after the actual implementation PR exists. Then commit
   and push the registry update on the same branch with its actual PR number.
   Stop with the PR open; never predict done or change historical entries.

## Validation and review evidence

Use [validation context](../agent-context/validation.md) once created. Compare
scope and historical entries against the fetched main commit. Check local links
and fragments, JSON schema/lifecycle invariants, and `git diff --check`. A temporary
checker and disposable PostgreSQL instance may live outside tracked files;
no new scripts, dependency or test framework is required. Report exact final
remote head, changed paths, gate results, both review verdicts and final entry.

## Assumptions and unresolved questions

The user authorizes documentation implementation, branch publication and PR
creation, but no merge. Remote allocation/branch/PR collisions must be ruled out
before implementation. No critical scope ambiguity is known; any unavailable
validation must be reported honestly rather than represented as passing.
