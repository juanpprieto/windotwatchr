# Next.js Example

Detects four third-party SDKs on `window` without polling, using windotwatchr inside a Next.js App Router project with server-side rendering.

## Quick Start

```bash
# from the repo root
pnpm install
pnpm build          # build the library first
cd examples/nextjs
npm run dev          # http://localhost:3000/windotwatchr/nextjs/
```

## Pages

Routes below are relative to the configured base path, `/windotwatchr/nextjs/`.

| Route | What it shows |
|-------|---------------|
| `/` | Navigation hub |
| `/payments` | Side-by-side: setTimeout polling vs. a single `useWatchWindot` call detecting `acmePayments.ui.components` (3 levels deep) |
| `/dashboard` | Four SDK cards, each a different loading pattern — sync global, property mutation, deep nesting, incremental namespace — all handled by one hook |

## Files to Read

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
