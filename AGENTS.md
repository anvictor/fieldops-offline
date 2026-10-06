# Agent Entry Point

FieldOps Offline is a React/TypeScript inspection PWA with IndexedDB and a separate
Express/PostgreSQL API. GitHub Pages hosts the PWA only.

## Always-read startup

Read in this order: **AGENTS.md → [docs/tasks/registry.json](docs/tasks/registry.json)
→ the active task specification → only relevant routed documentation below**.
Select the active task from the user's request and registry, not by loading all
specifications. If no registered task applies, use the user's authorized scope
and applicable routes. A missing or contradictory required source blocks its
dependent action; reconcile before proceeding.

Do not recursively preload links, modules, the documentation tree or task archive.
Links are navigation; read a linked source only when its stated condition applies.
Completed TASK-001 through TASK-007 specifications are optional history and must
not be loaded by default. Cross-cutting work loads the union of relevant routes.

Always preserve unrelated work, offline persistence and queue behavior. Avoid
incidental IndexedDB schema changes; retain `/fieldops-offline/` Pages/PWA scope.
Keep the unauthenticated development API on loopback. Never commit credentials
or print access tokens. Follow the user's authorized scope.

## Mandatory workflow and merge gates

For every non-trivial development task:

1. Before coding, independently restate **goal, constraints, acceptance criteria,
   files that may change, files that must not change, assumptions and unresolved
   questions**. Do not implement while critical requirements are ambiguous.
2. A reviewing agent independently interprets the original task **before reading
   the implementer's interpretation**. Compare both with the original request
   and acceptance criteria.
3. Implement only approved scope; avoid unrelated changes. Before opening a PR,
   perform implementer self-review against every criterion and constraint.
4. The PR must state what changed, why, satisfied acceptance criteria, validation
   performed, and known limitations or assumptions.
5. A separate reviewing agent must check original-task compliance, acceptance
   criteria, constraints, architecture, regressions, error handling, security,
   maintainability and applicable test coverage. It must approve or request changes.
6. Before merge, run all available automated quality gates: lint, type checks,
   tests and production build. **Do not merge** unless every criterion is met,
   self-review and independent review pass, and CI is green. Honor a user-directed
   stop before merge. Applicable deployment/live verification follows merge.
7. Before merge, Agent B approval must already be durably persisted in GitHub
   for the exact final head SHA, with successful required CI for that same SHA.
   Any subsequent head movement invalidates approval and requires re-review.

This root file owns these mandatory gates. Modules supplement them; task scope
and registry status never waive them or establish approval.

## Conditionally required context

| Active work | Read | Scope |
| --- | --- | --- |
| Planning, implementation, reviews or PRs | [Workflow](docs/agent-context/workflow.md) | Procedure, PR and lifecycle details |
| Frontend, offline data, connectivity, sync or PWA | [Frontend and sync](docs/agent-context/frontend.md) | Structure, browser behavior and limits |
| API, database, migrations or backend setup | [Backend and database](docs/agent-context/backend.md) | Server setup and REST constraints |
| Validation, tests or CI | [Validation](docs/agent-context/validation.md) | Gates, prerequisites and evidence |
| Task allocation or registry/lifecycle changes | [Registry convention](docs/tasks/README.md) | Identity, transitions and reconciliation |
| Deployment, production configuration or learning conventions | [Conventions](CONVENTIONS.md) | Deployment/live and learning authority |
| Documentation routing or ownership changes | [Context README](docs/agent-context/README.md) | Module ownership and reading tiers |

## Optional and historical context

[README.md](README.md) is the human project overview; read it for setup or product
behavior. Completed task specs are historical rationale, read only when the
active task explicitly needs their evidence. Do not infer current behavior from
historical specs; check current source and applicable modules.
