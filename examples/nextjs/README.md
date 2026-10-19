# Next.js Example

Detects four mock third-party SDKs on `window` with windotwatchr interception and optional snapshot polling. Next.js renders the App Router pages to HTML at build time, then React hydrates them in the browser. The deployed static export does not run per-request SSR.

## Quick Start

```bash
# from the repo root
mise install
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
| `/payments` | Side-by-side: setTimeout polling vs. a single `useWatchWindot` call detecting `acmePayments.ui.components` (3 levels deep) |
| `/dashboard` | Four SDK cards, each a different loading pattern — sync global, property mutation, deep nesting, incremental namespace — all handled by one hook |

## Files to Read

| File | Why |
|------|-----|
| [`app/payments/page.tsx`](app/payments/page.tsx) | Compares a handwritten 100ms polling loop with `useWatchWindot`. Both render a promo widget; the hook owns its detection and cleanup. |
| [`app/dashboard/page.tsx`](app/dashboard/page.tsx) | `SDKCard` component — demonstrates `useWatchWindot` returning `{ value, status, error }` for each path. |
| [`public/scripts/`](public/scripts/) | Mock SDKs that simulate real loading patterns (delayed init, namespace building, property mutation). Each file documents the pattern it mimics. |

## Static Export

`next.config.ts` sets `output: 'export'`, `basePath`, and `trailingSlash` for GitHub Pages deployment. Server and Client Components are prerendered during the build; browser effects run after hydration. These demos require no request-time rendering, ISR or API routes. See the [Next.js static export guide](https://nextjs.org/docs/app/guides/static-exports).

## How the Mock SDKs Work

The four scripts in `public/scripts/` simulate real third-party SDK behaviors:

- **acme-analytics.js** — Assigns `window.acmeDataLayer` synchronously. Callback delivery is deferred to a microtask.
- **acme-pixel.js** — Creates a stub object, then flips `loaded` from `false` to `true` after 500ms. Requires a custom `ready` predicate.
- **acme-payments.js** — Stub exists at load time, but `ui.components` appears ~800ms later via incremental assignment.
- **acme-maps.js** — Creates `window.acme` immediately, then adds `maps` at 600ms and `Map` at 1200ms using two timers. Watch the constructor, since the namespace appears first.
