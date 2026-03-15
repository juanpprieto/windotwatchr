# Vite + React Example

Detects four third-party SDKs on `window` without polling, using windotwatchr inside a client-side React SPA built with Vite.

## Quick Start

```bash
# from the repo root
pnpm install
pnpm build          # build the library first
cd examples/vite-react
npm run dev          # http://localhost:5173
```

## Pages

| Route | What it shows |
|-------|---------------|
| `#/` | Navigation hub |
| `#/payments` | Side-by-side: setTimeout polling vs. a single `useWatchWindot` call detecting `acmePayments.ui.components` (3 levels deep) |
| `#/dashboard` | Four SDK cards, each a different loading pattern — sync global, property mutation, deep nesting, incremental namespace — all handled by one hook |

## Files to Read

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
