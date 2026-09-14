# Repository Guidelines

## Project Structure & Module Organization

FieldOps Offline is a React/TypeScript inspection app built with Vite. `src/main.tsx` mounts the app; `src/App.tsx` contains inspection UI and workflows. `src/db.ts` owns IndexedDB persistence and the pending sync queue. Reusable hooks live in `src/hooks/`, including `useOnlineStatus.ts`. Styles are in `src/App.css` and `src/index.css`; bundled assets belong in `src/assets/`, and static files in `public/`. Production output goes to `dist/`. Deployment configuration lives in `.github/workflows/deploy.yml`. Read `CONVENTIONS.md` for the project's learning and deployment principles.

## Build, Test, and Development Commands

- `npm ci`: install dependencies from the committed lockfile.
- `npm run dev`: start Vite with hot module replacement.
- `npm run lint`: run ESLint, including TypeScript, React Hooks, and React Refresh rules.
- `npm run build`: run TypeScript compilation checks and generate the production bundle.
- `npm run preview`: serve the built bundle locally for verification.

## Coding Style & Naming Conventions

Use functional React components and TypeScript. Follow existing source style: two-space indentation, double quotes, and semicolons; preserve surrounding configuration-file conventions. Use PascalCase for components and types, camelCase for functions and variables, and `use`-prefixed names for hooks. Keep browser subscriptions inside effects with matching cleanup handlers. Prefer small, readable changes that can be explained in an interview. ESLint is configured in `eslint.config.js`; no dedicated formatter is configured.

## Testing Guidelines

There is currently no automated test framework, test directory, `npm test` script, or coverage threshold. Run lint and build for code changes. Manually verify inspection creation, status changes, deletion, filtering, and persistence after reload. For connectivity changes, verify online/offline indicators and reconnect queue logging in the browser. If introducing tests, document the runner and use descriptive `*.test.ts` or `*.test.tsx` filenames.

## Commit & Pull Request Guidelines

History generally uses short, imperative subjects, such as `Extract online status into reusable React hook`; no enforced commit prefix is evident. Keep commits focused. PRs should explain the behavior change, list validation performed, link relevant issues, and include screenshots for visible UI changes. Pushes to `main` trigger GitHub Pages deployment; verify the live app after deployment.

## Mandatory Agent Development Workflow

For every non-trivial development task:

### Before coding

Independently restate:

1. Goal
2. Constraints
3. Acceptance criteria
4. Files that may change
5. Files that must not change
6. Assumptions
7. Unresolved questions

Do not begin implementation while critical requirements are ambiguous.

### Independent requirements review

A reviewing agent must independently interpret the original task before
reading the implementing agent's interpretation.

Compare both interpretations against the original task and its acceptance
criteria.

### Implementation

Implement only the approved scope. Avoid unrelated changes.

### Implementer self-review

Before opening a pull request, review the implementation against every
acceptance criterion and constraint.

### Pull request

The pull request must state:

- what changed
- why it changed
- which acceptance criteria are satisfied
- validation performed
- known limitations or assumptions

### Independent code review

A separate reviewing agent must check:

- compliance with the original task
- acceptance criteria
- constraints
- architecture
- regressions
- error handling
- security
- maintainability
- test coverage where applicable

The reviewer must approve or request changes.

### Deterministic validation

Before merge, run all available automated quality gates, including:

- lint
- type checks
- tests
- production build

### Merge gate

Do not merge unless:

- all acceptance criteria are satisfied
- implementer self-review passed
- independent review passed
- CI is green

## Persistence & Configuration

Reconnect currently logs queued operations; server synchronization is not implemented. Preserve queue behavior during refactors and avoid incidental IndexedDB schema changes. Keep Vite's `/fieldops-offline/` base path compatible with GitHub Pages. Never commit credentials or share access tokens in chat.
