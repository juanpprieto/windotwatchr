# Research Brief: `global-await` â€” Async Global Property Observer for React

> **Purpose**: This document serves as a research brief and package definition for an AI LLM agent to investigate further, clarify assumptions, test edge cases, and produce a final Technical Design Document (TDD) with an implementation plan.

---

## 1. Problem Statement

When integrating third-party scripts (Stripe, Google Maps, analytics SDKs, etc.) into a React application, developers face a common challenge: **knowing exactly when `window.XYZ` (and its nested sub-properties) are available and ready for use** â€” without blocking the JavaScript main thread.

### Specific Challenges

1. **Script `onload` â‰  API readiness**: A script's `load` event fires when the file finishes executing, but many SDKs perform additional async initialisation internally. `window.XYZ` may not exist at `onload` time.
2. **Multiple independent scripts populate a shared namespace**: e.g., Script A creates `window.Stripe.a` and Script B creates `window.Stripe.b`. Load order is non-deterministic based on file size, CDN speed, and network conditions.
3. **Nested property readiness**: Developers need to know when `window.Stripe.checkout` is available, not just `window.Stripe`.
4. **Non-blocking requirement**: Polling with tight `setInterval` loops wastes CPU cycles. The solution must yield to the event loop.
5. **React lifecycle integration**: The solution must work within React's effect lifecycle, handle StrictMode double-mounting, and support cleanup on unmount.

---

## 2. Research Findings

### 2.1 Technique Rankings

Below are the five techniques investigated, ranked by overall suitability for this package's goals:

| Rank | Technique | Precision | Non-Blocking | Nested Support | Complexity | Score |
|------|-----------|-----------|--------------|----------------|------------|-------|
| 1 | `Object.defineProperty` + `Proxy` combo | Exact tick | âœ… Yes | âœ… Deep | Medium | â­â­â­â­â­ |
| 2 | ES6 `Proxy` (deep, e.g. `proxy-deep`) | Exact tick | âœ… Yes | âœ… Arbitrary depth | Low (npm dep) | â­â­â­â­ |
| 3 | `useScript` hook + polling fallback | ~50-100ms | âœ… Yes | âš ï¸ Manual | Low | â­â­â­Â½ |
| 4 | `MutationObserver` | ~0.09ms (microtask) | âœ… Yes | âŒ DOM only | Medium | â­â­â­ |
| 5 | `setTimeout`/`requestIdleCallback` poll | Configurable interval | âœ… Yes | âœ… Any | Low | â­â­Â½ |

### 2.2 Recommended Primary Approach: `Object.defineProperty` + `Proxy`

**How it works:**
1. Before the third-party script loads, use `Object.defineProperty` on `window` to define a setter trap for the root key (e.g., `"Stripe"`).
2. When the script assigns `window.Stripe = { ... }`, the setter fires. At this point, wrap the incoming object in an ES6 `Proxy` with a `set` trap before storing it.
3. The `Proxy`'s `set` trap fires whenever any script later does `window.Stripe.checkout = ...` or `window.Stripe.elements = ...`.
4. Each trap notifies subscribers with the path and value, e.g., `("Stripe.checkout", checkoutAPI)`.

**Why this is top-ranked:**
- Zero polling â€” entirely event-driven at both root and nested levels.
- Precision â€” resolves at the exact JavaScript tick of assignment.
- No dependencies â€” uses native browser APIs only.
- Non-blocking â€” no timers, no RAF loops, no idle callbacks.

### 2.3 Fallback: `setTimeout` Polling

Required for edge cases where `Proxy` traps are bypassed:
- SDK uses `Object.defineProperty()` internally to set sub-properties (bypasses `set` trap, hits `defineProperty` trap instead).
- SDK calls `Object.freeze()` or `Object.seal()` on its API object.
- SDK replaces the entire root object after initial assignment.

### 2.4 Key Technical Findings & Validated Facts

| Finding | Source / Evidence | Confidence |
|---------|-------------------|------------|
| `Proxy` `set` trap fires on direct property assignment (`obj.x = val`) | ES6 spec, MDN Proxy documentation | âœ… High |
| `Proxy` `set` trap does NOT fire when child uses `Object.defineProperty()` internally | ES6 spec â€” `defineProperty` trap is separate from `set` trap | âœ… High |
| `Object.freeze()` on a Proxy can behave unexpectedly â€” frozen proxies may still appear mutable if traps return `true` | ES Discuss thread on freeze/proxy interaction, Stack Overflow | âš ï¸ Medium â€” needs testing |
| `MutationObserver` callbacks fire on the microtask queue (~0.09ms vs ~8ms for setTimeout) | macarthur.me benchmark article | âœ… High |
| `Object.defineProperty` setter on `window` properties is supported in all modern browsers | MDN, Stack Overflow | âœ… High |
| `proxy-deep` npm package provides `this.path` and `this.nest()` for arbitrary depth proxy chains | npm registry, proxy-deep README | âœ… High |
| React StrictMode in dev mode runs effects twice â€” cleanup must fully teardown traps | React docs | âœ… High |
| `window` cannot be frozen (`Object.freeze(window)` throws) | Stack Overflow confirmation | âœ… High |
| Nested `Proxy` on frozen object throws if `get` trap returns different value than target | ES6 spec invariant, Stack Overflow | âœ… High |

---

## 3. Assumptions Requiring Further Investigation

> âš ï¸ **ACTION FOR LLM AGENT**: Each assumption below must be tested or validated before finalising the TDD.

### A1: `Object.defineProperty` on `window` Before Script Load

**Assumption**: Calling `Object.defineProperty(window, 'Stripe', { set: ... })` before loading `<script src="stripe.js">` will successfully intercept the script's assignment.

**Risk**: Some scripts may check `typeof window.Stripe` before assigning, and a getter returning `undefined` may cause the script to behave differently than if the property simply didn't exist.

**Test**: Load Stripe.js, Google Maps, and 2-3 other popular SDKs with a pre-defined getter/setter trap and verify the SDK still initialises correctly.

### A2: Proxy `set` Trap Catches All SDK Assignments

**Assumption**: Once we wrap `window.Stripe` in a Proxy, all sub-property assignments from third-party scripts will trigger our `set` trap.

**Risk**: Some SDKs may use `Object.defineProperty()` to set sub-properties (which triggers the `defineProperty` trap, not `set`). Some may use `Object.assign()` or spread operators.

**Test**: Instrument a Proxy with both `set` and `defineProperty` traps and load real-world SDKs to see which trap fires for sub-property creation.

### A3: Proxy Wrapper Doesn't Break SDK Internal Logic

**Assumption**: Wrapping the SDK's root object in a Proxy is transparent â€” the SDK's internal code that references `this`, checks `instanceof`, or uses `Object.keys()` will still work.

**Risk**: Some invariant checks may fail. For example, `Object.getOwnPropertyDescriptor()` on a proxied property may return unexpected results.

**Test**: Run SDK test suites (or manual integration tests) with the Proxy wrapper in place.

### A4: Cleanup and Re-Initialisation is Safe

**Assumption**: When a React component unmounts (or StrictMode re-mounts), we can safely dispose of the `Object.defineProperty` trap and Proxy without corrupting the global state.

**Risk**: If we restore a normal property descriptor on cleanup but the SDK hasn't loaded yet, a subsequent re-mount needs to re-trap. Race condition window.

**Test**: Mount/unmount the hook rapidly (simulate StrictMode) and verify no lost events or corrupted state.

### A5: Multiple Consumers Can Subscribe Simultaneously

**Assumption**: Multiple React components can independently subscribe to different sub-properties of the same global (e.g., Component A waits for `Stripe.a`, Component B waits for `Stripe.b`).

**Risk**: The Proxy is a singleton on `window.Stripe`. Multiple hook instances must share a single Proxy instance and fan out notifications.

**Test**: Render 3+ components each waiting for different sub-properties and verify all resolve independently.

### A6: Performance at Scale

**Assumption**: The Proxy `set` trap adds negligible overhead even when the SDK makes hundreds of internal property assignments during initialisation.

**Risk**: If an SDK sets thousands of internal properties (e.g., building a large lookup table on the root object), each triggers the trap.

**Test**: Benchmark Proxy trap overhead vs. direct assignment for 1K, 10K, and 100K property sets.

---

## 4. Proposed Package Definition

### Package Identity

```json
{
  "name": "global-await",
  "version": "0.1.0",
  "description": "Zero-polling, event-driven detection of window global properties and nested sub-APIs for React. Know the exact tick when window.XYZ.abc is ready.",
  "keywords": [
    "react",
    "hook",
    "third-party-script",
    "window-global",
    "async",
    "proxy",
    "defineProperty",
    "mutation-observer",
    "polling",
    "sdk-loader",
    "stripe",
    "google-maps"
  ],
  "license": "MIT",
  "main": "dist/index.cjs.js",
  "module": "dist/index.esm.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.esm.js",
      "require": "./dist/index.cjs.js",
      "types": "./dist/index.d.ts"
    },
    "./core": {
      "import": "./dist/core.esm.js",
      "require": "./dist/core.cjs.js",
      "types": "./dist/core.d.ts"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": false,
  "peerDependencies": {
    "react": ">=16.8.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true }
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsup": "^8.0.0",
    "vitest": "^1.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "@testing-library/react": "^14.0.0",
    "jsdom": "^24.0.0",
    "playwright": "^1.40.0"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
```

### Proposed Public API

```typescript
// === CORE (framework-agnostic) ===

/**
 * Watch for a window global property to be assigned.
 * Supports dot-notation paths for nested properties.
 * Returns a dispose function.
 */
function watchGlobal(
  path: string,
  callback: (value: unknown) => void,
  options?: WatchGlobalOptions
): DisposeFunction;

interface WatchGlobalOptions {
  /** Timeout in ms before rejecting. Default: none (wait forever) */
  timeout?: number;
  /** Polling interval fallback in ms. Default: 100. Set to 0 to disable polling fallback. */
  pollInterval?: number;
  /** Strategy: 'proxy' | 'poll' | 'auto'. Default: 'auto' */
  strategy?: 'proxy' | 'poll' | 'auto';
}

type DisposeFunction = () => void;

/**
 * Promise-based variant.
 */
function waitForGlobal<T = unknown>(
  path: string,
  options?: WatchGlobalOptions
): Promise<T>;

/**
 * Watch multiple paths simultaneously.
 * Callback fires each time any watched path resolves.
 */
function watchGlobals(
  paths: string[],
  callback: (resolved: Record<string, unknown>, pending: string[]) => void,
  options?: WatchGlobalOptions
): DisposeFunction;


// === REACT HOOKS ===

/**
 * Returns the value at window[path] once available, or null while pending.
 */
function useGlobal<T = unknown>(
  path: string,
  options?: UseGlobalOptions
): T | null;

interface UseGlobalOptions extends WatchGlobalOptions {
  /** If true, also inject a <script> tag for the given src. */
  src?: string;
  /** Script attributes (async, defer, crossorigin, etc.) */
  scriptAttrs?: Record<string, string>;
}

/**
 * Wait for multiple nested sub-properties of a shared root global.
 * Returns a record of resolved values (null while pending).
 */
function useGlobals<K extends string>(
  paths: K[],
  options?: UseGlobalOptions
): Record<K, unknown | null>;

/**
 * Extracting status information.
 */
function useGlobalStatus(
  path: string,
  options?: UseGlobalOptions
): {
  value: unknown | null;
  status: 'idle' | 'waiting' | 'ready' | 'timeout' | 'error';
  error: Error | null;
};
```

---

## 5. Architecture Overview

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  global-await                     â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚   React Layer    â”‚        Core Layer             â”‚
â”‚                  â”‚                                â”‚
â”‚  useGlobal()     â”‚   GlobalWatcher (singleton)    â”‚
â”‚  useGlobals()    â”‚     â”œâ”€ PropertyTrap            â”‚
â”‚  useGlobalStatus â”‚     â”‚  (Object.defineProperty) â”‚
â”‚                  â”‚     â”œâ”€ ProxyWrapper             â”‚
â”‚                  â”‚     â”‚  (ES6 Proxy set/          â”‚
â”‚                  â”‚     â”‚   defineProperty traps)   â”‚
â”‚                  â”‚     â”œâ”€ PollFallback             â”‚
â”‚                  â”‚     â”‚  (setTimeout chain)       â”‚
â”‚                  â”‚     â””â”€ SubscriptionManager      â”‚
â”‚                  â”‚        (fan-out to N consumers) â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚             Strategy Resolver ('auto')            â”‚
â”‚  1. Try Object.defineProperty + Proxy             â”‚
â”‚  2. Detect frozen/sealed â†’ fall back to polling   â”‚
â”‚  3. Detect defineProperty-based SDK â†’ add trap    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Singleton Pattern

The `GlobalWatcher` must be a **singleton per root key**. When multiple React components call `useGlobal("Stripe.a")` and `useGlobal("Stripe.b")`, they share one `PropertyTrap` on `window.Stripe` and one `ProxyWrapper` instance. The `SubscriptionManager` fans out notifications to individual subscribers based on path matching.

```
Component A: useGlobal("Stripe.checkout")  â”€â”€â”
Component B: useGlobal("Stripe.elements")  â”€â”€â”¼â”€â”€â–¶ GlobalWatcher("Stripe")
Component C: useGlobal("Stripe.checkout")  â”€â”€â”˜         â”‚
                                                        â–¼
                                              ProxyWrapper(window.Stripe)
                                                        â”‚
                                              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                              â–¼         â–¼         â–¼
                                          set "checkout"  set "elements"
                                              â”‚         â”‚
                                              â–¼         â–¼
                                          notify A,C   notify B
```

---

## 6. Edge Cases & Risk Matrix

| # | Edge Case | Severity | Mitigation Strategy | Validated? |
|---|-----------|----------|---------------------|------------|
| E1 | SDK uses `Object.defineProperty` for sub-properties | High | Add `defineProperty` trap to Proxy handler | âŒ Needs test |
| E2 | SDK calls `Object.freeze()` on its API object | High | Detect via `Object.isFrozen()` pre-check; fall back to polling | âŒ Needs test |
| E3 | SDK calls `Object.seal()` on its API object | Medium | Detect via `Object.isSealed()` pre-check; sealed objects allow value changes but not new props â€” poll for new props | âŒ Needs test |
| E4 | SDK replaces entire root (`window.Stripe = newObj`) | High | Keep the `defineProperty` setter on `window` active (don't restore to normal descriptor) OR re-apply after first capture | âŒ Needs test |
| E5 | SDK checks `typeof window.Stripe` and behaves differently with getter | Medium | Getter should return `undefined` (not throw), mimicking absent property. Test with real SDKs. | âŒ Needs test |
| E6 | SDK uses `hasOwnProperty('Stripe')` on window | Medium | `Object.defineProperty` with `enumerable: true` should pass. Verify `'Stripe' in window` also works. | âŒ Needs test |
| E7 | React StrictMode double-mount causes duplicate traps | Medium | Reference-count trap installations; only remove trap when ref count hits 0 | âŒ Needs test |
| E8 | SSR / Node.js environment â€” no `window` | Low | Guard with `typeof window !== 'undefined'`; return no-op in SSR | âœ… Trivial |
| E9 | Property path has more than 2 levels (e.g., `Stripe.checkout.sessions.create`) | Medium | Recursively apply `Proxy` at each depth level via `get` trap that returns nested proxy | âŒ Needs design |
| E10 | Proxy `set` trap must return `true` or assignment throws in strict mode | Low | Always `return Reflect.set(...)` | âœ… Known |
| E11 | `Proxy` on frozen object's `get` trap must return same value as target (invariant) | High | Don't proxy frozen objects; use polling instead | âœ… Known from spec |
| E12 | Memory leaks from undisposed watchers | Medium | WeakRef for callbacks, or mandatory dispose pattern with React cleanup | âŒ Needs design |

---

## 7. Testing Strategy

### Unit Tests (Vitest + JSDOM)

- `Object.defineProperty` trap correctly intercepts `window.X = value`
- Proxy `set` trap fires for `window.X.child = value`
- Proxy `defineProperty` trap fires for `Object.defineProperty(window.X, 'child', ...)`
- Multiple subscribers receive independent notifications
- Dispose function fully cleans up (no lingering traps or listeners)
- Timeout option correctly rejects/resolves
- Strategy auto-detection: frozen â†’ poll, normal â†’ proxy
- SSR guard: no errors when `window` is undefined

### Integration Tests (Playwright / Real Browser)

- Load real Stripe.js and detect `window.Stripe` and `window.Stripe.elements`
- Load Google Maps SDK and detect `window.google.maps`
- Load two scripts that both write to `window.MySDK.a` and `window.MySDK.b` with artificial delays
- React StrictMode mount/unmount/remount cycle
- Rapid component mount/unmount (stress test for race conditions)

### Performance Benchmarks

- Proxy `set` trap overhead: 1K / 10K / 100K assignments vs. baseline
- Memory usage with 100 active watchers
- Time-to-detection comparison: Proxy vs. polling at 50ms vs. polling at 100ms

---

## 8. Open Questions for LLM Agent

> These are unresolved questions that should be addressed in the Technical Design Document.

1. **Should the package support watching properties on objects other than `window`?** (e.g., `document`, custom namespaces). This would generalise the API but add complexity.

2. **Should `useGlobal("Stripe.checkout")` auto-inject a `<script>` tag?** Or should script loading be a separate concern (use `useScript` from another package)?

3. **What is the right default timeout?** `Infinity` (wait forever) is dangerous in production. Should we default to 30s with a dev-mode warning?

4. **Should the polling fallback be automatic or opt-in?** If `auto` strategy detects a frozen object and silently falls back to polling, is that surprising? Should it log a warning?

5. **Deep path syntax**: Should we support `"Stripe.checkout.sessions"` (dot notation), `["Stripe", "checkout", "sessions"]` (array), or both?

6. **TypeScript generics**: Can we provide strong typing for known SDKs? e.g., `useGlobal<Stripe>("Stripe")` returns `Stripe | null` with full type inference?

7. **Re-entrancy**: If a subscriber's callback itself triggers another assignment to the watched object, should we queue notifications or allow re-entrant calls?

8. **Competing packages**: Should we benchmark against `react-script-hook`, `react-async-script`, and `@uidotdev/usehooks` useScript to demonstrate value-add?

---

## 9. Deliverable Expectations for LLM Agent

After reviewing this research brief, the LLM agent should produce:

1. **Validated Assumptions**: For each assumption (A1â€“A6), provide test code or reasoning confirming/denying the assumption.

2. **Resolved Open Questions**: For each question (1â€“8), provide a recommended decision with rationale.

3. **Technical Design Document** containing:
   - Final architecture diagram
   - Module-level design with interfaces and type signatures
   - Internal state machine for the GlobalWatcher lifecycle
   - Error handling strategy
   - Bundle size budget (target: <3KB gzipped)
   - Browser compatibility matrix
   - Migration guide from common alternatives

4. **Implementation Plan** with phases:
   - Phase 1: Core engine (`watchGlobal`, `waitForGlobal`)
   - Phase 2: React hooks (`useGlobal`, `useGlobals`)
   - Phase 3: Script injection integration
   - Phase 4: DevTools / debugging utilities
   - Phase 5: Documentation & examples

---

## 10. References

- MDN: Object.defineProperty â€” https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty
- MDN: Proxy handler.set â€” https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/set
- MDN: Proxy handler.defineProperty â€” https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/defineProperty
- MutationObserver performance â€” https://macarthur.me/posts/use-mutation-observer-to-handle-nodes-that-dont-exist-yet
- David Walsh waitFor pattern â€” https://davidwalsh.name/waitfor
- proxy-deep npm â€” https://www.npmjs.com/package/proxy-deep
- react-script-hook npm â€” https://www.npmjs.com/package/react-script-hook
- react-async-script npm â€” https://www.npmjs.com/package/react-async-script
- useHooks useScript â€” https://usehooks.com/usescript
- 30 Seconds of Code useScript â€” https://www.30secondsofcode.org/react/s/use-script/
- ES Discuss: Object.freeze + Proxy â€” https://esdiscuss.org/topic/object-freezing-proxies-should-freeze-or-throw
- Stack Overflow: Detect global variable set â€” https://stackoverflow.com/questions/38759116/how-can-i-detect-when-a-global-variable-is-set-in-javascript
- Stack Overflow: Nested Proxy on frozen object â€” https://stackoverflow.com/questions/44480550/es6-nested-proxy-for-get-on-frozen-object
- Stack Overflow: Proxy set vs defineProperty â€” https://stackoverflow.com/questions/62358094/javascript-proxy-set-vs-defineproperty
- requestIdleCallback â€” https://developer.chrome.com/blog/using-requestidlecallback
