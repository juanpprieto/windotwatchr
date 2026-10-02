# Next.js Example

Detects four mock third-party SDKs on `window` with windotwatchr interception and optional snapshot polling inside a Next.js App Router project with server-side rendering.

## Quick Start

```bash
# from the repo root
bun install --frozen-lockfile
bun run build          # build the library first
cd examples/nextjs
bun run dev          # http://localhost:3000/windotwatchr/nextjs/
```

## Pages

Routes below are relative to the configured base path, `/windotwatchr/nextjs/`.

| Route | What it shows |
|-------|---------------|
| `/` | Navigation hub |
| `/payments` | Step through script loading, API exposure, initialization, cancellation and replay; then compare working polling/hook integrations |
| `/dashboard` | Four SDK cards, each a different loading pattern — sync global, property mutation, deep nesting, incremental namespace — all handled by one hook |

## Files to Read

The guided demo is shared with Vite in [`../shared/ReadinessDemo.tsx`](../shared/ReadinessDemo.tsx). Its watcher registers after hydration, without reading `window` during rendering. A real local Blob script loads first; API exposure and initialization are separate actions. Default `auto` with 100ms snapshots rechecks the internal flag through a pure readiness predicate.

For manual UAT: load the script and confirm zero callbacks; expose the API and confirm it still waits; initialize and expect one callback plus a $49.99 promo. Replay to reset everything. Repeat with Cancel before initialization: the SDK initializes but callback count stays zero. Navigate away while waiting, return, and verify a fresh run. Check the mobile layout with code expanded.

For production UAT from the root, run `bun run build:examples`, then `bun scripts/serve-examples.ts`; open `http://127.0.0.1:4173/windotwatchr/nextjs/`. Automated tests start their own server. If the manual server is running, use `WINDOT_EXAMPLE_PORT=4174 bun run test:e2e -- --workers=2 --reporter=line`.

| File | Why |
|------|-----|
| [`app/payments/page.tsx`](app/payments/page.tsx) | Before/after comparison. The "old way" polls every 100ms; the "new way" is a one-liner hook. Both render a live promo widget when the SDK arrives. |
| [`app/dashboard/page.tsx`](app/dashboard/page.tsx) | `SDKCard` component — demonstrates `useWatchWindot` returning `{ value, status, error }` for each path. |
| [`public/scripts/`](public/scripts/) | Mock SDKs that simulate real loading patterns (delayed init, namespace building, property mutation). Each file documents the pattern it mimics. |

## Static Export

`next.config.ts` sets `output: 'export'`, `basePath`, and `trailingSlash` for GitHub Pages deployment. These demos use no server features (no SSR/ISR/API routes), so static export works without any functionality loss.

## How the Mock SDKs Work

The four scripts in `public/scripts/` simulate real third-party SDK behaviors:

- **acme-analytics.js** — Assigns `window.acmeDataLayer` synchronously. Detected immediately.
- **acme-pixel.js** — Creates a stub object, then flips `loaded` from `false` to `true` after 500ms. Requires a custom `ready` predicate.
- **acme-payments.js** — Stub exists at load time, but `ui.components` appears ~800ms later via incremental assignment.
- **acme-maps.js** — Builds `window.acme.maps.Map` across three `setTimeout` stages at different delays.
