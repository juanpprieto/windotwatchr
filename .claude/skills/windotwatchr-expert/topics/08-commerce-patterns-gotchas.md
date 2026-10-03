# SDK integration patterns

These examples use fictional SDKs. Load their scripts separately. For a real
integration, use the vendor's documented readiness callback or promise when
available and verify its API types and cleanup methods.

## Payment widget

Wait for the API you will call, check its shape, and return cleanup to the owner
of the widget. The type parameter alone does not validate the runtime value.

```ts
import { waitForWindot } from 'windotwatchr';

interface PaymentComponents {
  create(
    kind: 'promo',
    options: { amount: number; pageType: 'product' },
  ): { render(selector: string): void; destroy(): void };
}

function isPaymentComponents(value: unknown): value is PaymentComponents {
  return typeof value === 'object' && value !== null &&
    'create' in value && typeof value.create === 'function';
}

export async function mountPromo(
  selector: string,
  amount: number,
  signal: AbortSignal,
): Promise<() => void> {
  const components = await waitForWindot<PaymentComponents>(
    'acmePayments.ui.components',
    { timeout: 10_000, signal, ready: isPaymentComponents },
  );
  if (signal.aborted) throw signal.reason;
  const promo = components.create('promo', { amount, pageType: 'product' });
  promo.render(selector);
  return () => promo.destroy();
}
```

Abort the pending wait if the page leaves, handle its rejection, and call the
returned cleanup when the mounted widget is no longer needed.

For React, the hook owns detection while the effect owns the widget:

```tsx
import { useEffect } from 'react';
import { useWatchWindot } from 'windotwatchr/react';

interface PaymentComponents {
  create(
    kind: 'promo',
    options: { amount: number; pageType: 'product' },
  ): { render(selector: string): void; destroy(): void };
}

function isPaymentComponents(value: unknown): value is PaymentComponents {
  return typeof value === 'object' && value !== null &&
    'create' in value && typeof value.create === 'function';
}

export function BNPLPromo({ amount }: { amount: number }) {
  const { value: components, status, error } = useWatchWindot<PaymentComponents>(
    'acmePayments.ui.components',
    { timeout: 10_000, ready: isPaymentComponents },
  );

  useEffect(() => {
    if (!components) return;
    const promo = components.create('promo', { amount, pageType: 'product' });
    promo.render('#bnpl-container');
    return () => promo.destroy();
  }, [components, amount]);

  return (
    <>
      <p>{error?.message ?? status}</p>
      <div id="bnpl-container" />
    </>
  );
}
```

This example assumes one promo container on the page. Multiple widgets need
distinct mount targets.

For Stripe specifically, the global `Stripe` is a factory that needs a
publishable key to create an instance. `redirectToCheckout` is no longer
supported. See [Stripe initialization](https://docs.stripe.com/js/initializing)
and the [Checkout migration](https://docs.stripe.com/changelog/clover/2025-09-30/remove-redirect-to-checkout);
do not treat the fictional widget API above as a Stripe integration.

## Maps constructor readiness

The mock SDK exposes `acme.maps` before `acme.maps.Map`. Watching the namespace
with the default predicate can resolve too early for a constructor call.

```ts
import { waitForWindot } from 'windotwatchr';

interface MapInstance {
  render(): MapInstance;
  destroy(): void;
}

type MapConstructor = new (
  element: HTMLElement,
  options: { center: { lat: number; lng: number }; zoom: number },
) => MapInstance;

export async function mountMap(
  element: HTMLElement,
  signal: AbortSignal,
): Promise<() => void> {
  const Map = await waitForWindot<MapConstructor>('acme.maps.Map', {
    timeout: 5_000,
    signal,
    ready: candidate => typeof candidate === 'function',
  });
  if (signal.aborted) throw signal.reason;
  const map = new Map(element, { center: { lat: 40, lng: -74 }, zoom: 12 });
  map.render();
  return () => map.destroy();
}
```

The function check matches this mock's loading stages. It does not establish
that an arbitrary vendor function is a constructor. For a React effect with
pending-wait cancellation and map cleanup, use the
[SSR-safe map example](./07-ssr-safety.md#a-cancellable-wait-in-an-effect).

## Analytics stubs

An existing object, array or queue function may still be a stub. Require the API
shape you intend to use; an SDK with its own initialization flag may need an
additional check.

```tsx
import { useWatchWindot } from 'windotwatchr/react';

interface Analytics {
  track(event: string): void;
}

function isAnalytics(value: unknown): value is Analytics {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'track' in value && typeof value.track === 'function';
}

export function AnalyticsStatus() {
  const { status, error } = useWatchWindot<Analytics>('analytics', {
    ready: isAnalytics,
    timeout: 5_000,
  });
  return <p>{error?.message ?? status}</p>;
}
```

## Multi-SDK dashboard

Give configurations an explicit shared type so optional predicates are available
when mapping over entries.

```tsx
import { useWatchWindot } from 'windotwatchr/react';

interface SDKConfig {
  name: string;
  path: string;
  ready?: (value: unknown) => boolean;
}

const sdkConfigs: readonly SDKConfig[] = [
  { name: 'Analytics queue', path: 'acmeDataLayer', ready: Array.isArray },
  { name: 'Pixel loaded', path: 'acmePx.loaded', ready: value => value === true },
  {
    name: 'Payments',
    path: 'acmePayments.ui.components.create',
    ready: value => typeof value === 'function',
  },
  { name: 'Maps', path: 'acme.maps.Map', ready: value => typeof value === 'function' },
];

export function Dashboard() {
  return (
    <div>
      {sdkConfigs.map(config => <SDKStatus key={config.path} {...config} />)}
    </div>
  );
}

function SDKStatus({ name, path, ready }: SDKConfig) {
  const { value, status, error } = useWatchWindot<unknown>(path, ready ? { ready } : undefined);
  return (
    <p>
      <strong>{name}</strong>: {error?.message ?? status}
      {value != null && <span> (type: {typeof value})</span>}
    </p>
  );
}
```

The analytics card establishes that a queue exists; it does not prove that
remote analytics initialization or event delivery has completed.

## Script ownership

A script's load event follows loading and script execution, but asynchronous SDK
initialization can continue afterward. Handle script errors in the loader and
API readiness in the watcher. A framework loader or shared loader should own the
script lifetime; the watcher does not load or remove scripts.

## Detection and cleanup choices

- Release persistent watches on navigation or component cleanup. A timeout
  reports missed readiness; it does not dispose a persistent watcher or hook.
- Give waits a timeout or abort signal when readiness may never arrive. Handle
  rejection as `unknown`: abort reasons need not be Errors.
- Destructuring reads the current property through its getter or Proxy. It does
  not inherently strip a proxy, but the captured reference does not track later
  property replacement. Watch the required leaf for readiness changes.
- Reusing an unchanged options object is allowed; the library does not mutate
  it. Do not mutate options after registration to reconfigure an imperative
  watch. Replace that registration explicitly. The hook handles scalar option
  changes and predicate updates as described in the React topic.
- Default `auto` detection uses interception plus 100ms snapshots until disposal.
  Adjust the interval for the detection latency and timer cost your application
  can accept. Raw writes, closure getters, external flags and locked shapes may
  need snapshots even when the SDK is not frozen.
- `proxy` disables detection polling. `poll` preserves raw SDK identity.
  Poll/interception registrations cannot share the same root.
- Callbacks run in a microtask. Use a promise or hook state when you need a value
  after readiness; a variable assigned in the callback is not updated before
  the registration call returns.
- Warning events identify particular interception limitations. Their absence
  does not prove coverage; match the SDK's mutation route to the strategy.

## Diagnostics with cleanup

Install listeners only for the lifetime of the diagnostic view:

```ts
import 'windotwatchr';

export function observeWarnings(): () => void {
  const onWarning = (event: WindowEventMap['ww:warning']) => {
    console.warn('windotwatchr interception:', event.detail);
  };
  window.addEventListener('ww:warning', onWarning);
  return () => window.removeEventListener('ww:warning', onWarning);
}
```

| Symptom | Check |
|---|---|
| Value never resolves | Path, predicate, script errors and whether the strategy observes the SDK's mutation route |
| Callback repeats | Separate intercepted assignments, observed readiness transitions or multiple registrations |
| Timeout while a value exists | Whether that value satisfies the predicate; namespace existence may precede usable methods |
| Resources remain after unmount | Watch disposers, SDK widget cleanup and diagnostic listener removal |
| Hydration mismatch | Server and initial client markup; move browser-dependent rendering behind an effect |
| Hook stays watching | Path spelling, predicate result, detection errors and polling disabled for a raw/closure change |
