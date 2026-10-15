---
name: windotwatchr-expert
description: "Use when integrating or contributing to windotwatchr: watchWindot, waitForWindot, useWatchWindot, auto/proxy/poll coverage, subscription events and correlation labels, once and Symbol.dispose/using lifetimes, timeout/retry/abort reasons, SSR and typed SDK patterns. Includes engine ownership and Bun/Vite/Vitest contributor checks."
license: MIT
compatibility: "Works with any AI coding agent that supports the Agent Skills specification."
metadata:
  author: juanpprieto
  version: "0.1.0"
argument-hint: "windotwatchr, watchWindot, waitForWindot, useWatchWindot, ww:ready, ww:timeout, ww:error, ww:warning, correlationId, proxy, poll, strategy, defineProperty, deleteProperty, descendant resolution, blocklist, timeout, retries, abort, signal, signal.reason, DOMException, TimeoutError, AbortError, once, Symbol.dispose, using, dispose, SSR, react, hook, stripe, payments, maps, analytics, sdk, third-party, window, global, watcher, observer, subscribe, callback, promise, microtask, frozen, sealed, polling, fallback, contribute, test, types"
---

# windotwatchr Expert

Usage and contributor guidance for [windotwatchr](https://github.com/juanpprieto/windotwatchr), which detects when watched `window.*` values satisfy a readiness predicate. These topics describe version 0.3.0, including its breaking changes from 0.2.0.

> **Root**: Repository root (where `package.json` with `"name": "windotwatchr"` lives)
> **Core engine**: `src/core/` — root traps, lazy proxies, subscription predicates, notification queue, shared polling and event dispatch
> **Public API**: `src/index.ts` — `watchWindot()`, `waitForWindot()`
> **React binding**: `src/react/` — `useWatchWindot()` hook
> **Types**: `src/types.ts` — shared interfaces and type exports
> **Examples**: `examples/nextjs/`, `examples/vite-react/` — commerce use case demos

## Core Principles

1. **Coverage is explicit** — auto combines assignment interception with persistent snapshot checks; proxy disables detection polling, and poll preserves raw SDK identity.
2. **SSR-safe** — Core APIs no-op or reject when `window` is absent. Imports use guarded checks; hook effects do not run during server rendering.
3. **Own the lifetime** — `watchWindot` returns a callable disposer; release it on cleanup. Waits settle once and release their registration. Hooks dispose on effect cleanup.
4. **Microtask delivery** — Callbacks are deferred and readiness is rechecked around ready-event listeners.
5. **Error isolation** — One subscriber throwing never breaks other subscribers on the same path.

## How to Use

Match the user's request to one or more topics using the routing table below and read the corresponding file(s). Multiple topics may be relevant for a single question.

## Topic Routing

| Keywords | Topic file |
|----------|-----------|
| `architecture`, `internals`, `engine`, `pipeline`, `registry`, `singleton`, `Reflect.set`, `double notification`, `receiver`, `target`, `WeakMap`, `proxy cache`, `dedup`, `how it works` | `topics/01-architecture-internals.md` |
| `API`, `watchWindot`, `waitForWindot`, `types`, `WatchWindotOptions`, `WatcherState`, `DisposeFunction`, `SubscriberCallback`, `generics`, `type parameter`, `exports`, `import`, `package` | `topics/02-api-surface-types.md` |
| `react`, `hook`, `useWatchWindot`, `WatchWindotResult`, `value`, `status`, `error`, `watching`, `ready`, `StrictMode`, `unmount`, `useState`, `useEffect`, `component`, `render` | `topics/03-react-hook.md` |
| `event`, `CustomEvent`, `ww:ready`, `ww:timeout`, `ww:error`, `ww:warning`, `addEventListener`, `dispatch`, `detail`, `payload`, `lifecycle` | `topics/04-events-system.md` |
| `strategy`, `proxy`, `poll`, `auto`, `defineProperty`, `trap`, `set trap`, `get trap`, `defineProperty trap`, `frozen`, `sealed`, `fallback`, `polling`, `lazy`, `nested`, `depth`, `hasDeepSubscribers` | `topics/05-detection-strategies.md` |
| `timeout`, `retries`, `retry`, `abort`, `AbortController`, `AbortSignal`, `signal`, `reject`, `promise`, `timer`, `cancel`, `dispose` | `topics/06-timeout-retry-abort.md` |
| `SSR`, `server`, `Node`, `Cloudflare`, `Vercel Edge`, `edge`, `hydration`, `window is not available`, `no-op`, `noop`, `Next.js`, `Remix` | `topics/07-ssr-safety.md` |
| `commerce`, `payment`, `Stripe`, `checkout`, `maps`, `analytics`, `pixel`, `SDK`, `third-party`, `script`, `use case`, `pattern`, `example`, `gotcha`, `DO`, `DON'T`, `mistake`, `best practice`, `tips` | `topics/08-commerce-patterns-gotchas.md` |
| `contribute`, `contributor`, `PR`, `test`, `testing`, `TSDoc`, `lint`, `build`, `module`, `dependency`, `resetRegistry`, `vitest`, `Bun`, `Vite`, `ESM`, `core`, `react binding` | `topics/09-contributing.md` |

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

## Instructions for coding agents

1. **Match the request** to one or more topics using the routing table above.
2. **Read the topic file(s)** before answering. Never answer from memory alone.
3. **Distinguish consumer vs contributor** questions — route accordingly.
4. **Show cleanup** — identify who owns the watch, wait, hook and SDK widget lifetime.
5. **SSR context matters** — explain server behavior when it affects the integration.
6. **Value types** — use `<T>` for an expected SDK type; explain that it does not validate runtime values. A readiness predicate must establish the needed API shape.
7. **Explain coverage** — raw writes, closure getters, locked objects and external readiness flags may require polling. Script loading does not establish API readiness.
8. **Gotchas first** — when reviewing code, check against known gotchas in topic 08.
9. **Test patterns** — when helping contributors, reference test utilities from topic 09.
10. **Events for diagnostics** — ready/error/timeout events are per subscription; global listeners must account for cardinality and caller-supplied duplicate labels.
