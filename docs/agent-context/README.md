# Agent context routing and ownership

This directory contains focused, conditionally loaded guidance. It is not a
bundle to preload. [AGENTS.md](../../AGENTS.md) remains the always-read router
and mandatory-gate authority.

## Reading tiers

- **Always-read:** root AGENTS.md, then [registry.json](../tasks/registry.json),
  then the active specification selected from the request and registry.
- **Conditionally required:** only applicable root routes and sources whose
  conditions in those modules apply. Load the union for cross-cutting tasks.
- **Optional/history:** human overview and completed specifications, especially
  TASK-001 through TASK-007, only for requested historical evidence or rationale.

Never recursively follow links or scan/read the whole documentation tree.
A link is not an instruction to open every document it references. Missing
required sources block dependent work; conflicts must be reconciled, not ignored.

## Ownership and focused routes

| Document | Owns | Required when |
| --- | --- | --- |
| [Workflow](workflow.md) | Agent procedure, review, PR conventions | Planning, implementing, reviewing, PR work |
| [Frontend](frontend.md) | Frontend structure, offline/sync invariants, PWA | Frontend, offline, connectivity, sync, PWA work |
| [Backend](backend.md) | API/database architecture and safe setup routing | API, database, migrations, server setup |
| [Validation](validation.md) | Commands, test prerequisites, evidence | Validation, tests, CI work |
| [Task conventions](../tasks/README.md) | Registry identity, schema, lifecycle, reconciliation | Allocation or lifecycle maintenance |
| [CONVENTIONS.md](../../CONVENTIONS.md) | Deployment/live verification and learning principles | Deployment or learning decisions |
| [README.md](../../README.md) | Human/recruiter/developer overview and client behavior | Product overview, setup, detailed sync reference |
| [server/README.md](../../server/README.md) | API/database setup and REST contract | Server setup, REST or database contract work |

Root gates must remain visible without opening a module. Move detailed domain
context into its owner, update explicit routes when ownership changes, and avoid
unconditional chains that recreate eager loading. Human READMEs remain useful
without requiring readers to navigate agent process documents. Task specs own
scope and acceptance criteria; registry owns recorded state, never approval.

## Source authority

The user defines authorized scope. Root AGENTS.md owns mandatory review/merge
gates; task specifications define scope without waiving gates. Registry on main
is recorded orchestration state; GitHub owns actual PR/review/CI/merge evidence.
Source/configuration define current implementation. Resolve stale documentation
against current evidence; completed specifications are not a current-state map.
