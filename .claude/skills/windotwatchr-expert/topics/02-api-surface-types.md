# Public API and types

```ts
import { watchWindot, waitForWindot } from 'windotwatchr';
import type { DisposableWatcher, WatchWindotOptions, WatcherState } from 'windotwatchr';
import { useWatchWindot } from 'windotwatchr/react';
```

watchWindot<T>(path, callback, options?) returns a callable disposer, with Symbol.dispose when available. waitForWindot<T> returns a promise and releases its own registration on success, final timeout or abort. The hook returns value: T | null, status and error: Error | null.

Default readiness is non-nullish: false, zero and empty strings pass. A custom predicate must be synchronous and side-effect-free and can run repeatedly around delivery. Existence alone does not prove an SDK is initialized.

Options: timeout (disabled by default), pollInterval (100 ms, zero disables), strategy (auto/proxy/poll), signal, retries (zero), ready, once (false), and correlationId. Delays must be finite numbers between zero and 2,147,483,647; positive fractions round up. Retry counts must be integers within those bounds. Invalid setup fails before allocating resources.

Ordinary strict consumers need ES2020 and DOM types without a global Disposable interface. Using syntax additionally requires a compiler supporting explicit resource management, ESNext.Disposable and runtime Symbol.dispose or a prior polyfill. Event detail types are exported from both core and React entries and augment WindowEventMap.

The package declares Node >=18 and optional React >=16.8. Keep advertised ranges separate from the exact versions actually validated. Pre-1.0 minor-number changes can include deliberate breaking behavior; read README migration notes.
