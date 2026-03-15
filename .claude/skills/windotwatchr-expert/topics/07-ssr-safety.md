# SSR Safety

## Browser Detection

```ts
const isBrowser = typeof window !== 'undefined';
```

Evaluated once at module load. No `window` reference at import time — safe for:
- Node.js
- Cloudflare Workers
- Vercel Edge Runtime
- Deno Deploy
- Any non-browser JavaScript runtime

## API Behavior in SSR

### `watchWindot` → No-op dispose

```ts
export function watchWindot<T>(path, callback, options?): DisposeFunction {
  if (!isBrowser) return noop; // () => {}
  return watch(path, callback, options);
}
```

- Returns `() => {}` immediately
- Callback is **never invoked**
- No side effects

### `waitForWindot` → Rejects immediately

```ts
export function waitForWindot<T>(path, options?): Promise<T> {
  if (!isBrowser) {
    return Promise.reject(new Error('windotwatchr: window is not available'));
  }
  // ...
}
```

- Rejects with descriptive error
- **Does NOT hang** — critical for SSR where there's no timeout default
- Without this guard, `await waitForWindot('Stripe')` would hang forever in SSR

### `useWatchWindot` → Watching state, no effect

- Renders with `{ value: null, status: 'watching', error: null }`
- `useEffect` does not run on the server
- Safe for server-side rendering

### `dispatchWatcherEvent` → No-op

```ts
export function dispatchWatcherEvent(name, detail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
```

## Next.js Patterns

### App Router (Server Components)

```tsx
// app/payments/page.tsx — Server Component
// Cannot use hooks directly. Render a Client Component:

import PaymentLoader from './PaymentLoader';

export default function PaymentsPage() {
  return <PaymentLoader />;
}
```

```tsx
// app/payments/PaymentLoader.tsx
'use client';

import { useWatchWindot } from 'windotwatchr/react';

export default function PaymentLoader() {
  const { value, status } = useWatchWindot('Stripe');
  // ...
}
```

### Pages Router (getServerSideProps)

```tsx
// pages/payments.tsx
import { useWatchWindot } from 'windotwatchr/react';

export default function PaymentsPage() {
  // Safe — hook no-ops during SSR, runs on client after hydration
  const { value: stripe, status } = useWatchWindot<Stripe>('Stripe');

  if (!stripe) return <div>Loading...</div>;
  return <StripeForm stripe={stripe} />;
}
```

### Imperative in useEffect

```tsx
'use client';
import { useEffect, useState } from 'react';
import { waitForWindot } from 'windotwatchr';

export function MapComponent() {
  const [map, setMap] = useState(null);

  useEffect(() => {
    // Safe — useEffect only runs in browser
    waitForWindot('google.maps', { timeout: 5_000 })
      .then((maps) => {
        setMap(new maps.Map(document.getElementById('map'), { center, zoom: 12 }));
      })
      .catch(console.error);
  }, []);

  return <div id="map" />;
}
```

## Hydration Considerations

The hook always starts with `status: 'watching'` on both server and client. If you render different UI based on status:

```tsx
// SAFE — same initial state server and client:
if (status === 'watching') return <Skeleton />;
if (status === 'ready') return <Content value={value} />;
```

```tsx
// RISKY — checking typeof window causes hydration mismatch:
if (typeof window !== 'undefined' && status === 'ready') {
  // Server: false, Client: potentially true → mismatch
}
```

## Edge Runtime Compatibility

windotwatchr works in edge runtimes that have `window` (browser-like). In server-side edge runtimes (Cloudflare Workers, Vercel Edge) where there is no `window`:

- `watchWindot` → no-op
- `waitForWindot` → rejects
- No runtime errors
- No dangling promises

## Testing SSR Behavior

The library has dedicated SSR tests in `src/index.ssr.test.ts`:

```ts
// Runs in jsdom with window deleted
describe('SSR (no window)', () => {
  it('watchWindot returns no-op dispose', () => {
    const dispose = watchWindot('test', vi.fn());
    expect(dispose).toBeTypeOf('function');
    dispose(); // no throw
  });

  it('waitForWindot rejects immediately', async () => {
    await expect(waitForWindot('test')).rejects.toThrow(
      'windotwatchr: window is not available'
    );
  });
});
```
