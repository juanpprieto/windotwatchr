# Commerce Patterns & Gotchas

## Real-World Use Cases

### Payment SDK (Stripe-like)

Third-party payment scripts typically assign `window.Stripe` or `window.PaymentSDK` after an async script load.

```ts
// Imperative — wait for Stripe with timeout
try {
  const stripe = await waitForWindot<Stripe>('Stripe', {
    timeout: 10_000,
    retries: 3,
  });
  const result = await stripe.redirectToCheckout({ sessionId });
} catch (err) {
  showManualPaymentForm();
}
```

```tsx
// React — BNPL promo component
function BNPLPromo({ amount }: { amount: number }) {
  const { value: components, status } = useWindotWatchr<PaymentComponents>(
    'acmePayments.ui.components', // Deep nested path
  );

  useEffect(() => {
    if (!components) return;
    const promo = components.create('promo', { amount, pageType: 'product' });
    promo.render('#bnpl-container');
    return () => promo.destroy();
  }, [components, amount]);

  return (
    <>
      {status === 'watching' && <Skeleton />}
      <div id="bnpl-container" />
    </>
  );
}
```

### Maps SDK (Google Maps-like)

Maps SDKs expose constructors as nested properties: `window.google.maps.Map`.

```ts
const maps = await waitForWindot<typeof google.maps>('google.maps', {
  timeout: 5_000,
});
const map = new maps.Map(element, { center: { lat: 40, lng: -74 }, zoom: 12 });
```

```tsx
// React pattern
function MapView() {
  const { value: maps, status } = useWindotWatchr<typeof google.maps>('google.maps');
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!maps || !mapRef.current) return;
    new maps.Map(mapRef.current, { center: { lat: 40, lng: -74 }, zoom: 12 });
  }, [maps]);

  if (status === 'watching') return <div>Loading map...</div>;
  return <div ref={mapRef} style={{ height: 400 }} />;
}
```

### Analytics / Tracking Pixel

Analytics SDKs often create a stub (array or function) immediately, then replace it with the full SDK later.

```tsx
// Watch for the real SDK, not the stub
const { value, status } = useWindotWatchr('analytics', {
  ready: (v) =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as any).track === 'function' &&
    !(v instanceof Array), // Exclude the stub array
});
```

### Multi-SDK Dashboard

```tsx
const sdkConfigs = [
  { name: 'Analytics', path: 'dataLayer' },
  { name: 'Pixel', path: 'acmePx.loaded', ready: (v: unknown) => v === true },
  { name: 'Payments', path: 'acmePayments.ui.components' },
  { name: 'Maps', path: 'acme.maps.Map' },
] as const;

function Dashboard() {
  return (
    <div>
      {sdkConfigs.map(({ name, path, ready }) => (
        <SDKStatus key={path} name={name} path={path} ready={ready} />
      ))}
    </div>
  );
}

function SDKStatus({ name, path, ready }: { name: string; path: string; ready?: (v: unknown) => boolean }) {
  const { value, status } = useWindotWatchr(path, { ready });
  return (
    <div>
      <strong>{name}</strong>: {status}
      {value != null && <span> (type: {typeof value})</span>}
    </div>
  );
}
```

### Script Injection Pattern

```tsx
useEffect(() => {
  const src = '/scripts/vendor-sdk.js';
  if (document.querySelector(`script[src="${src}"]`)) return;

  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
}, []);

// Separate hook watches for the global:
const { value: sdk, status } = useWindotWatchr('VendorSDK');
```

---

## DOs and DONTs

### DO

- **Always call `dispose()`** — memory leak if left hanging
  ```ts
  useEffect(() => {
    const dispose = watchWindot('SDK', cb);
    return () => dispose(); // Always clean up
  }, []);
  ```

- **Set `timeout` explicitly** when the SDK might not load
  ```ts
  waitForWindot('Stripe', { timeout: 10_000 });
  // Without timeout, Promise hangs forever if script fails to load
  ```

- **Use generic type parameter** for full TypeScript safety
  ```ts
  const { value } = useWindotWatchr<Stripe>('Stripe');
  // value is Stripe | null, not unknown
  ```

- **Use custom `ready` predicate** when SDK creates stubs
  ```ts
  // SDK sets window.analytics = [] immediately, then replaces with full object
  watchWindot('analytics', cb, {
    ready: (v) => typeof v === 'object' && !(v instanceof Array),
  });
  ```

- **Use AbortController for route-change cleanup**
  ```ts
  const ctrl = new AbortController();
  waitForWindot('SDK', { signal: ctrl.signal });
  // On route change: ctrl.abort();
  ```

- **Listen to `ww:warning` in development** to detect fallback scenarios
  ```ts
  if (process.env.NODE_ENV === 'development') {
    window.addEventListener('ww:warning', (e: CustomEvent) => {
      console.warn('windotwatchr fallback:', e.detail);
    });
  }
  ```

### DON'T

- **Don't destructure the Proxy result** if you need reactive sub-paths
  ```ts
  // BAD — destructuring breaks Proxy interception:
  watchWindot('Stripe', (stripe) => {
    const { checkout } = stripe; // checkout is a plain object, NOT proxied
  });

  // GOOD — watch the specific sub-path:
  watchWindot('Stripe.checkout', (checkout) => {
    // checkout notification comes from Proxy trap
  });
  ```

- **Don't use `waitForWindot` without timeout in browser** if the SDK might fail
  ```ts
  // BAD — hangs forever if script fails:
  const stripe = await waitForWindot('Stripe');

  // GOOD:
  const stripe = await waitForWindot('Stripe', { timeout: 10_000 });
  ```

- **Don't share mutable options objects between watchers**
  ```ts
  // BAD — internal mutation could affect both:
  const opts = { timeout: 5_000 };
  watchWindot('A', cbA, opts);
  watchWindot('B', cbB, opts); // May see mutated state

  // GOOD — spread or create fresh:
  watchWindot('A', cbA, { ...opts });
  watchWindot('B', cbB, { ...opts });
  ```

- **Don't expect synchronous callbacks** — always microtask-deferred
  ```ts
  // BAD — value is NOT available synchronously:
  let result;
  watchWindot('SDK', (v) => { result = v; });
  console.log(result); // undefined! Callback hasn't fired yet

  // GOOD — use Promise or React state:
  const sdk = await waitForWindot('SDK');
  ```

- **Don't poll when you don't need to** — zero-polling is the default
  ```ts
  // Unnecessary — Proxy handles this:
  watchWindot('SDK', cb, { pollInterval: 50 }); // Over-polling

  // Only set pollInterval for known frozen/sealed SDKs:
  watchWindot('FrozenSDK', cb, { pollInterval: 200 });
  ```

- **Don't assume `timeout` has a default** — it doesn't
  ```ts
  // No timeout → no ww:timeout event, no Promise rejection
  watchWindot('SDK', cb); // Watches indefinitely
  waitForWindot('SDK');   // Hangs indefinitely (in browser)
  ```

- **Don't watch inside loops without tracking disposers**
  ```ts
  // BAD — leaked watchers:
  for (const path of paths) {
    watchWindot(path, cb);
  }

  // GOOD:
  const disposers = paths.map((path) => watchWindot(path, cb));
  // Cleanup: disposers.forEach((d) => d());
  ```

## Debugging Checklist

| Symptom | Check |
|---------|-------|
| Value never resolves | Is the script tag actually loading? (Network tab). Does value pass `ready` predicate? Is it frozen? (listen for `ww:warning`) |
| Callback fires twice | Are you passing `receiver` to `Reflect.set`? (contributors only). Is the SDK reassigning the global? (legitimate double fire) |
| Timeout fires but value exists | Does the value pass your `ready` predicate? Test it: `console.log(myPredicate(window.SDK))` |
| Memory leak after unmount | Did you call `dispose()`? Are CustomEvent listeners cleaned up? |
| SSR hydration mismatch | Render same initial state on server and client. Use `useEffect` gates for client-only rendering. |
| Hook status stuck on 'watching' | Is the path correct? (case-sensitive). Is there a typo? Check `window.SDK` in console. |
