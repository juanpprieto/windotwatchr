# Events System

All events are `CustomEvent`s dispatched on `window` via a single SSR-safe function.

## Event Catalog

### `ww:ready`

Fired when a watched path resolves (value passes the readiness predicate).

```ts
// Detail payload:
{ path: string, value: unknown }

// Example:
window.addEventListener('ww:ready', (e: CustomEvent) => {
  const { path, value } = e.detail;
  console.log(`${path} is ready:`, value);
});
```

- Fires BEFORE subscriber callbacks run (same microtask)
- Can fire multiple times if the property is reassigned
- Fired by: `notifySubscribers()` in notification-queue.ts, and directly by `watch()` for late-mount and retry resolution

### `ww:timeout`

Fired when a timeout expires without resolution.

```ts
// Detail payload:
{ path: string, attempts: number, elapsed: number }

// Example:
window.addEventListener('ww:timeout', (e: CustomEvent) => {
  const { path, attempts, elapsed } = e.detail;
  console.warn(`${path} timed out after ${elapsed}ms (attempt ${attempts})`);
});
```

- `attempts`: Zero-indexed retry count
- `elapsed`: The timeout duration (not cumulative time)
- Fires on initial timeout AND before each retry check
- Fired by: `watch()` timeout handler and `waitForWindot()` timeout handler

### `ww:error`

Fired when a subscriber callback throws during notification.

```ts
// Detail payload:
{ path: string, error: Error }

// Example:
window.addEventListener('ww:error', (e: CustomEvent) => {
  const { path, error } = e.detail;
  console.error(`Subscriber error on ${path}:`, error);
});
```

- Error isolation: one subscriber throwing doesn't prevent others from running
- Fired by: `notifySubscribers()` in the try/catch around each callback

### `ww:warning`

Fired when the engine encounters a fallback scenario. Not documented in public README — internal diagnostic.

```ts
// Detail payload:
{ path: string, reason: 'frozen' | 'sealed' | 'defineProperty failed' }

// Example:
window.addEventListener('ww:warning', (e: CustomEvent) => {
  const { path, reason } = e.detail;
  console.warn(`windotwatchr fallback on ${path}: ${reason}`);
});
```

- `'frozen'` — `Object.isFrozen(target)` returned true, Proxy wrapping failed
- `'sealed'` — `Object.isSealed(target)` returned true
- `'defineProperty failed'` — `Object.defineProperty(window, key, ...)` threw (another script locked the property)
- Fired by: `installTrap()` in property-trap.ts

## Dispatch Mechanism

All events flow through one function:

```ts
// src/core/event-dispatcher.ts
export function dispatchWatcherEvent(
  name: string,
  detail: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return; // SSR-safe
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
```

## React Hook Integration

The `useWindotWatchr` hook listens to `ww:ready`, `ww:timeout`, and `ww:error` to drive status transitions. Each listener filters by `detail.path === path` to handle only its own path.

```ts
// Simplified from use-windotwatchr.ts:
const onReady = (e: Event) => {
  const detail = (e as CustomEvent).detail as { path: string };
  if (detail.path === path) setStatus('ready');
};
```

## Event Timing

Events are dispatched on the **same microtask** as subscriber callbacks:

```
schedule(() => {
  dispatchWatcherEvent('ww:ready', { path, value });  // ← event fires first
  for (const callback of snapshot) {
    try { callback(value); }                            // ← then callbacks
    catch (error) { dispatchWatcherEvent('ww:error', { path, error }); }
  }
});
```

## Use Cases for Direct Event Listening

1. **Cross-component coordination** — Components that don't use the hook but need to know when an SDK loaded
2. **Analytics/telemetry** — Track SDK load times via `ww:ready` timestamps
3. **Error monitoring** — Forward `ww:error` events to error tracking services
4. **Debugging** — Listen to `ww:warning` to detect fallback scenarios in development

```ts
// Example: SDK load time tracking
const startTime = performance.now();
window.addEventListener('ww:ready', (e: CustomEvent) => {
  if (e.detail.path === 'Stripe') {
    const loadTime = performance.now() - startTime;
    analytics.track('sdk_loaded', { sdk: 'Stripe', duration: loadTime });
  }
});
```
