# windotwatchr — Technical Design Document

## 1. Architecture Overview

### Package Structure

Single package with subpath exports:

```
windotwatchr/
├── src/
│   ├── core/
│   │   ├── global-watcher.ts      # Orchestrator, singleton registry
│   │   ├── property-trap.ts       # Object.defineProperty on window
│   │   ├── proxy-wrapper.ts       # ES6 Proxy with set + defineProperty traps
│   │   ├── poll-fallback.ts       # setTimeout polling for frozen/sealed objects
│   │   ├── subscription-manager.ts # Map<path, Set<subscriber>>, fan-out
│   │   └── notification-queue.ts  # queueMicrotask batching
│   ├── react/
│   │   ├── use-global.ts
│   │   ├── use-globals.ts
│   │   └── use-global-status.ts
│   ├── vue/
│   │   ├── use-global.ts
│   │   ├── use-globals.ts
│   │   └── use-global-status.ts
│   └── index.ts                   # Core public API
├── package.json
└── tsup.config.ts
```

### Module Dependency Graph

```
Consumer Code
    │
    ├── windotwatchr (core)
    │       │
    │       ├── GlobalWatcher (singleton registry per root key)
    │       │       │
    │       │       ├── PropertyTrap (Object.defineProperty on window)
    │       │       ├── ProxyWrapper (ES6 Proxy, lazy nesting)
    │       │       ├── PollFallback (setTimeout for frozen/sealed)
    │       │       └── SubscriptionManager (Map<path, Set<cb>>)
    │       │
    │       └── NotificationQueue (queueMicrotask batching)
    │
    ├── windotwatchr/react (thin wrapper)
    │       └── useEffect + watchGlobal + useState
    │
    └── windotwatchr/vue (thin wrapper)
            └── onMounted + watchGlobal + ref
```

Framework wrappers depend only on the core public API (`watchGlobal`). They never import internal modules.

---

## 2. Core Engine Design

### PropertyTrap

Installs an `Object.defineProperty` setter/getter on `window` for a root key.

```typescript
// Conceptual — not final implementation
Object.defineProperty(window, rootKey, {
  configurable: true,  // REQUIRED — Firefox throws on non-configurable WindowProxy properties
  enumerable: true,    // Match natural property behavior for for...in / Object.keys()
  get() {
    return currentValue; // undefined before assignment, real value after
  },
  set(newValue) {
    currentValue = proxyWrapper.wrap(newValue);
    subscriptionManager.notify(rootKey, currentValue);
  },
});
```

**Key behaviors:**
- Getter returns `undefined` before assignment to mimic an absent property. SDKs that check `typeof window.Stripe` see `"undefined"` as expected.
- `configurable: true` is mandatory due to WindowProxy exotic object behavior. Firefox throws on non-configurable WindowProxy properties (Sinon.js issue #1195).
- `enumerable: true` ensures the property appears in `for...in` loops and `Object.keys()`, matching natural property behavior. Note: `'Stripe' in window` and `window.hasOwnProperty('Stripe')` return `true` regardless of enumerability — they check property existence, not enumerability.
- Setter remains active after first assignment to handle root replacement (`window.Stripe = newObj`). On each reassignment, re-wraps in a new Proxy and re-notifies.
- **Error recovery**: The `Object.defineProperty` call is wrapped in try/catch. If it throws (e.g., another script already defined the property with `configurable: false`, or unexpected WindowProxy behavior), the PropertyTrap falls back to PollFallback for that root key and emits a `ww:warning` event with `{ path, reason: 'defineProperty failed' }`. The watcher never enters an undefined state.

### ProxyWrapper

Wraps assigned objects in an ES6 Proxy with `set` and `defineProperty` traps.

```typescript
const handler: ProxyHandler<object> = {
  set(target, prop, value, receiver) {
    // Ignore Symbol keys — only match string property names for subscribers
    if (typeof prop === 'symbol') {
      return Reflect.set(target, prop, value, receiver);
    }

    // IMPORTANT: Pass `target` (not `receiver`) as 4th arg to Reflect.set.
    // When receiver is the proxy and the property is new, [[Set]] internally
    // calls Receiver.[[DefineOwnProperty]](), which triggers the proxy's
    // defineProperty trap — causing double notification. Passing `target`
    // instead routes [[DefineOwnProperty]] to the plain object, avoiding this.
    const result = Reflect.set(target, prop, value, target);
    const fullPath = `${parentPath}.${prop}`;
    subscriptionManager.notify(fullPath, value);
    return result;  // Must return true in strict mode
  },

  defineProperty(target, prop, descriptor) {
    // Only fires for explicit SDK calls to Object.defineProperty().
    // Normal property assignment routes through the set trap above
    // (which passes target, not receiver, to avoid double notification).
    if (typeof prop === 'symbol') {
      return Reflect.defineProperty(target, prop, descriptor);
    }

    const result = Reflect.defineProperty(target, prop, descriptor);
    const fullPath = `${parentPath}.${prop}`;
    if ('value' in descriptor) {
      subscriptionManager.notify(fullPath, descriptor.value);
    }
    return result;
  },

  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);

    // Lazy nesting: only create nested proxy when a subscriber watches this depth
    if (value && typeof value === 'object' && subscriptionManager.hasDeepSubscribers(fullPath)) {
      return getOrCreateNestedProxy(value, fullPath);
    }

    return value;
  },
};
```

**Key behaviors:**
- **Lazy nesting**: Nested proxies are created on access, not eagerly. If no subscriber watches `Stripe.checkout.sessions`, no proxy is created at the `checkout` level. This avoids overhead from SDKs with large internal object trees.
- **WeakMap dedup**: A `WeakMap<object, Proxy>` prevents double-wrapping and handles circular references. If `window.Stripe.self = window.Stripe`, the WeakMap returns the existing proxy.
- **Symbol keys ignored**: Only string property names are matched against subscriber paths. Symbol assignments pass through without notification overhead.
- **Both `set` and `defineProperty` traps**: `Object.defineProperty()` uses `[[DefineOwnProperty]]`, not `[[Set]]`. SDKs that use `Object.defineProperty` internally (common pattern) would be missed without the `defineProperty` trap. **Dedup caveat**: when `Reflect.set(target, prop, value, receiver)` creates a new property and `receiver` is the proxy, `[[Set]]` internally calls `Receiver.[[DefineOwnProperty]]()`, triggering the `defineProperty` trap — causing double notification. To avoid this, the `set` trap passes `target` (not `receiver`) as the 4th arg to `Reflect.set`, routing `[[DefineOwnProperty]]` to the plain object. Trade-off: this bypasses prototype-chain setters, which is acceptable since SDK globals are plain objects, not prototype-inheriting instances.

### PollFallback

Activated automatically when Proxy traps can't work.

**Triggers:**
- `Object.isFrozen(target)` returns `true`
- `Object.isSealed(target)` returns `true`
- Property deletion detected (defineProperty trap removed)
- Trap hijacked by another script (`configurable: false` overwrite)

```typescript
function startPolling(path: string, interval: number) {
  const check = () => {
    const value = resolvePath(window, path);
    if (readyPredicate(value)) {
      subscriptionManager.notify(path, value);
      return;
    }
    timerId = setTimeout(check, interval);
  };
  timerId = setTimeout(check, interval);
}
```

**Key behaviors:**
- Dispatches `ww:warning` CustomEvent with `{ path, reason: 'frozen' | 'sealed' | 'deleted' | 'hijacked' }`.
- Default poll interval: 100ms. Configurable via `pollInterval` option. Set to `0` to disable.
- After property deletion (`delete window.Stripe`), polling detects the absence and re-applies the `defineProperty` trap when the property reappears.

### SubscriptionManager

Singleton per root key. Manages the mapping from dot-paths to subscriber callbacks.

```typescript
class SubscriptionManager {
  // O(1) lookup: path → Set of callbacks
  private subscribers: Map<string, Set<SubscriberCallback>> = new Map();

  subscribe(path: string, callback: SubscriberCallback): DisposeFunction {
    let set = this.subscribers.get(path);
    if (!set) {
      set = new Set();
      this.subscribers.set(path, set);
    }
    set.add(callback);

    return () => {
      set!.delete(callback);
      if (set!.size === 0) {
        this.subscribers.delete(path);
      }
    };
  }

  notify(path: string, value: unknown): void {
    const set = this.subscribers.get(path);
    if (!set || set.size === 0) return; // Skip unmatched properties immediately

    notificationQueue.enqueue(set, path, value);
  }

  // O(1) lookup — maintained on subscribe/unsubscribe
  private deepPrefixes: Set<string> = new Set();

  hasDeepSubscribers(pathPrefix: string): boolean {
    return this.deepPrefixes.has(pathPrefix);
  }

  // Called internally by subscribe/unsubscribe to maintain deepPrefixes.
  // On subscribe("Stripe.checkout.sessions"), adds "Stripe" and "Stripe.checkout".
  // On unsubscribe, recomputes only if the removed path was the last with that prefix.
}
```

### NotificationQueue

Batches notifications via `queueMicrotask()` and isolates subscriber callbacks. Falls back to `Promise.resolve().then(fn)` when `queueMicrotask` is unavailable (Chrome <71, Firefox <69, Safari <12.1).

```typescript
function enqueue(subscribers: Set<SubscriberCallback>, path: string, value: unknown): void {
  queueMicrotask(() => {
    for (const callback of subscribers) {
      try {
        callback(value);
      } catch (error) {
        // Isolate: one subscriber throwing doesn't break others
        window.dispatchEvent(new CustomEvent('ww:error', {
          detail: { path, error },
        }));
      }
    }
  });
}
```

**Key behaviors:**
- `queueMicrotask()` ensures callbacks are always async (avoids Zalgo). Even for already-existing values, resolution happens on next microtask.
- Re-entrancy safe: if a callback triggers another assignment, the resulting notification is queued as a new microtask, not processed synchronously.
- Each subscriber is wrapped in `try/catch`. Errors are dispatched as `ww:error` events, not thrown.

---

## 3. Lifecycle & State Machine

### Watcher States

```
                    ┌──────────────────────┐
                    │                      │
                    ▼                      │
  ┌──────┐    ┌──────────┐    ┌───────┐   │
  │ idle │───▶│ watching  │───▶│ ready │   │
  └──────┘    └──────────┘    └───────┘   │
                    │                      │
                    ├─────────────────┐    │
                    ▼                 ▼    │
              ┌──────────┐    ┌─────────┐ │
              │ timeout  │    │  error  │ │
              └──────────┘    └─────────┘ │
                    │                      │
                    │  (retry)             │
                    └──────────────────────┘
```

| State | Entry Condition | Behavior |
|-------|----------------|----------|
| `idle` | Initial state, before `watchGlobal()` is called | No traps installed |
| `watching` | `watchGlobal()` called | PropertyTrap + ProxyWrapper active, listening for assignment |
| `ready` | Path value passes readiness predicate | Callback fired, watcher remains active for re-notification on root replacement |
| `timeout` | Configured timeout elapsed | `ww:timeout` CustomEvent dispatched. If retries configured, transitions back to `watching` |
| `error` | Internal error (trap installation failure, etc.) | `ww:error` CustomEvent dispatched |

### Key Transitions

**Root replacement** (`window.Stripe = newObject`): State transitions back to `watching` for any unresolved sub-paths. Resolved sub-paths are re-notified with the new object's values.

**Already exists** (late mount — `window.Stripe` is already defined when watcher is created): Resolve on next microtask via `queueMicrotask()`. Always async to avoid Zalgo.

**Null handling**: Value passes through the readiness predicate. Default predicate: `value != null`. If `window.Stripe = null`, the watcher stays in `watching` state. Configurable via the `ready` option.

**Deletion** (`delete window.Stripe`): PollFallback activates to detect deletion. When detected, re-applies the PropertyTrap. If the property is later re-assigned, normal flow resumes.

---

## 4. Timeout & Retry

### Timeout

- No default timeout. Consumer must set explicitly.
- When timeout elapses, dispatches a `ww:timeout` CustomEvent on `window`:

```typescript
window.dispatchEvent(new CustomEvent('ww:timeout', {
  detail: { path, attempts: 0, elapsed: timeoutMs, dispose },
}));
```

- The watcher does NOT automatically dispose on timeout. It remains in `timeout` state and can transition to `ready` if the value appears later (unless retries are exhausted and the consumer disposes).
- The `dispose` function is included in the event detail so consumers can easily clean up from event listeners without holding a separate reference.

### Retry

- `retries` option: number of additional check attempts after initial timeout.
- Retry behavior: re-check at `pollInterval` intervals for up to `retries` attempts.
- Each retry dispatches a check. If the value is found, transitions to `ready`.
- If all retries exhausted, watcher remains in `timeout` state. Consumer decides whether to dispose.
- Retry fires **after** timeout, not instead of it. The `ww:timeout` event fires on the initial timeout, then retries begin.

---

## 5. Cleanup & AbortSignal

### `dispose()` Function

Every `watchGlobal()` call returns a `dispose` function:

```typescript
const dispose = watchGlobal('Stripe.checkout', callback);

// Later:
dispose(); // Removes this subscriber, cleans up if last subscriber
```

**Singleton ref-counting**: The PropertyTrap and ProxyWrapper for a root key are shared across all subscribers. `dispose()` removes the individual subscriber from the SubscriptionManager. Only when the last subscriber for a root key disposes does the PropertyTrap get removed and the original property descriptor restored.

### AbortSignal

```typescript
const controller = new AbortController();

watchGlobal('Stripe.checkout', callback, {
  signal: controller.signal,
});

// Later:
controller.abort(); // Equivalent to calling dispose()
```

`AbortSignal` ties the watcher lifecycle to browser-native primitives. The `signal` option is optional — if `AbortController` is unavailable (Chrome <66, Safari <12.1), use `dispose()` instead. Useful for:
- Tying watcher to a fetch request lifecycle
- Framework cleanup patterns
- Composing multiple watchers under a single abort controller

### SSR / Worker Environments

When `typeof window === 'undefined'` (Node.js, Cloudflare Workers, Vercel Edge):
- `watchGlobal()` returns a no-op dispose function immediately. Callback is never invoked.
- `waitForGlobal()` rejects immediately with `Error('windotwatchr: window is not available')`. This prevents silent hangs from `await waitForGlobal('Stripe')` in SSR contexts where there is no timeout default.
- No warnings, no event dispatching.

---

## 6. Events (Public API)

All events are `CustomEvent` instances dispatched on `window`. Event names use the `ww:` prefix. All event dispatching is skipped in non-browser environments (SSR, Cloudflare Workers, Vercel Edge) — guarded by the same `typeof window !== 'undefined'` check that prevents trap installation.

| Event | `detail` Shape | When |
|-------|---------------|------|
| `ww:ready` | `{ path: string, value: unknown }` | Path value passes readiness predicate |
| `ww:timeout` | `{ path: string, attempts: number, elapsed: number, dispose: () => void }` | Configured timeout elapsed |
| `ww:error` | `{ path: string, error: Error }` | Subscriber callback threw, or internal error |
| `ww:warning` | `{ path: string, reason: string }` | Polling fallback triggered, deletion detected, trap hijacked |

### Debug Event Stream

All internal state changes emit events. This is always available — no "debug mode" to enable, no console output.

```typescript
window.addEventListener('ww:ready', (e) => {
  console.log(`${e.detail.path} is ready:`, e.detail.value);
});

window.addEventListener('ww:warning', (e) => {
  console.log(`Warning for ${e.detail.path}: ${e.detail.reason}`);
});
```

Consumers opt in to observability by adding event listeners. Zero overhead for consumers who don't listen.

---

## 7. TypeScript API

### Core Functions

```typescript
/**
 * Watch a window global property path.
 * Callback fires when the value at `path` passes the readiness predicate.
 * Returns a dispose function to remove the subscription.
 */
function watchGlobal<T = unknown>(
  path: string,
  callback: (value: T) => void,
  options?: WatchGlobalOptions,
): DisposeFunction;

/**
 * Promise-based variant.
 * Resolves when the value at `path` passes the readiness predicate.
 */
function waitForGlobal<T = unknown>(
  path: string,
  options?: WatchGlobalOptions,
): Promise<T>;

// watchGlobals — deferred to v2. Consumers can call watchGlobal() in a loop.
```

### Options Interface

```typescript
interface WatchGlobalOptions {
  /** Timeout in ms. No default — consumer must set explicitly. */
  timeout?: number;

  /** Polling interval in ms for fallback. Default: 100. Set to 0 to disable. */
  pollInterval?: number;

  /** Detection strategy. Default: 'auto'. */
  strategy?: 'proxy' | 'poll' | 'auto';

  /** AbortSignal to tie watcher lifecycle to an AbortController. */
  signal?: AbortSignal;

  /** Number of retry attempts after timeout. Default: 0 (no retry). */
  retries?: number;

  /** Readiness predicate. Default: (value) => value != null. */
  ready?: (value: unknown) => boolean;
}

type DisposeFunction = () => void;
```

### React Hook Signatures — `windotwatchr/react`

```typescript
/**
 * Returns the value at window[path] once ready, or null while pending.
 * Cleans up automatically on unmount.
 */
function useGlobal<T = unknown>(
  path: string,
  options?: WatchGlobalOptions,
): T | null;

/**
 * Watch multiple paths. Returns a record of resolved values.
 */
function useGlobals<K extends string>(
  paths: K[],
  options?: WatchGlobalOptions,
): Record<K, unknown | null>;

/**
 * Returns value, status, and error for a watched path.
 */
function useGlobalStatus<T = unknown>(
  path: string,
  options?: WatchGlobalOptions,
): {
  value: T | null;
  status: 'idle' | 'watching' | 'ready' | 'timeout' | 'error';
  error: Error | null;
};
```

### Vue Composable Signatures — `windotwatchr/vue`

```typescript
import type { Ref } from 'vue';

/**
 * Returns a ref that resolves to the value at window[path] once ready.
 * Cleans up automatically on unmount.
 */
function useGlobal<T = unknown>(
  path: string,
  options?: WatchGlobalOptions,
): Ref<T | null>;

/**
 * Watch multiple paths. Returns a ref containing a record of resolved values.
 */
function useGlobals<K extends string>(
  paths: K[],
  options?: WatchGlobalOptions,
): Ref<Record<K, unknown | null>>;

/**
 * Returns refs for value, status, and error.
 */
function useGlobalStatus<T = unknown>(
  path: string,
  options?: WatchGlobalOptions,
): {
  value: Ref<T | null>;
  status: Ref<'idle' | 'watching' | 'ready' | 'timeout' | 'error'>;
  error: Ref<Error | null>;
};
```

---

## 8. Framework Wrappers

### React (`windotwatchr/react`)

Thin wrappers (~20 lines each) over the core API using `useEffect`, `useState`, and `useRef`.

```typescript
// Conceptual implementation of useGlobal
function useGlobal<T = unknown>(path: string, options?: WatchGlobalOptions): T | null {
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    const dispose = watchGlobal<T>(path, (v) => setValue(v), options);
    return dispose;
  }, [path]);

  return value;
}
```

**Cleanup**: Effect return calls `dispose()`, which handles React StrictMode double-mount correctly via singleton ref-counting. The PropertyTrap is only removed when the last subscriber disposes.

**peerDependency**: `react >= 16.8.0` (hooks support).

### Vue (`windotwatchr/vue`)

Thin wrappers (~20 lines each) over the core API using `onMounted`, `onUnmounted`, and `ref`.

```typescript
// Conceptual implementation of useGlobal
function useGlobal<T = unknown>(path: string, options?: WatchGlobalOptions): Ref<T | null> {
  const value = ref<T | null>(null) as Ref<T | null>;
  let dispose: DisposeFunction | null = null;

  onMounted(() => {
    dispose = watchGlobal<T>(path, (v) => { value.value = v; }, options);
  });

  onUnmounted(() => {
    dispose?.();
  });

  return value;
}
```

**peerDependency**: `vue >= 3.0.0`.

---

## 9. Edge Case Matrix

| # | Edge Case | Severity | Mitigation | Test Requirement |
|---|-----------|----------|------------|-----------------|
| E1 | SDK uses `Object.defineProperty` for sub-properties | High | `defineProperty` trap in Proxy handler catches `[[DefineOwnProperty]]` calls | Unit: mock SDK using `Object.defineProperty` internally |
| E2 | SDK calls `Object.freeze()` on its API object | High | Detect via `Object.isFrozen()` pre-check; auto-fallback to polling + `ww:warning` event | Unit: freeze object after assignment, verify polling activates |
| E3 | SDK calls `Object.seal()` on its API object | Medium | Detect via `Object.isSealed()`; sealed objects allow value changes but not new props — poll for new props only | Unit: seal object, verify existing prop changes still detected |
| E4 | SDK replaces entire root (`window.Stripe = newObj`) | High | PropertyTrap setter remains active. Re-wrap new value in Proxy, re-notify all subscribers. Unresolved sub-paths return to `watching` | Unit: assign root twice, verify re-notification |
| E5 | SDK checks `typeof window.Stripe` with getter present | Medium | Getter returns `undefined` (matches absent property behavior). `typeof undefined === "undefined"` | Integration: test with real Stripe.js, Google Maps |
| E6 | SDK uses `hasOwnProperty('Stripe')` or `'Stripe' in window` | Medium | Both return `true` for any own property regardless of enumerability. **Risk**: `'Stripe' in window` returns `true` even when getter returns `undefined` — differs from a truly absent property (`false`). SDKs that check `in` before assigning may skip assignment. Mitigated by integration testing against real SDKs | Integration: verify Stripe.js, Google Maps still assign correctly with trap installed |
| E7 | React StrictMode double-mount causes duplicate traps | Medium | Singleton ref-counting per root key. Only remove trap when ref count hits 0 | Unit: mount → unmount → remount, verify single trap |
| E8 | SSR / Node.js / Cloudflare Workers — no `window` | Low | Guard with `typeof window !== 'undefined'`; return no-op dispose, immediate reject for `waitForGlobal` | Unit: run in Node.js environment |
| E9 | Path deeper than 2 levels (`Stripe.checkout.sessions.create`) | Medium | Recursive Proxy nesting via `get` trap. Unlimited depth, lazy creation | Unit: watch 4-level path, assign incrementally |
| E10 | Proxy on frozen object get trap must return same value (invariant) | High | Never proxy frozen objects — detect and fall back to polling | Unit: attempt to proxy frozen object, verify fallback |
| E11 | Memory leaks from undisposed watchers | Medium | `dispose()` + `AbortSignal`. Singleton ref-counting ensures traps are cleaned up | Unit: dispose all watchers, verify no lingering refs |
| E12 | Value already exists when watcher created (late mount) | Medium | Check current value immediately, resolve on next microtask via `queueMicrotask()`. Always async | Unit: set value before watch, verify async resolution |
| E13 | Circular references (`window.Stripe.self = window.Stripe`) | Medium | `WeakMap<object, Proxy>` dedup. Same object returns same proxy instance | Unit: create circular ref, verify no infinite loop |
| E14 | Subscriber callback throws | Medium | `try/catch` per subscriber in notification queue. Error dispatched as `ww:error` event. Other subscribers unaffected | Unit: first subscriber throws, second still receives |
| E15 | `delete window.Stripe` removes defineProperty trap | Medium | PollFallback detects deletion, re-applies PropertyTrap when property reappears | Unit: delete property, re-assign, verify detection |

### Future Investigation (Roadmap)

| # | Edge Case | Notes |
|---|-----------|-------|
| F1 | Proxy `set` trap must return `true` (strict mode) | Trivial — always `Reflect.set(...)`. Verify in unit tests but no design decision needed. |
| F2 | Root object replaced multiple times | Subset of E4. Verify GC of previous Proxy via WeakMap deref. |
| F3 | Property resolves to `null` or `undefined` | Handled by `ready` predicate. Verify edge cases around `undefined` vs missing. |
| F4 | Symbol property keys in Proxy traps | 2-line guard. Verify no notification fires for Symbol assignments. |
| F5 | Another script overwrites trap with `configurable: false` | Race-to-be-first strategy. Investigate detection + fallback if this becomes a real issue. |
| F6 | Re-entrancy (callback triggers another assignment) | Covered by `queueMicrotask` batching design. Stress-test under load. |
| F7 | `Object.assign()` or spread into watched object | Standard Proxy `set` behavior. No special handling. Verify in unit tests. |
| F8 | HMR causes singleton state loss | Deferred. Options: `import.meta.hot` preservation or `globalThis.__ww__` cache. Investigate during framework testing. |

---

## 10. Performance Budget

| Metric | Target | Rationale |
|--------|--------|-----------|
| Proxy `set` trap overhead | <1ms per 1,000 invocations | Typical SDK initializes 10-100 properties. 1K is extreme. |
| Subscriber lookup | O(1) via `Map.get()` | Map lookup by exact path string |
| Notification fan-out | O(n) where n = subscriber count for that path | Set iteration, unavoidable |
| Lazy proxy creation | No eager tree walk | Only create nested Proxy when a subscriber watches that depth |
| Bundle size (core) | <5 KB gzipped | Core + subscription + timeout/retry + events |
| Bundle size (react wrapper) | <500 B gzipped | ~20 lines, just useEffect + useState |
| Bundle size (vue wrapper) | <500 B gzipped | ~20 lines, just onMounted + ref |
| Memory per watcher | O(1) per subscriber + O(depth) for proxy chain | WeakMap prevents duplicate proxies |

### Benchmark Requirements

- **Micro-benchmark**: Proxy `set` trap vs direct assignment at 1K / 10K / 100K operations
- **Memory**: 100 active watchers, measure heap delta
- **Time-to-detection**: Proxy (instant) vs polling at 50ms vs polling at 100ms

---

## 11. Testing Strategy

### Unit Tests (Vitest + jsdom)

Core engine tests, no framework dependencies. Mocked script behavior. Note: jsdom exposes `window`, so the SSR guard does not activate — the library installs real traps in jsdom. This is desired for unit testing. SSR tests must use a pure Node.js environment (vitest `environment: 'node'`).

| Area | Tests |
|------|-------|
| PropertyTrap | Intercepts `window.X = value`; getter returns `undefined` before assignment; `configurable: true` enforced; re-fires on root replacement |
| ProxyWrapper | `set` trap fires for `obj.child = value`; `defineProperty` trap fires for `Object.defineProperty(obj, 'child', ...)`; lazy nesting; WeakMap dedup; symbol keys ignored |
| PollFallback | Activates for frozen objects; activates for sealed objects; re-traps after deletion; fires `ww:warning` |
| SubscriptionManager | O(1) lookup; fan-out to N subscribers; dispose removes subscriber; last dispose cleans up Map entry |
| NotificationQueue | `queueMicrotask` batching; callback isolation (try/catch); re-entrancy safe |
| Timeout/Retry | Timeout fires `ww:timeout` event; retry re-checks at intervals; retry count respected |
| AbortSignal | Abort disposes watcher; no callbacks after abort |
| SSR | No errors when `window` undefined; returns no-op dispose |
| Already-exists | Next-tick resolve for pre-existing values; always async |
| Readiness predicate | Default rejects null; custom predicate respected |

### Integration Tests (Playwright)

Real browser, real SDKs. Validates that the defineProperty + Proxy approach doesn't break SDK initialization.

| SDK | Test Cases |
|-----|-----------|
| **Stripe** | Detect `window.Stripe`; detect `window.Stripe.elements`; detect `window.Stripe.checkout` |
| **Google Maps** | Detect `window.google`; detect `window.google.maps` |
| **Shopify** | Buy Button API detection; root object replacement handling |
| **Affirm** | Payment SDK globals; internal `Object.defineProperty` usage |
| **OneTrust** | Consent manager; `Object.freeze`/`Object.seal` handling |

### Framework Tests

Run in demo apps to test real framework lifecycle behavior.

| Framework | Tests |
|-----------|-------|
| **React** | `useGlobal` resolves correctly; cleanup on unmount; StrictMode double-mount; `useGlobalStatus` status transitions |
| **Vue** | `useGlobal` ref updates; cleanup on unmount; `useGlobalStatus` ref transitions |

### Performance Benchmarks

| Benchmark | Methodology |
|-----------|------------|
| Proxy trap overhead | 1K / 10K / 100K property assignments, measure wall time vs baseline (no proxy) |
| Memory usage | 100 active watchers with varying depth, measure heap snapshot delta |
| Time-to-detection | Compare event-driven (Proxy) vs polling at 50ms / 100ms intervals |

---

## 12. Package Configuration

### `package.json` exports

```json
{
  "name": "windotwatchr",
  "version": "0.1.0",
  "description": "Zero-polling, event-driven detection of window.* global properties and nested sub-APIs.",
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./react": {
      "import": "./dist/react.mjs",
      "require": "./dist/react.cjs",
      "types": "./dist/react.d.ts"
    },
    "./vue": {
      "import": "./dist/vue.mjs",
      "require": "./dist/vue.cjs",
      "types": "./dist/vue.d.ts"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": false,
  "peerDependencies": {
    "react": ">=16.8.0",
    "vue": ">=3.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true },
    "vue": { "optional": true }
  },
  "browserslist": ["> 0.5%", "not dead", "not ie 11"],
  "engines": {
    "node": ">=16.0.0"
  }
}
```

### tsup Configuration

```typescript
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
  },
  {
    entry: { react: 'src/react/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    external: ['react', 'windotwatchr'],
  },
  {
    entry: { vue: 'src/vue/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    external: ['vue', 'windotwatchr'],
  },
]);
```

---

## 13. Implementation Phases

### Phase 1: Core Engine

`watchGlobal`, `waitForGlobal`

- PropertyTrap (defineProperty on window)
- ProxyWrapper (set + defineProperty traps, lazy nesting)
- SubscriptionManager (Map-based fan-out)
- NotificationQueue (queueMicrotask batching)
- PollFallback (frozen/sealed detection)
- Already-exists detection (next-tick resolve)
- Readiness predicate
- Dispose + singleton ref-counting
- SSR/Worker no-op guard

### Phase 2: Timeout + Retry + Events

- Configurable timeout
- `ww:timeout` CustomEvent dispatch
- Retry at intervals for N attempts
- `ww:ready`, `ww:error`, `ww:warning` events
- AbortSignal support

### Phase 3: React Wrapper (`windotwatchr/react`)

- `useGlobal` hook
- `useGlobals` hook
- `useGlobalStatus` hook
- StrictMode compatibility verification

### Phase 4: Vue Wrapper (`windotwatchr/vue`)

- `useGlobal` composable
- `useGlobals` composable
- `useGlobalStatus` composable

### Phase 5: SDK Compatibility Testing

- Playwright tests against Stripe, Google Maps, Shopify, Affirm, OneTrust
- Verify defineProperty trap doesn't break SDK initialization
- Verify Proxy wrapping is transparent to SDK internals
- Document any SDK-specific workarounds

### Phase 6: Debug Event Stream

- Granular `ww:*` events for all internal state changes
- State transition events
- Performance: zero overhead when no listeners attached

### Phase 7: Documentation + Demos

- README (from brief.md)
- API reference
- React demo app
- Vue demo app
- Migration guide from polling patterns
