# FieldOps v1 — 3–5 minute demonstration

## Before presenting

Open the [Pages demo](https://anvictor.github.io/fieldops-offline/) in a fresh browser
profile, or use [Render](https://fieldops-offline.onrender.com/fieldops-offline/) without
connecting an owner token. Use only synthetic titles such as “Demo pump”. Your main
browser's existing inspections stay untouched. Let the first online visit finish,
then reload once so the service worker controls the page; offline first visits are
not supported. Browser developer tools provide the offline switch for this demo.

No private owner credential is needed or shared. On Pages no production API base is
configured. On Render an API base is configured, but no inspection requests are made
until the owner explicitly connects. Pending operations remain local in both cases
without a token.

## 0:00–0:40 — The problem and product

“Field inspections may happen without a reliable connection. This app saves changes
on the device immediately and queues them for later delivery.” Point out the creation,
inspection list, synchronization and import/export groups. State that this is a
compact single-owner v1, and show the same layout at phone width if useful.

## 0:40–1:40 — An inspection workflow

Create “Demo pump” and “Demo valve”. Complete the pump, edit its title to “Demo checked
pump”, and search for “pump”. Combine search with the Completed filter, then clear
search and return the filter to All. Explain that filtering changes the view rather
than the stored data. The current ID/status survives title edits.

## 1:40–2:40 — Offline and reload

After the online reload, switch the browser's network to Offline. Create “Demo offline
visit”, edit or complete it, and reload. The cached shell and inspections still open;
the pending queue grows. The initial online visit cached the shell, while IndexedDB
stores the inspection and queued mutation atomically.

## 2:40–3:20 — Reconnect, honestly

Switch the network back online. Connection shows Online; the pending count remains
until an owner connects to the configured API. Do not claim that connectivity alone
uploaded these records. Explain: “The owner can connect a runtime credential to
replay this FIFO queue; the credential is held only in this tab and reload clears it.”
For proof of the backend path, show [recorded TASK-016 verification](https://github.com/anvictor/fieldops-offline/pull/36#issuecomment-6127099422),
which directly checked browser → protected API → Neon and removed its synthetic rows.
Label that evidence as a prior verified run, not a new authenticated demonstration.

## 3:20–4:20 — Local backup and boundaries

Export the synthetic inspections. Import the same file: the preview reports existing
IDs as skipped, and does not replace local data. Delete a synthetic card if desired;
it disappears locally and its operation remains queued. Explain that export contains
local inspections, not queue history or a complete server backup.

State the boundaries: one owner principal, no initial server download or multi-device
conflict resolution, at-least-once delivery with idempotent CREATE, cached offline
reopen rather than offline first visit, and possible Free-host cold starts. Never
claim exactly-once delivery or multi-user isolation.

## 4:20–5:00 — Engineering evidence and finish

Point to the automated test and deployment results linked in the relevant PR:
frontend tests, real disposable-PostgreSQL integration tests, guarded production PWA
browser checks and independent exact-head review. Close the fresh demo profile; do
not clear another profile's storage or delete existing server records. Keep only the
synthetic export if you want to show its format.

## Optional protected synchronization proof

The public demo above is complete without a token. For a repeatable private proof,
use the repository's existing local auth-browser fixture against a separate disposable
PostgreSQL database, with a generated fixture credential and virtual HTTPS origins.
See [validation commands](agent-context/validation.md) and the
[deployment evidence guide](render-neon-deployment.md#evidence-and-completion).
That fixture is local evidence. Any new authenticated production run needs secure
runtime credential entry, uniquely identified synthetic records, direct database
confirmation and verified cleanup. Never put a production token into a public demo,
recording, screenshot, trace, build, browser storage or chat.
