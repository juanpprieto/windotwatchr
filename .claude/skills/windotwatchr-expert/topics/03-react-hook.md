# React Hook — useWindotWatchr

## Signature

```ts
function useWindotWatchr<T = unknown>(
  path: string,
  options?: WindotWatchrOptions,
): WindotWatchrResult<T>;
```

## Return Type

```ts
interface WindotWatchrResult<T> {
  value: T | null;      // Resolved value, or null if not yet available
  status: WatcherState; // 'watching' | 'ready' | 'timeout' | 'error'
  error: Error | null;  // Error object if status === 'error', otherwise null
}
```

## Status Lifecycle

```
Mount → { value: null, status: 'watching', error: null }
         ↓
    ww:ready event  → { value: <resolved>, status: 'ready', error: null }
    ww:timeout event → { value: null, status: 'timeout', error: null }
    ww:error event   → { value: null, status: 'error', error: <Error> }
```

## Basic Usage

```tsx
import { useWindotWatchr } from 'windotwatchr/react';

function StripeButton() {
  const { value: stripe, status, error } = useWindotWatchr<Stripe>('Stripe', {
    timeout: 10_000,
  });

  if (status === 'error') return <div>Error: {error?.message}</div>;
  if (status === 'timeout') return <div>Stripe is taking too long...</div>;
  if (!stripe) return <div>Loading Stripe...</div>;

  return (
    <button onClick={() => stripe.redirectToCheckout({ sessionId: '...' })}>
      Pay
    </button>
  );
}
```

## How It Works Internally

1. **`useState`** tracks `value`, `status`, and `error`
2. **`useEffect`** (dependency: `[path]`) sets up:
   - `watchWindot()` call — callback updates `value` via `setValue`
   - `ww:ready` listener → sets `status: 'ready'`
   - `ww:timeout` listener → sets `status: 'timeout'`
   - `ww:error` listener → sets `status: 'error'` + captures error
3. **Cleanup** on unmount or path change:
   - Calls `dispose()` from `watchWindot`
   - Removes all three event listeners

```tsx
// Simplified internals:
useEffect(() => {
  setValue(null);
  setStatus('watching');
  setError(null);

  // Event listeners filter by path match
  window.addEventListener('ww:ready', onReady);
  window.addEventListener('ww:timeout', onTimeout);
  window.addEventListener('ww:error', onError);

  const dispose = watchWindot<T>(path, (val) => {
    setValue(() => val);
  }, optionsRef.current);

  return () => {
    dispose();
    window.removeEventListener('ww:ready', onReady);
    window.removeEventListener('ww:timeout', onTimeout);
    window.removeEventListener('ww:error', onError);
  };
}, [path]); // Only path triggers re-run
```

## Key Behaviors

### Options via Ref

Options are stored in a `useRef` and read at notification time — NOT at hook initialization. This means changing options does NOT re-run the effect.

```tsx
const optionsRef = useRef(options);
optionsRef.current = options;

// In effect:
const dispose = watchWindot<T>(path, cb, optionsRef.current);
```

### Path Change Resets State

When `path` changes, the hook resets to initial state and creates a new watcher:

```tsx
// Switching from Stripe to Maps:
const [sdkPath, setSdkPath] = useState('Stripe');
const { value, status } = useWindotWatchr(sdkPath);
// When setSdkPath('google.maps') → status resets to 'watching'
```

### StrictMode Safety

React StrictMode double-mounts components. The core engine's singleton registry handles this correctly through ref-counting — the first unmount decrements the subscriber count, the second mount increments it. No duplicate watchers or missed notifications.

### SSR Safety

In SSR (no `window`), `watchWindot` returns a no-op dispose. The hook renders with `{ value: null, status: 'watching', error: null }` — the effect never runs on the server.

**Hydration note**: If you conditionally render based on `status`, the server will always render the `'watching'` state. Use `useEffect` gates for SSR-sensitive rendering.

## Patterns

### Multiple SDKs

```tsx
function Dashboard() {
  const stripe = useWindotWatchr<Stripe>('Stripe');
  const maps = useWindotWatchr<GoogleMaps>('google.maps');
  const analytics = useWindotWatchr('dataLayer');

  return (
    <div>
      <SDKStatus name="Stripe" {...stripe} />
      <SDKStatus name="Maps" {...maps} />
      <SDKStatus name="Analytics" {...analytics} />
    </div>
  );
}
```

### Conditional Rendering by Status

```tsx
function SDKLoader({ path, children }: { path: string; children: (value: any) => ReactNode }) {
  const { value, status, error } = useWindotWatchr(path);

  switch (status) {
    case 'watching': return <Skeleton />;
    case 'timeout': return <RetryBanner />;
    case 'error': return <ErrorBanner error={error} />;
    case 'ready': return <>{children(value)}</>;
    default: return null;
  }
}
```

### Deep Nested Path

```tsx
// Watches acmePayments.ui.components — deep sub-API
const { value: components, status } = useWindotWatchr<AcmeComponents>(
  'acmePayments.ui.components',
);

useEffect(() => {
  if (!components) return;
  const promo = components.create('promo', { amount: 1999 });
  promo.render('#container');
  return () => promo.destroy();
}, [components]);
```

### Custom Readiness Predicate

```tsx
// SDK creates a stub immediately, but `loaded` flips to true later
const { value, status } = useWindotWatchr('acmePx', {
  ready: (v) => typeof v === 'object' && v !== null && (v as any).loaded === true,
});
```

## Peer Dependency

React is an **optional** peer dependency (`>=16.8.0`). Projects not using React don't need it installed — the `windotwatchr/react` entry point is a separate export.
