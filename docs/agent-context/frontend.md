# Frontend and offline synchronization context

Required for frontend, hooks, persistence, connectivity, synchronization or PWA
work. Read [README.md](../../README.md) when detailed sync behavior, configuration
or local setup is involved; read [validation](validation.md) when testing changes.
For API contract changes also load the root backend route.

## Structure and style

`src/main.tsx` mounts React; `src/App.tsx` implements inspections and sync UI.
`src/db.ts` owns IndexedDB v2 and the mutation queue; `src/sync.ts` coordinates
replay; `src/api.ts` validates configuration and acknowledgments. Online state is
shared through `src/contexts/OnlineStatusProvider.tsx` and consumed by
`src/hooks/useOnlineStatus.ts`. Styles are `src/App.css` and `src/index.css`;
bundled assets live in `src/assets/`, static files in `public/`, output in `dist/`.

Use functional React components/TypeScript, two spaces, double quotes and
semicolons; preserve surrounding configuration conventions. Components/types
use PascalCase, variables/functions camelCase, hooks `use` prefix. Browser
subscriptions belong in effects with matching cleanup. Keep changes small and
explainable; ESLint is configured, no dedicated formatter is configured.

## Offline and replay invariants

- Offline inspection CRUD persists in IndexedDB. Local mutations and immutable
  queued payload snapshots commit atomically. Never overwrite local inspections
  from API responses or incidentally change IndexedDB schema.
- v2 records a durable next-sequence counter. New entries replay by sequence;
  unchanged v1 entries replay first by createdAt then ID. Historical insertion
  order cannot be recovered. Queue operations are not compacted.
- `fieldops-inspection-sync` is an exclusive same-origin Web Lock spanning load,
  send, acknowledgment validation and committed removal, including Discard.
  BroadcastChannel is notification only; recipients reread IndexedDB.
- Delivery is ordered, at least once. CREATE sends the local UUID; normalized
  matching replay returns 200, conflicting content 409. Repeated DELETE succeeds
  only with 204 or verified JSON `INSPECTION_NOT_FOUND`; missing PATCH blocks.
  Remove an item only after validating acknowledgment and committing removal.
- Startup online, reconnect, online local mutations and Retry trigger sync.
  Timeout is 8 seconds; network/timeout/5xx get two retries at 500ms/1000ms.
  Retained failure stops FIFO; malformed legacy entries stay visibly blocked.
  UI shows pending/progress/safe errors. Confirmed Discard removes only the
  blocked queue item, not local data; discarding CREATE can block later changes.
- Web Locks unavailable disables sync while offline CRUD continues. Close older
  tabs for blocked upgrades. Titles trim to 1–200 Unicode characters, no null.
- One logical writer per inspection is assumed. No server fencing of stale
  requests surviving context termination, exactly-once guarantee, initial server
  download or multi-device conflict resolution is implemented.

## Pages, PWA and API boundaries

Retain Vite base, manifest/start URL, worker scope and navigation fallback under
`/fieldops-offline/`. The worker precaches the shell/assets after an initial online
visit; it cannot make an uncached first visit work offline. Updated workers wait
for existing tabs to close rather than forcibly reload forms. Preserve cache
cleanup and offline data; installation requires a supported browser/secure context.

GitHub Pages deploys only the PWA, not Express/PostgreSQL. Development `/api`
uses the Vite proxy to the loopback API. Production without valid build-time
`VITE_API_BASE_URL` retains pending operations locally and makes no sync requests.
The optional public HTTP(S) base excludes `/api`, credentials, query and fragment;
trailing slashes normalize. It is public configuration, never a secret. A valid URL supplies no hosting/CORS/reachability guarantee. Production owner synchronization requires a configured HTTPS base and runtime token entered in the PWA. The token lives only in tab memory, clears on disconnect/reload, and never enters IndexedDB, queue payloads, browser durable storage or build assets. Connect resumes FIFO; Disconnect aborts active work without dropping queued items; auth failures do not enable Discard. Each tab connects separately.
Read [CONVENTIONS.md](../../CONVENTIONS.md) for deployment decisions and live checks.
