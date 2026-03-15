# API Surface & Types

## Public Exports

### `windotwatchr` (core)

```ts
import {
  watchWindot,           // Callback-based watcher
  waitForWindot,         // Promise-based watcher
} from 'windotwatchr';

import type {
  WatchWindotOptions,   // Configuration options
  WatcherState,          // 'idle' | 'watching' | 'ready' | 'timeout' | 'error'
  DisposeFunction,       // () => void
  SubscriberCallback,    // (value: T) => void
} from 'windotwatchr';
```

### `windotwatchr/react`

```ts
import { useWatchWindot } from 'windotwatchr/react';

import type { WatchWindotResult } from 'windotwatchr/react';
```

## Function Signatures

### `watchWindot<T>(path, callback, options?)`

```ts
function watchWindot<T = unknown>(
  path: string,
  callback: SubscriberCallback<T>,
  options?: WatchWindotOptions,
): DisposeFunction;
```

- **path**: Dot-notation path on `window` (e.g., `"Stripe.checkout"`)
- **callback**: Invoked with the resolved value when the readiness predicate passes
- **options**: Timeout, polling, readiness, signal, retries
- **returns**: Dispose function — call to stop watching and clean up
- **SSR**: Returns no-op `() => {}` in non-browser environments

```ts
// Basic usage:
const dispose = watchWindot<Stripe>('Stripe', (stripe) => {
  stripe.redirectToCheckout({ sessionId: '...' });
});

// With options:
const dispose = watchWindot('Stripe', callback, {
  timeout: 10_000,
  retries: 3,
  pollInterval: 200,
});

// Cleanup:
dispose();
```

### `waitForWindot<T>(path, options?)`

```ts
function waitForWindot<T = unknown>(
  path: string,
  options?: WatchWindotOptions,
): Promise<T>;
```

- **path**: Dot-notation path on `window`
- **options**: Same as `watchWindot`
- **returns**: Promise that resolves with the value, or rejects on timeout/abort
- **SSR**: Rejects immediately with `Error('windotwatchr: window is not available')`
- **Timeout rejection**: `Error('windotwatchr: timeout after ${ms}ms waiting for "${path}"')`
- **Abort rejection**: `Error('windotwatchr: aborted')`

```ts
// Basic:
const stripe = await waitForWindot<Stripe>('Stripe');

// With timeout:
try {
  const maps = await waitForWindot<typeof google.maps>('google.maps', {
    timeout: 5_000,
    retries: 2,
  });
} catch (err) {
  console.error('Maps failed to load:', err.message);
}

// With AbortSignal:
const ctrl = new AbortController();
const stripe = waitForWindot<Stripe>('Stripe', { signal: ctrl.signal });
ctrl.abort(); // rejects with "windotwatchr: aborted"
```

## Type Definitions

### `WatchWindotOptions`

```ts
interface WatchWindotOptions {
  /** Timeout in ms. No default — consumer must set explicitly. */
  timeout?: number;

  /** Polling fallback interval in ms. Default: 100. Set to 0 to disable. */
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
```

### `WatcherState`

```ts
type WatcherState = 'idle' | 'watching' | 'ready' | 'timeout' | 'error';
```

State machine: `watching` → `ready` | `timeout` | `error`

(`idle` is defined but not currently used in practice — watchers start at `watching`)

### `DisposeFunction`

```ts
type DisposeFunction = () => void;
```

Idempotent — safe to call multiple times.

### `SubscriberCallback<T>`

```ts
type SubscriberCallback<T = unknown> = (value: T) => void;
```

### `WatchWindotResult<T>` (React)

```ts
interface WatchWindotResult<T> {
  value: T | null;
  status: WatcherState;
  error: Error | null;
}
```

## Default Values

| Option | Default | Notes |
|--------|---------|-------|
| `timeout` | `undefined` (no timeout) | Must be set explicitly |
| `pollInterval` | `100` ms | Set to `0` to disable polling fallback |
| `strategy` | `'auto'` | Proxy first, poll if frozen/sealed |
| `signal` | `undefined` | No abort integration |
| `retries` | `0` | No retries |
| `ready` | `(v) => v !== null && v !== undefined` | Non-nullish check |

## Generic Type Parameter

All APIs accept `<T = unknown>`:

```ts
// Explicit type:
watchWindot<StripeCheckout>('Stripe.checkout', (checkout) => {
  // checkout is typed as StripeCheckout
});

// Inferred from callback:
watchWindot('Stripe', (stripe: Stripe) => {
  // T inferred as Stripe
});

// Promise:
const maps = await waitForWindot<GoogleMaps>('google.maps');
// maps is typed as GoogleMaps
```

## Package Exports Structure

```json
{
  ".": {
    "import": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "require": {
      "types": "./dist/index.d.cts",
      "default": "./dist/index.cjs"
    }
  },
  "./react": {
    "import": {
      "types": "./dist/react.d.ts",
      "default": "./dist/react.js"
    },
    "require": {
      "types": "./dist/react.d.cts",
      "default": "./dist/react.cjs"
    }
  }
}
```

**Critical**: `types` must come FIRST in each conditional export block (before `default`).
