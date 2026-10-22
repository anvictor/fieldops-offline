# TASK-020 — Keep local inspection views consistent across tabs

## Original reports and goal

Deleting in tab A leaves the inspection visible in B until reload. If B is editing its title when A deletes it, Save produces a generic retry error. Correct same-origin local view updates and the edit/delete race, preserving drafts and atomic queue persistence. The user authorized continuing after diagnosis.

## Constraints and scope

No backend/API, schema, sync delivery/FIFO, PWA lifecycle, title marker or deployment-configuration changes. Preserve immutable queued snapshots, per-tab token handling, offline CRUD and unsaved forms. PR44 (test 2) remains open and must not be merged/deployed during this work. No production inspection mutations for tests.

May change focused inspection notifications, IndexedDB update helper, inspection editing helper, App/card or inspection subscription hook, existing/focused tests/browser smoke, README and this task/registry. Do not change historical task entries or dependencies. Browser test may be added to the existing preview CI step only to enforce the regression. Deployment of this fix is authorized after all review/CI gates; this is separate from the still-pending test2 experiment.

## Acceptance criteria

1. After committed create/rename/status/delete/import in one tab, other same-origin tabs reread IndexedDB and refresh lists, counts and filters without reload. Notification payloads carry no records; never trust remote supplied state. Notifications occur after commit; subscriptions clean up and stale asynchronous reads cannot overwrite later refreshes. Focus/visible resume rereads as fallback if notification was missed/unavailable.
2. Active edit text and the new-inspection input survive unrelated changes and remote rename/status. Keep stable card identity. A deleted inspection with an open editor stays as an explicitly deleted recovery card, excluded from live inspection counts/filter results; its draft remains selectable/copyable until explicit dismissal. Disable Save/status/delete on that card; show a clear deletion message and a Dismiss draft action. The update blocker remains active until dismissal. Non-editing deleted cards disappear.
3. Check record existence inside the same readwrite transaction that updates the inspection and queue. Rename and status changes never resurrect a deleted record, including a delayed/missing notification. Missing-record errors are domain-specific and rendered as deletion, with no queue/metadata write. Rename preserves the current stored status. Status toggling preserves the current title. If another tab changed the title since editing began, preserve the local draft but reject its stale save with an explicit conflict message; user can cancel/reopen the editor to use the latest title. No automatic recreation or multi-device conflict protocol.
4. Atomic update/queue rollback, normalized rename no-op, immutable snapshots and ordering remain intact. General persistence failures retain draft and retry behavior; notifications must not make a committed write appear failed.
5. Deterministic tests prove missing-record/late-delete and title conflict cause zero queue writes, concurrent field changes preserve current data, no-op/rollback and notifications. Real isolated two-tab browser regression proves automatic CRUD refresh, draft retention on remote change/delete, safe missing-save behavior with notifications suppressed, no resurrection/queue write, dismissal and offline persistence. Demonstrate failures on old code before fixing.
6. Local lint/type/build/tests, existing PWA regression and new browser regression pass; full configured CI (including backend gates) and independent exact-head approval precede merge. Record hosted verification and limits after deployment. Registry done reconciliation is separate after completion evidence; do not claim manual user test2 verification.

## Assumptions and unresolved questions

Same origin/profile shares IndexedDB; different devices remain out of scope. Retaining a visibly deleted editor is the chosen recovery UX. No critical requirements remain ambiguous; reviewer checks snapshot races, edit lifetime and transaction serialization before implementation approval.
