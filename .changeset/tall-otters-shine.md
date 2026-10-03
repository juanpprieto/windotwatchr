---
"windotwatchr": minor
---

Make readiness checks consistent across interception and polling, preserve SDK
state during cleanup, and ship ESM-only core and React entries.

**Breaking changes from 0.2.0**

This pre-1.0 minor-number increment includes breaking changes.

- CommonJS exports are removed. Use ESM imports or asynchronous dynamic import;
  synchronous `require()` is unsupported. Core and React entries share one ESM
  dependency graph.
- `strategy` now affects detection; it was declared but ignored in 0.2.0.
  Enabled `auto`/`poll` checks continue until disposal. A poll registration
  cannot share a root with interception; conflicting joins reject without
  disturbing existing subscriptions. `auto` and `proxy` can share a root.
- Readiness predicates gate every delivery route. Values rejected by a
  subscriber's predicate no longer reach its callback. The non-nullish default
  accepts `false`, `0` and empty strings; a custom predicate can change that.
- Ready events are per subscription. Two subscribers can produce two events
  for one assignment, so global listeners may need to avoid duplicate work.
- Timeout rejection uses a `TimeoutError` DOMException, or an Error with that
  name when DOMException is unavailable. Abort preserves `signal.reason`
  exactly, including `null` and `false`; signals without a reason use
  `AbortError`. Catch handlers must allow reasons that are not Errors.
- Invalid numeric delays and retry counts fail before resources are allocated.
  Delays must be finite and within 0 through 2,147,483,647 ms; positive fractions
  round up. Retry counts must be integers in that range. Zero disables the
  corresponding deadline or detection polling; explicit retries still run.
- Hooks update readiness predicates in place, reset on other option changes,
  clear values on observed readiness loss or detection errors, and become idle
  after abort. They use private lifecycle observers rather than global events.

**Detection and cleanup fixes**

- Pre-registered descendants resolve when a root or middle namespace arrives
  whole, including callable SDK roots with child APIs.
- Each subscription evaluates its own predicate. Shared polls continue for
  remaining members after another subscriber disposes.
- Disposing between assignment and microtask delivery suppresses the callback.
  A ready-event listener can also dispose or invalidate the pending delivery.
- Last disposal restores the latest raw root when the installed descriptor is
  still owned and configurable. External replacements survive cleanup. Locked
  installed accessors return raw data after disposal; previously handed-out
  proxies remain proxies.
- Getter and predicate failures are isolated from successful SDK writes and
  healthy subscriptions. Detection errors report once per consecutive failure
  episode, resetting after a successful check.
- Only successful native mutations notify. Locked child descriptors preserve
  Proxy invariants. Reserved Window built-ins use polling and retain raw
  identity.
- Distinct intercepted equal-value assignments remain separate occurrences.
  Equal poll snapshots are suppressed until an observed readiness transition.
  Mutations entirely between polls cannot be reconstructed.
- Persistent watchers retain detection after timeout and retry exhaustion;
  waits release their own resources on success, final timeout or abort.

**Added APIs and tooling**

- `strategy: 'poll'` reads watched values without installing accessors or
  proxies. Use it when an SDK requires raw object identity or receivers.
- `once: true` disposes after the first callback, even if that callback throws.
- Disposers implement `Symbol.dispose` when the runtime provides it. `using`
  requires that symbol or a prior polyfill and a scope that stays open until
  readiness. Ordinary declarations need no global Disposable type.
- Ready and timeout events carry `id`; error detail declares `id?`. Root-wide
  warnings carry `{ path, reason }` without a subscription ID. Event details are
  typed on `WindowEventMap` from both public entries.
- Tooling uses Bun, Vite and Vitest with real browser tests. The dependency
  inventory dated 2026-10-03 records React/React DOM 19.3.0 and the selected
  stable tooling versions; minimum/current consumer checks remain release gates.
