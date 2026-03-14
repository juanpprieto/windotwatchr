---
name: windotwatchr-expert
description: "Expert for building with and contributing to windotwatchr — a zero-polling window.* property watcher. Covers the imperative API (watchWindot, waitForWindot), React hook (useWindotWatchr), event system (ww:ready, ww:timeout, ww:error, ww:warning), detection strategies (Proxy, poll, auto), timeout/retry/abort patterns, SSR safety, commerce use cases (payment SDKs, maps, analytics), type system, gotchas, and contributor workflows for both core engine and React binding."
argument-hint: "windotwatchr, watchWindot, waitForWindot, useWindotWatchr, ww:ready, ww:timeout, ww:error, ww:warning, proxy, poll, defineProperty, timeout, retries, abort, signal, dispose, SSR, react, hook, stripe, payments, maps, analytics, sdk, third-party, window, global, watcher, observer, subscribe, callback, promise, microtask, frozen, sealed, polling, fallback, contribute, test, types"
---

# windotwatchr Expert

Comprehensive guide for using and contributing to [windotwatchr](https://github.com/juanpprieto/windotwatchr) — a zero-polling, event-driven library for detecting when third-party scripts attach globals to `window.*`.

> **Root**: Repository root (where `package.json` with `"name": "windotwatchr"` lives)
> **Core engine**: `src/core/` — PropertyTrap, ProxyWrapper, SubscriptionManager, NotificationQueue, PollFallback, EventDispatcher
> **Public API**: `src/index.ts` — `watchWindot()`, `waitForWindot()`
> **React binding**: `src/react/` — `useWindotWatchr()` hook
> **Types**: `src/types.ts` — shared interfaces and type exports
> **Examples**: `examples/nextjs/`, `examples/vite-react/` — commerce use case demos

## Core Principles

1. **Zero-polling by default** — Proxy + defineProperty traps detect assignments synchronously. Polling is a fallback for frozen/sealed objects only.
2. **SSR-safe** — All APIs no-op or reject in non-browser environments. No `window` reference at import time.
3. **Dispose everything** — Every watcher returns a `DisposeFunction`. Always call it on cleanup.
4. **Microtask delivery** — Callbacks fire on the next microtask, never synchronously (no Zalgo).
5. **Error isolation** — One subscriber throwing never breaks other subscribers on the same path.

## How to Use

Match the user's request to one or more topics using the routing table below and read the corresponding file(s). Multiple topics may be relevant for a single question.

## Topic Routing

| Keywords | Topic file |
|----------|-----------|
| `architecture`, `internals`, `engine`, `pipeline`, `registry`, `singleton`, `Reflect.set`, `double notification`, `receiver`, `target`, `WeakMap`, `proxy cache`, `dedup`, `how it works` | `topics/01-architecture-internals.md` |
| `API`, `watchWindot`, `waitForWindot`, `types`, `WindotWatchrOptions`, `WatcherState`, `DisposeFunction`, `SubscriberCallback`, `generics`, `type parameter`, `exports`, `import`, `package` | `topics/02-api-surface-types.md` |
| `react`, `hook`, `useWindotWatchr`, `WindotWatchrResult`, `value`, `status`, `error`, `watching`, `ready`, `StrictMode`, `unmount`, `useState`, `useEffect`, `component`, `render` | `topics/03-react-hook.md` |
| `event`, `CustomEvent`, `ww:ready`, `ww:timeout`, `ww:error`, `ww:warning`, `addEventListener`, `dispatch`, `detail`, `payload`, `lifecycle` | `topics/04-events-system.md` |
| `strategy`, `proxy`, `poll`, `auto`, `defineProperty`, `trap`, `set trap`, `get trap`, `defineProperty trap`, `frozen`, `sealed`, `fallback`, `polling`, `lazy`, `nested`, `depth`, `hasDeepSubscribers` | `topics/05-detection-strategies.md` |
| `timeout`, `retries`, `retry`, `abort`, `AbortController`, `AbortSignal`, `signal`, `reject`, `promise`, `timer`, `cancel`, `dispose` | `topics/06-timeout-retry-abort.md` |
| `SSR`, `server`, `Node`, `Cloudflare`, `Vercel Edge`, `edge`, `hydration`, `window is not available`, `no-op`, `noop`, `Next.js`, `Remix` | `topics/07-ssr-safety.md` |
| `commerce`, `payment`, `Stripe`, `checkout`, `maps`, `analytics`, `pixel`, `SDK`, `third-party`, `script`, `use case`, `pattern`, `example`, `gotcha`, `DO`, `DON'T`, `mistake`, `best practice`, `tips` | `topics/08-commerce-patterns-gotchas.md` |
| `contribute`, `contributor`, `PR`, `test`, `testing`, `TSDoc`, `lint`, `build`, `module`, `dependency`, `resetRegistry`, `vitest`, `jsdom`, `core`, `react binding` | `topics/09-contributing.md` |

## Cross-References

| Topic | Related Patterns |
|-------|-----------------|
| Architecture (01) | Detection strategies (05), Events (04), Contributing (09) |
| API & Types (02) | React hook (03), Timeout/Retry (06), SSR (07) |
| React hook (03) | Events (04), SSR (07), Commerce patterns (08) |
| Events (04) | React hook (03), Architecture (01), Timeout/Retry (06) |
| Detection (05) | Architecture (01), Commerce patterns (08) |
| Timeout/Retry (06) | API (02), Commerce patterns (08) |
| SSR (07) | API (02), React hook (03) |
| Commerce/Gotchas (08) | All topics — practical application of everything |
| Contributing (09) | Architecture (01), all test patterns |

## Instructions for Claude

1. **Match the request** to one or more topics using the routing table above.
2. **Read the topic file(s)** before answering. Never answer from memory alone.
3. **Distinguish consumer vs contributor** questions — route accordingly.
4. **Always recommend dispose** — every code example should show cleanup.
5. **SSR context matters** — if the user is in Next.js/Remix, always mention SSR behavior.
6. **Type safety** — always use generic type parameter `<T>` in examples.
7. **No polling by default** — clarify that the library is zero-polling; polling is a fallback only.
8. **Gotchas first** — when reviewing code, check against known gotchas in topic 08.
9. **Test patterns** — when helping contributors, reference test utilities from topic 09.
10. **Events for orchestration** — recommend `ww:*` events for cross-component coordination.
