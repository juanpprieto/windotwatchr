# Vite + React Example

Detects four mock third-party SDKs on `window` with windotwatchr interception and optional snapshot polling inside a client-side React SPA built with Vite.

## Quick Start

```bash
# from the repo root
bun install --frozen-lockfile
bun run build          # build the library first
cd examples/vite-react
bun run dev          # http://localhost:5173/windotwatchr/vite-react/
```

## Pages

Routes below are relative to the configured base path, `/windotwatchr/vite-react/`.

| Route | What it shows |
|-------|---------------|
| `#/` | Navigation hub |
| `#/payments` | Step through script loading, API exposure, initialization, cancellation and replay; then compare working polling/hook integrations |
| `#/dashboard` | Four SDK cards, each a different loading pattern — sync global, property mutation, deep nesting, incremental namespace — all handled by one hook |

## Files to Read

The guided demo is shared with Next.js in [`../shared/ReadinessDemo.tsx`](../shared/ReadinessDemo.tsx). It loads a real local Blob script, then lets you expose and initialize its API manually. Default `auto` with 100ms snapshots checks the API’s internal initialization flag; readiness is defined by a pure predicate, not the script load event.

For manual UAT: load the script and confirm zero callbacks; expose the API and confirm it still waits; initialize and expect one callback plus a $49.99 promo. Replay to reset everything. Repeat with Cancel before initialization: the SDK initializes but callback count stays zero. Navigate away while waiting, return, and verify a fresh run. Check the mobile layout with code expanded.

For production UAT from the root, run `bun run build:examples`, then `bun scripts/serve-examples.ts`; open `http://127.0.0.1:4173/windotwatchr/vite-react/`. Automated tests start their own server. If the manual server is running, use `WINDOT_EXAMPLE_PORT=4174 bun run test:e2e -- --workers=2 --reporter=line`.

| File | Why |
|------|-----|
| [`src/pages/Payments.tsx`](src/pages/Payments.tsx) | Before/after comparison. The "old way" polls every 100ms; the "new way" is a one-liner hook. Both render a live promo widget when the SDK arrives. |
| [`src/pages/Dashboard.tsx`](src/pages/Dashboard.tsx) | `SDKCard` component — demonstrates `useWatchWindot` returning `{ value, status, error }` for each path. |
| [`src/App.tsx`](src/App.tsx) | Hash-based router. Shows how windotwatchr cleans up watchers on route changes without leaking subscriptions. |
| [`public/scripts/`](public/scripts/) | Mock SDKs that simulate real loading patterns (delayed init, namespace building, property mutation). Each file documents the pattern it mimics. |

## How the Mock SDKs Work

The four scripts in `public/scripts/` simulate real third-party SDK behaviors:

- **acme-analytics.js** — Assigns `window.acmeDataLayer` synchronously. Detected immediately.
- **acme-pixel.js** — Creates a stub object, then flips `loaded` from `false` to `true` after 500ms. Requires a custom `ready` predicate.
- **acme-payments.js** — Stub exists at load time, but `ui.components` appears ~800ms later via incremental assignment.
- **acme-maps.js** — Builds `window.acme.maps.Map` across three `setTimeout` stages at different delays.

## Differences from Next.js Example

This example runs entirely client-side. There is no SSR, no server components, and no `next/script`. Script injection uses a `useScript` hook that appends `<script>` tags to the document head. The hash-based router triggers E2E tests for cleanup behavior on navigation.
