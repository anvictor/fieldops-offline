# FieldOps Offline

An offline-first React/TypeScript inspection PWA. Inspections and queued mutations live in IndexedDB; a separate Express/PostgreSQL API supports local-development synchronization. GitHub Pages hosts only the PWA, not a public backend.

## Local development

Use Node.js 20.19+ and install both lockfiles:

```sh
npm ci
npm --prefix server ci
```

Follow [server setup](server/README.md) to start PostgreSQL and run migrations. Preserve an existing `server/.env`; create it from the example only if absent. Never commit real credentials.

```sh
npm run server:dev  # API at 127.0.0.1:3001
npm run dev        # open the printed /fieldops-offline/ URL
```

Vite proxies relative `/api` requests to `http://127.0.0.1:3001`. The API and PWA remain separate applications. Do not expose this unauthenticated development API publicly. A separately configured production API foundation supports a private owner token and explicit CORS; see [production setup](server/README.md#production-api-foundation). It is not an already hosted backend or multi-user login.

## How synchronization works

Local CREATE/UPDATE/DELETE and the queued payload snapshot commit in one IndexedDB transaction. Database v2 adds one metadata store containing a durable next-sequence counter. New operations replay by sequence; timestamps do not order them. Existing v1 entries stay unchanged and replay first by createdAt then ID. Historical insertion order cannot be reconstructed. No operations are compacted.

An exclusive same-origin Web Lock named `fieldops-inspection-sync` covers loading, sending, validating acknowledgment and committing removal. Overlapping triggers/tabs cannot process concurrently. BroadcastChannel only notifies queue changes; each receiver rereads IndexedDB instead of trusting a message count. All queue removals, including Discard, use the same lock. API responses never overwrite local inspection state.

Delivery is ordered and **at least once**, not exactly once. CREATE carries the local UUID; matching normalized server content returns 200 on replay, different content returns 409. DELETE can confirm an already missing inspection only through the API's JSON `INSPECTION_NOT_FOUND` response. PATCH missing is blocked. Server-side fencing is not implemented: Web Locks cannot fence a stale request that survives browser-context termination. Assume one logical writer per inspection; no multi-device conflict resolution or initial server download exists.

Synchronization attempts occur on online startup, reconnect, online local mutation, and Retry. Requests time out after 8 seconds; network/timeout/5xx errors receive two retries after 500ms and 1000ms. A retained failure stops FIFO. Invalid legacy items remain visible as a blocked operation. Pending count, progress and safe errors appear in the UI. Discard requires confirmation, affects only the blocked queue item and leaves local data unchanged; discarding CREATE can leave later UPDATE/DELETE operations blocked.

If Web Locks is unavailable, synchronization stays disabled and offline CRUD continues. Close old app tabs if a database upgrade is blocked. New titles are trimmed and limited to 1–200 Unicode characters without null characters.

## Search inspections

Type in **Search inspections** to find titles by case-insensitive substring,
combined with the selected All/Draft/Completed status. Query edges are trimmed;
blank search matches all titles. Punctuation is literal and accents/diacritics are
not removed. **Clear search** resets the query while keeping the status filter.
The query lasts only for the open page; it is not saved after reload. Search works
offline and changes only the visible list, preserving order and overall counts.
Export always includes all persisted inspections, even when search hides them.

## Edit inspection titles

Select **Edit title** on an inspection, change the name and select **Save title**
(or press Enter). **Cancel** leaves the record unchanged. Names are trimmed and
must contain 1–200 Unicode characters with no null character; saving the same
normalized name creates no pending operation. Editing works offline, preserves
identity and status, and persists before updating the displayed title. If saving
fails, the editor keeps your input for retry. Changed names use the existing
ordered synchronization queue and its one-logical-writer limitations described above.

## Export inspections

Select **Export inspections** to download a JSON copy of all inspections currently
stored in this browser, including draft and completed records regardless of the
selected filter. Export works offline and reads persisted data again on each click.
It leaves inspections and pending synchronization operations unchanged.

The versioned file contains inspection IDs, titles and statuses plus its export time.
It excludes the synchronization queue and is not a full database backup. The file is plaintext and may contain private inspection
titles; store and share it with care. The app requests a download; your browser may
prompt, block or cancel saving. Check the browser downloads to confirm the file.

## Import inspections

Choose a JSON file using **Import inspections**. The preview shows total/new/skipped
counts and up to five titles/statuses; nothing is saved until you select
**Import new inspections**. **Cancel import** leaves local data unchanged.

Only FieldOps version 1 exports are accepted, up to 2 MiB and 1000 inspections.
Invalid metadata/records or repeated IDs within a file reject the whole file.
Titles are trimmed using the normal title limits; UUIDs normalize to lowercase.
Existing IDs and IDs with pending synchronization operations (including deletion)
are skipped, never overwritten. Counts are checked again atomically when saving
so another tab cannot cause duplicate imports. All new records and their ordered
CREATE queue entries commit together; storage failure adds nothing and permits retry.

Import works offline and preserves new inspection identity/status. Re-importing
adds no duplicates. This restores inspections, not historical queue/server state;
it does not resolve remote ID conflicts. Existing replay, one-writer and public API
configuration limits above still apply. The file itself is read locally, not uploaded;
new records enter the normal synchronization queue and may replay to a configured API.

## Production configuration

Without configuration, production builds (including GitHub Pages) keep pending operations locally and make no sync requests. Optionally provide `VITE_API_BASE_URL` at build time, e.g. `https://api.example.com` or `https://api.example.com/base`, **without `/api`**. HTTP(S) only; credentials, queries, fragments and invalid URLs are rejected. Trailing slashes are normalized, then sync appends `/api/inspections`. Development always uses the relative proxy.

The variable is public build configuration, not a secret. A valid URL does not establish backend reachability, CORS permission, HTTPS compatibility, authentication or hosting. This task does not configure public backend hosting or CORS. The PWA caching strategy and Pages deployment are unchanged.

## Validation

```sh
npm run lint
npm run build
npm run server:build
npm test
npm run server:test  # requires disposable PostgreSQL TEST_DATABASE_URL
```

Vitest runs export snapshot/download tests in `tests/export.test.ts` and deterministic synchronization tests in `tests/sync.test.ts` with fake IndexedDB, simulated HTTP, clocks and a shared Web Lock model. Real-browser end-to-end verification complements these tests. The Node backend integration suite uses real PostgreSQL and isolated schemas. PR CI's existing `validate` job runs both suites plus lint/builds and a PostgreSQL 17 service. No coverage threshold is configured. Agent contributors start at [AGENTS.md](AGENTS.md); task identity and lifecycle are documented in [task registry conventions](docs/tasks/README.md).


## Automated production PWA checks

After each Pages deployment, GitHub Actions opens the **actual public site** in
an isolated Chromium browser. It requires an uncached `build-info.json` matching
the full deployed commit SHA before checking create/status/edit/reload, read-only
search/export, cached offline CRUD/export and safe JSON import. The generated marker is written
into `dist/` after the build and stays outside the PWA precache.

PR CI runs the same checks against its fresh loopback production build. To run locally:

```sh
npx playwright install chromium
npm run build
node scripts/write-build-info.mjs "$(git rev-parse HEAD)"
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
# In another terminal, from this repository:
SMOKE_SITE_URL=http://127.0.0.1:4173/fieldops-offline/ SMOKE_EXPECTED_SHA="$(git rev-parse HEAD)" npm run test:live
```

For the deployed version, use the exact deployed SHA with
`SMOKE_SITE_URL=https://anvictor.github.io/fieldops-offline/`. The development-only
Playwright version is pinned; an explicit `SMOKE_BROWSER_EXECUTABLE` can select
system Chromium for local validation. Loopback results do not prove hosted success.
Both workflows retain synthetic screenshots and a compact `smoke-results/report.json`
for seven days. Generated reports remain untracked.

Fresh browser storage and pre-startup fetch/network guards prevent backend writes,
including service-worker requests. A disposable loopback proof checks these guards
before visiting the target. Only static same-origin GET requests within the PWA
scope are allowed. No user cookies, owner tokens or real database are involved;
API synchronization and the browser's online indicator are outside these checks.
A failed uncached fetch proves offline transport while cached navigation proves
the shell. Completion requires the **entire** deployment workflow, including smoke,
to succeed. These are direct automated hosted live checks for covered scenarios;
future behavior changes still require relevant tests and all review/merge gates.
