# Architecture & Internals

## Engine Pipeline

```
watchWindot / waitForWindot (public API, src/index.ts)
    ↓
watch() (orchestration, src/core/windot-watcher.ts)
    ├─ parsePath('Stripe.checkout') → ['Stripe', 'checkout']
    ├─ Get or create singleton RootWatcher for 'Stripe'
    │   ├─ SubscriptionManager (path → callback Set)
    │   ├─ ProxyWrapper (wraps objects in ES6 Proxy)
    │   └─ PropertyTrap (Object.defineProperty on window.Stripe)
    ├─ Subscribe callback for 'Stripe.checkout'
    ├─ Check if value already exists (late mount → microtask notify)
    ├─ Setup timeout + retry timers (if options.timeout)
    ├─ Setup AbortSignal listener (if options.signal)
    └─ Return dispose function
```

## Singleton Registry

`src/core/windot-watcher.ts` maintains a `Map<string, RootWatcher>`:

```ts
const registry = new Map<string, RootWatcher>();
```

Multiple watchers on the same root key share one RootWatcher:
- `watch('Stripe.checkout', cb1)` and `watch('Stripe.elements', cb2)` share one trap on `window.Stripe`
- RootWatcher is created on first subscription, torn down when last subscriber disposes
- Ref-counting via `subManager.getSubscriberCount()`

## RootWatcher Structure

```ts
interface RootWatcher {
  subManager: SubscriptionManager;          // Path → callback registry
  trapDispose: DisposeFunction;             // Removes defineProperty trap
  subPathPolls: Map<string, DisposeFunction>; // Active sub-path poll fallbacks
}
```

## Module Dependency Graph

```
index.ts
  ├─ types.ts (shared types + defaults)
  ├─ core/event-dispatcher.ts (SSR-safe CustomEvent dispatch)
  └─ core/windot-watcher.ts (orchestration)
       ├─ core/property-trap.ts (defineProperty on window[rootKey])
       │    ├─ core/proxy-wrapper.ts (ES6 Proxy handler)
       │    └─ core/poll-fallback.ts (setTimeout chain fallback)
       ├─ core/subscription-manager.ts (path → Set<callback>)
       │    └─ core/notification-queue.ts (microtask scheduling)
       └─ core/poll-fallback.ts (resolvePath utility)

react/index.ts
  └─ react/use-windotwatchr.ts
       ├─ index.ts (watchWindot)
       └─ types.ts (WindotWatchrOptions, WatcherState)
```

## The `Reflect.set(target, prop, value, target)` Pattern

**The problem**: In the ProxyWrapper's `set` trap, the 4th argument to `Reflect.set` determines where `[[DefineOwnProperty]]` routes when creating new properties.

```ts
// WRONG — causes double notification:
set: (target, prop, value, receiver) => {
  Reflect.set(target, prop, value, receiver); // receiver = proxy
  // When prop is NEW, [[Set]] calls receiver.[[DefineOwnProperty]]
  // → triggers defineProperty trap → SECOND notify()
}
```

```ts
// CORRECT — single notification:
set: (target, prop, value, _receiver) => {
  Reflect.set(target, prop, value, target); // target = plain object
  // [[DefineOwnProperty]] goes to plain object, NOT proxy
  // → defineProperty trap does NOT fire
}
```

**Trade-off**: Bypasses prototype-chain setters. Acceptable because SDK globals are plain objects.

**Location**: `src/core/proxy-wrapper.ts`, line ~119.

## Proxy Cache (WeakMap Deduplication)

```ts
class ProxyWrapperImpl {
  private proxyCache = new WeakMap<object, object>();
  // ...
}
```

- Prevents double-wrapping: same object → same proxy
- Handles circular references: `window.Stripe.self = window.Stripe`
- WeakMap allows GC of unreferenced objects

## Microtask Scheduling

Both `windot-watcher.ts` and `notification-queue.ts` use:

```ts
const schedule: (fn: () => void) => void =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);
```

**Why microtask, not synchronous**: Prevents Zalgo (inconsistent sync/async behavior). Late-mount values are always delivered on next microtask, same as trap-detected values.

## Late Mount Detection

When `watch()` is called and the value already exists on `window`:

```ts
const currentRoot = (window as Record<string, unknown>)[rootKey];
if (currentRoot !== undefined) {
  if (!subPath) {
    // Root-level: value exists, schedule notification
    if (predicate(currentRoot)) {
      schedule(() => {
        dispatchWatcherEvent('ww:ready', { path, value: currentRoot });
        effectiveCallback(currentRoot);
      });
    }
  } else {
    // Sub-path: resolve full path, check predicate
    const currentValue = resolvePath({ [rootKey]: currentRoot }, path);
    if (predicate(currentValue)) {
      schedule(() => { /* notify */ });
    } else if (pollInterval > 0) {
      // Start polling for this sub-path
    }
  }
}
```

## Teardown Flow

```
dispose() called
  ├─ Guard: if already disposed, return
  ├─ Clear timeout/retry timers
  ├─ Unsubscribe from SubscriptionManager
  ├─ Stop sub-path poll (if active for this path)
  ├─ Check: subManager.getSubscriberCount() === 0?
  │   └─ Yes → teardownRootWatcher():
  │       ├─ Dispose PropertyTrap (restores original descriptor)
  │       ├─ Stop all sub-path polls
  │       └─ Remove from registry
  └─ Remove AbortSignal listener (if any)
```
