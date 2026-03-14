# Detection Strategies

## Overview

windotwatchr uses a layered detection approach:

1. **PropertyTrap** — `Object.defineProperty` on `window[rootKey]` intercepts root assignment
2. **ProxyWrapper** — ES6 Proxy on the assigned object intercepts nested property writes
3. **PollFallback** — `setTimeout` chain for frozen/sealed objects or failed traps

## Strategy Option

```ts
type Strategy = 'proxy' | 'poll' | 'auto';
```

- `'auto'` (default): Proxy first, falls back to polling if needed
- `'proxy'`: Proxy only (no fallback)
- `'poll'`: Polling only

## Layer 1: PropertyTrap (defineProperty)

`src/core/property-trap.ts` — `installTrap(rootKey, subManager, proxyWrapper, options)`

Installs a getter/setter on `window[rootKey]`:

```ts
Object.defineProperty(window, rootKey, {
  configurable: true,
  enumerable: true,
  get() { return currentValue; },
  set(newValue) { handleAssignment(newValue); },
});
```

**Setter behavior**:
1. Stops any existing poll fallback
2. If `newValue` is an object → wraps in Proxy via ProxyWrapper
3. If Proxy wrapping returns `null` (frozen/sealed) → stores raw value + starts polling
4. If `newValue` is primitive/null → stores as-is
5. Notifies all subscribers via SubscriptionManager

**Getter behavior**: Returns `undefined` before first assignment. SDKs checking `typeof window.Stripe` see `"undefined"` as expected.

**Reusability**: Setter remains active after first assignment. SDK re-assigning `window.Stripe = newObj` triggers re-wrap and re-notification.

**Failure handling**: If `Object.defineProperty` itself throws (property locked by another script), dispatches `ww:warning` and falls back to polling.

**Restore on dispose**: Original property descriptor is saved and restored when the trap is removed.

## Layer 2: ProxyWrapper (ES6 Proxy)

`src/core/proxy-wrapper.ts` — `createProxyWrapper(subManager)`

Three Proxy traps:

### `set` trap — Direct property assignment

```ts
set: (target, prop, value, _receiver) => {
  if (typeof prop === 'symbol') return Reflect.set(target, prop, value, target);
  const result = Reflect.set(target, prop, value, target); // target, NOT receiver
  subManager.notify(`${parentPath}.${prop}`, value);
  return result;
}
```

**Critical**: Pass `target` (not `receiver`) to `Reflect.set` to avoid double notification. See architecture topic for full explanation.

### `defineProperty` trap — Object.defineProperty calls

```ts
defineProperty: (target, prop, descriptor) => {
  if (typeof prop === 'symbol') return Reflect.defineProperty(target, prop, descriptor);
  const result = Reflect.defineProperty(target, prop, descriptor);
  if ('value' in descriptor) {
    subManager.notify(`${parentPath}.${prop}`, descriptor.value);
  }
  return result;
}
```

Only notifies for **value descriptors**, not accessor descriptors (get/set).

### `get` trap — Lazy nested proxy creation

```ts
get: (target, prop, receiver) => {
  const value = Reflect.get(target, prop, receiver);
  if (typeof prop === 'symbol' || value === null || typeof value !== 'object') return value;

  const fullPath = `${parentPath}.${prop}`;
  if (!subManager.hasDeepSubscribers(fullPath)) return value; // No proxy needed

  return getOrCreateNestedProxy(value, fullPath);
}
```

**Key insight**: Only creates nested proxies when someone watches a deeper path. Watching `"Stripe"` alone does NOT proxy `Stripe.checkout`. Watching `"Stripe.checkout"` causes a nested proxy only for `checkout`.

## Deep Subscriber Tracking

`SubscriptionManager.hasDeepSubscribers(pathPrefix)` uses a ref-counted `deepPrefixes` map:

```
subscribe("Stripe.checkout.sessions", cb)
  → deepPrefixes["Stripe"] = 1
  → deepPrefixes["Stripe.checkout"] = 1
  → (no entry for "Stripe.checkout.sessions" — it's a leaf)

get trap reads window.Stripe.checkout:
  → hasDeepSubscribers("Stripe.checkout") → true → create nested proxy
get trap reads window.Stripe.elements:
  → hasDeepSubscribers("Stripe.elements") → false → return raw value
```

## Layer 3: PollFallback

`src/core/poll-fallback.ts` — `startPolling(path, subManager, options)`

Used when Proxy can't work:
- `Object.isFrozen(target)` → Proxy wrapping returns `null`
- `Object.isSealed(target)` → same
- `Object.defineProperty` threw → property locked

Implementation: `setTimeout` chain (NOT `setInterval`):

```ts
const check = () => {
  if (stopped) return;
  const value = resolvePath(window, path);
  if (predicate(value)) {
    subManager.notify(path, value);
    return; // Stop polling — value found
  }
  setTimeout(check, interval); // Schedule next check
};
setTimeout(check, interval);
```

**Self-stopping**: Polling stops automatically when the predicate passes.

## `resolvePath` Utility

```ts
function resolvePath(root: object, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
```

Walks dot-notation safely — returns `undefined` if any intermediate is nullish.

## Detection Flow Summary

```
Third-party script does: window.Stripe = { checkout: { ... } }
  ↓
PropertyTrap setter fires
  ↓
ProxyWrapper.wrap(stripeObj, 'Stripe')
  ├─ If wrappable → Proxy created, stored as currentValue
  └─ If frozen/sealed → raw value stored, polling started
  ↓
subManager.notify('Stripe', proxiedOrRawValue)
  ↓
notifySubscribers → microtask → dispatchWatcherEvent('ww:ready') → callbacks

Later: window.Stripe.checkout.sessions = newValue
  ↓ (only if someone watches 'Stripe.checkout.sessions')
Proxy get trap on 'checkout' → creates nested proxy (lazy)
  ↓
Nested proxy set trap fires for 'sessions'
  ↓
subManager.notify('Stripe.checkout.sessions', newValue)
  ↓
notifySubscribers → microtask → callbacks
```
