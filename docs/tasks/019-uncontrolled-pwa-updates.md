# TASK-019 — Detect updates in an uncontrolled first-visit tab

## Original requirement and observed defect

The user requested a PWA update checker/banner and a real title-only deployment to verify it. In their still-open production tab the update-enabled bundle was loaded but `navigator.serviceWorker.controller` returned null and no banner appeared. The existing implementation gates installed/waiting update detection on a controller, missing later worker replacements in an initially uncontrolled page. The authorized scope is correcting this update mechanism, preserving drafts and all TASK-018 safety guarantees.

## Acceptance criteria

1. Distinguish a first worker installation from a subsequent worker version using registration/worker lifecycle, not solely the current page's controller. First installation has no update banner or reload. A subsequent installed or waiting version shows the banner even if controller remains null.
2. Support workers that automatically activate because the initially uncontrolled page does not keep the previous worker in use. Activation without consent never reloads; a banner remains available for an explicit safe reload.
3. If Update now is selected during installation/activation, wait for the target worker to activate before reload. A controllerchange event is not required for an uncontrolled tab; worker state events can confirm activation. Preserve timeout/error recovery and safety recheck immediately before reload.
4. Preserve Later/reopen, dirty/busy guards, token handling, IndexedDB/queue, exactly one registration, throttled visible-online polling and trigger cleanup. Other tabs do not auto-reload. No server, schema, delivery algorithm, or intentional title-marker change.
5. Add regressions that fail on the old code for no-controller first installation followed by replacement, already waiting worker without controller, activation without controllerchange, blocked/deferred reload and no-consent activation. Keep controlled-tab tests passing.
6. Extend the actual two-production-version browser test with a fresh context that stays on its first uncontrolled page (no bootstrap reload), installing its initial worker, typing a draft, checking the new version through the app timer, showing the banner while preserving the draft, and consented safe loading of the next shell. Install any fake browser clock before the application starts, rather than patching clocks after timers exist. Keep the controlled/multi-tab/browser safety scenario.
7. All configured gates and exact-head independent approval precede merge. Verify current deployed version after rollout. Existing open buggy tabs cannot receive new JS without a safe user-chosen navigation/reload; document recovery requiring saving or copying drafts before reload, never remotely force reload.

## Scope

May change src/pwaUpdates.ts, focused lifecycle tests, scripts/pwa-update-smoke.mjs, concise README/frontend context and task spec/registry. Existing banner/safety integration only if strictly required and explained. Protect backend, db.ts, sync.ts, schema, credentials, previous task entries and unrelated work. No new dependency or production-data testing.

## Assumptions and questions

This is a correction to previously requested functionality, not a new product feature. UI stays English and title remains the user-requested temporary test marker until separately removed. No critical user requirement is ambiguous; reviewer must assess worker identity, state races, first installation, generation cleanup and native-browser realism before implementation approval.
