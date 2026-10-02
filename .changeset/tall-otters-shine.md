---
"windotwatchr": minor
---

Correctness and hardening pass for the detection core.

**Fixes**

- Wholesale root assignment (`window.SDK = { checkout }`) now resolves sub-path watchers that were registered before the SDK loaded. This was the most common real-world sequence and it previously hung with both the proxy and poll strategies.
- The `ready` predicate is enforced on every delivery route, not just the poll and already-exists paths. Two watchers on the same path each get their own predicate honored.
- Poll fallbacks are ref-counted, so disposing one of several watchers on a path no longer stops polling for the rest.
- A watcher disposed between the assignment and the microtask delivery no longer fires (fixes setState-after-unmount in the React hook).
- Disposing the last watcher no longer reverts `window[key]` to a stale pre-trap value, so an SDK's real assignment survives teardown (and StrictMode remounts).
- The poll chain survives a throwing getter, the proxy `set` trap only notifies on a successful write, and reserved `Window` built-ins (`document`, `location`, …) are forced onto the poll strategy instead of being trapped.

**New**

- `strategy` is implemented (`'auto' | 'proxy' | 'poll'`); `'poll'` never touches `window` and is the escape hatch for SDKs that break behind a Proxy.
- `once: true` auto-disposes after the first delivery.
- The dispose function implements `Symbol.dispose` for `using`.
- `waitForWindot` rejects timeouts with a `DOMException` named `TimeoutError` (with a named Error fallback when DOMException is unavailable) and forwards `signal.reason` on abort.
- `ww:*` events carry a correlation `id` and are typed on `WindowEventMap`.

**Behavior changes to note**

- Callbacks that previously fired with not-ready values (including `null`/`undefined`) no longer fire — the predicate now gates them. If you relied on that, widen your `ready`.
- `waitForWindot` rejection types changed: `TimeoutError`/`AbortError` `DOMException`s and `signal.reason` instead of generic `Error` messages.
- `ww:ready`/`ww:timeout`/`ww:error` details gained an `id` field, and the React hook derives `ready` from the callback rather than the `ww:ready` event.
- `strategy` was declared but inert in 0.2.0 (any value behaved as `'auto'`). It now works, so a watcher that already passed `strategy: 'poll'` or `'proxy'` changes behavior.

- This pre-1.0 minor increment includes breaking behavior changes; it does not promise backward compatibility.
- Enabled auto/poll detection continues until disposal, independently of timeout/retry exhaustion. Poll/interception roots reject conflicting joins; auto/proxy joins remain compatible.
- Intercepted equal-value writes remain separate occurrences; equal poll snapshots are suppressed until a readiness transition. Ready events are per subscription, so global listeners may see more events than in 0.2.0.
- Invalid numeric delays/retry counts fail before allocation. Positive fractional delays remain supported through cancellable timers; explicit abort reasons, including null and false, are preserved exactly.
- Hooks track private lifecycle observers, update inline predicates without render loops, reset on other option changes, and become idle after abort.
- Ordinary declarations need no global Disposable type. Core/React entries share one ESM dependency graph.
- CommonJS exports are removed. Use ESM imports or asynchronous dynamic import; synchronous require is unsupported. This is a breaking package-format change from 0.2.0.
- Tooling uses Bun, Vite and Vitest with real browser tests. Key dependencies and example React/React DOM are refreshed to the latest stable versions, including React 19.3.
