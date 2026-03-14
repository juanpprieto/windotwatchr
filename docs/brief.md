# windotwatchr

Zero-polling, event-driven detection of `window.*` global properties and nested sub-APIs. Know the exact JavaScript tick when `window.Stripe.checkout` is ready — not just when the script finishes loading.

## Problem

When integrating third-party scripts (Stripe, Google Maps, analytics SDKs), developers face a fundamental timing gap: **a script's `load` event fires when the file finishes executing, but many SDKs perform additional async initialization internally.** `window.Stripe` may not exist at `onload` time. `window.Stripe.checkout` may appear seconds later.

Every existing library in the ecosystem solves script _loading_ — detecting when the `<script>` tag fires `onload`. None of them solve the actual problem: knowing when `window.Stripe.checkout` (or any arbitrarily nested property) is defined and ready to use.

The workarounds are bad:
- **Polling loops** (`setInterval` checking `window.Stripe?.checkout`) waste CPU and detect late.
- **Script `onload` callbacks** fire too early — the SDK hasn't finished initializing its sub-APIs.
- **Manual event coordination** (`postMessage`, custom events from SDK) only works when the SDK cooperates.

## What windotwatchr Does

windotwatchr watches dot-notation paths on `window` and resolves the instant the value appears. It uses `Object.defineProperty` to intercept root-level assignments and ES6 `Proxy` to intercept nested property creation — entirely event-driven, zero polling. When an SDK assigns `window.Stripe.checkout = {...}`, your callback fires on that exact tick.

## How It Works

1. **Before the script loads**, windotwatchr places an `Object.defineProperty` setter trap on `window` for the root key (e.g., `"Stripe"`). A getter returns `undefined`, mimicking an absent property.
2. **When the script assigns** `window.Stripe = {...}`, the setter fires. windotwatchr wraps the incoming object in an ES6 `Proxy` with `set` and `defineProperty` traps, then stores it.
3. **When nested properties appear** (`window.Stripe.checkout = {...}`), the Proxy trap fires and notifies all subscribers watching that path.
4. **If the object is frozen/sealed** (traps can't work), windotwatchr auto-detects this and falls back to lightweight polling with a dev-mode warning.

Proxy nesting is lazy — nested proxies are only created when a subscriber actually watches that depth, not eagerly for the entire tree.

## Core API

### `watchWindot(path, callback, options?)`

Watch a `window` property path. Returns a `dispose` function.

```typescript
import { watchWindot } from 'windotwatchr';

const dispose = watchWindot<StripeCheckout>('Stripe.checkout', (checkout) => {
  // checkout is ready — use it
  checkout.redirectToCheckout({ sessionId: '...' });
});

// Clean up when done
dispose();
```

### `waitForWindot(path, options?)`

Promise-based variant. Resolves when the path is ready.

```typescript
import { waitForWindot } from 'windotwatchr';

const stripe = await waitForWindot<Stripe>('Stripe', {
  timeout: 10_000,
  retries: 3,
});
```

### Options

```typescript
interface WindotWatchrOptions {
  timeout?: number;                        // ms before timeout (no default — consumer sets)
  pollInterval?: number;                   // Fallback poll interval, default: 100ms, 0 to disable
  strategy?: 'proxy' | 'poll' | 'auto';   // Default: 'auto'
  signal?: AbortSignal;                    // Tie watcher lifecycle to AbortController
  retries?: number;                        // Retry count after timeout
  ready?: (value: unknown) => boolean;     // Readiness predicate, default: value != null
}
```

## Framework Integrations

Framework wrappers are thin (~20 lines each) and shipped as subpath exports. They are optional — the core API is framework-agnostic.

### React — `windotwatchr/react`

```typescript
import { useWindotWatchr } from 'windotwatchr/react';

function CheckoutButton() {
  const { value: checkout, status, error } = useWindotWatchr<StripeCheckout>('Stripe.checkout', {
    timeout: 10_000,
  });

  if (status === 'timeout') return <p>Stripe took too long to load.</p>;
  if (status === 'error') return <p>Error: {error?.message}</p>;
  if (!checkout) return <p>Loading...</p>;

  return <button onClick={() => checkout.redirectToCheckout({ sessionId: '...' })}>Pay</button>;
}
```

**Hook**: `useWindotWatchr`

### Vue — `windotwatchr/vue` (planned)

Vue composables are planned for a future release. The core API is framework-agnostic and works in any Vue component via `onMounted`/`onUnmounted`.

## Key Features

- **Zero-polling** — entirely event-driven via `Object.defineProperty` + ES6 `Proxy`. No timers, no RAF loops.
- **Unlimited depth** — watch `window.a.b.c.d.e` with lazy recursive proxy nesting.
- **Configurable timeout + retry** — set a timeout, get a `ww:timeout` CustomEvent, auto-retry at intervals.
- **AbortSignal support** — tie watcher lifecycle to browser-native `AbortController`.
- **CustomEvent lifecycle** — `ww:ready`, `ww:timeout`, `ww:error`, `ww:warning` events on `window`.
- **Debug event stream** — granular CustomEvents for all internal state changes (no console noise).
- **SSR/Worker-safe** — immediate no-op return in non-browser environments, no errors.
- **Singleton per root key** — multiple watchers on `Stripe.a` and `Stripe.b` share one Proxy, fan out notifications.
- **Callback isolation** — one subscriber throwing doesn't break others (`try/catch` per callback).
- **Auto fallback** — frozen/sealed objects detected automatically, falls back to polling with dev warning.

## Browser Support

ES2015+ floor. **Proxy cannot be polyfilled** — this is a hard requirement.

| Browser | Minimum Version |
|---------|----------------|
| Chrome  | 49+            |
| Safari  | 10+            |
| Firefox | 38+            |
| Edge    | 12+            |

**~96% global browser coverage.** No IE support.

## Bundle Size

**Target: <5 KB gzipped** (core + subscription manager + timeout/retry + events).

Framework wrappers add negligible overhead (~20 lines each).

## When Not to Use windotwatchr

If the SDK provides its own ready callback or promise (e.g., `google.maps.importLibrary()`, Stripe's `loadStripe()` wrapper), use that instead. windotwatchr is for SDKs that assign to `window.*` without a reliable ready signal.

## Competitive Landscape

| Package | What It Detects | Nested Property Detection | Maintained |
|---------|----------------|--------------------------|------------|
| **windotwatchr** | **Property readiness** (`window.X.y.z`) | **Yes — unlimited depth, event-driven** | **Active** |
| react-script-hook | Script `onload` | No | Stale (3+ years) |
| react-async-script | Script `onload` (HOC) | No | Stale (5+ years) |
| @uidotdev/usehooks `useScript` | Script load status | No | Slow (~2 years) |
| usehooks-ts `useScript` | Script load status | No | Slow (~1 year) |

**The gap**: Every existing library detects when a `<script>` tag fires `onload`. None detect when `window.Stripe.checkout` is actually ready after the SDK finishes its async initialization. windotwatchr fills this gap.

## SDK Compatibility

Designed and tested against real-world SDKs that demonstrate the full range of global property patterns:

| SDK | Globals | Why It's In the Test Matrix |
|-----|---------|----------------------------|
| **Stripe** | `window.Stripe`, `window.Stripe.elements`, `window.Stripe.checkout` | Nested sub-APIs, async init |
| **Google Maps** | `window.google`, `window.google.maps` | Multi-level nesting, callback-based init |
| **Shopify** | Buy Button / Storefront APIs | Root object replacement patterns |
| **Affirm** | Payment SDK globals | `Object.defineProperty` internal usage |
| **OneTrust** | Consent manager | `Object.freeze`/`Object.seal` patterns |

## Build & Package

- **Build tool**: tsup
- **Module formats**: ESM + CJS
- **TypeScript**: Full type definitions, generic parameters for all public functions
- **Exports**: `.` (core), `./react`, `./vue`
- **Side effects**: None (`sideEffects: false`)
- **License**: MIT
