# Timeout, Retry & Abort

## Timeout

Set via `options.timeout` (ms). No default — must be explicit.

### In `watchWindot`

Timeout fires a `ww:timeout` event but does NOT call the callback or dispose the watcher. The watcher stays active — the SDK may still load later.

```ts
watchWindot('Stripe', (stripe) => {
  // Still fires if Stripe loads after timeout
}, { timeout: 5_000 });

window.addEventListener('ww:timeout', (e: CustomEvent) => {
  if (e.detail.path === 'Stripe') {
    showFallbackUI();
  }
});
```

### In `waitForWindot`

Timeout rejects the Promise after all retries are exhausted.

```ts
try {
  const stripe = await waitForWindot<Stripe>('Stripe', {
    timeout: 5_000,
  });
} catch (err) {
  // err.message: "windotwatchr: timeout after 5000ms waiting for \"Stripe\""
}
```

### Difference Summary

| Behavior | `watchWindot` | `waitForWindot` |
|----------|--------------|-----------------|
| On timeout | `ww:timeout` event | `ww:timeout` event |
| Callback/Promise | Stays active | Rejects |
| Watcher lifecycle | Continues watching | Auto-disposes |

## Retries

Set via `options.retries` (default: `0`). Retries attempt to resolve the path via polling after the initial timeout.

```ts
watchWindot('Stripe', callback, {
  timeout: 3_000,
  retries: 2,          // 2 additional attempts after initial timeout
  pollInterval: 200,   // Retry check interval
});
```

### Retry Flow

```
t=0        → watch() starts
t=3000     → timeout fires → ww:timeout event (attempts=0)
             └─ retry check: resolvePath(window, 'Stripe')
               ├─ predicate passes → ww:ready → callback → done
               └─ predicate fails → schedule retry
t=3200     → retry check (attempts=1)
             └─ ww:timeout event (attempts=1)
               ├─ predicate passes → ww:ready → callback → done
               └─ predicate fails → schedule retry
t=3400     → retry check (attempts=2)
             └─ ww:timeout event (attempts=2)
               ├─ predicate passes → callback → done
               └─ predicate fails → no more retries → done (watchWindot stays active)
                                                        or reject (waitForWindot)
```

### Retry Interval

Uses `options.pollInterval` for spacing between retry checks. If `pollInterval` is `0`, falls back to the `DEFAULT_POLL_INTERVAL` (100ms) for retries.

## AbortSignal

Ties the watcher lifecycle to an `AbortController`.

### In `watchWindot`

```ts
const ctrl = new AbortController();

const dispose = watchWindot('Stripe', callback, {
  signal: ctrl.signal,
});

// These are equivalent:
ctrl.abort();  // Disposes the watcher
dispose();     // Also disposes the watcher
```

- Already-aborted signal → `dispose()` called immediately
- Abort listener added with `{ once: true }`
- Abort listener cleaned up on manual dispose

### In `waitForWindot`

```ts
const ctrl = new AbortController();

try {
  const stripe = await waitForWindot<Stripe>('Stripe', {
    signal: ctrl.signal,
  });
} catch (err) {
  // err.message: "windotwatchr: aborted"
}

// Somewhere else:
ctrl.abort(); // Rejects the promise
```

- Abort clears timeout timers and disposes the internal watcher
- Already-aborted signal → Promise rejects immediately

## Combining All Three

```ts
const ctrl = new AbortController();

try {
  const stripe = await waitForWindot<Stripe>('Stripe', {
    timeout: 5_000,
    retries: 3,
    signal: ctrl.signal,
  });
  stripe.redirectToCheckout({ sessionId: '...' });
} catch (err) {
  if (err.message.includes('aborted')) {
    console.log('User navigated away');
  } else if (err.message.includes('timeout')) {
    console.log('Stripe failed to load after retries');
  }
}

// Route change cleanup:
ctrl.abort();
```

## Timer Cleanup

Both `watchWindot` and `waitForWindot` clear all timers on resolution, abort, or dispose:

```ts
const dispose = () => {
  if (disposed) return;
  disposed = true;
  if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
  if (retryId) { clearTimeout(retryId); retryId = null; }
  // ... cleanup subscriptions
};
```

## Early Resolution

If the value already exists when `watch()` is called (late mount), the timeout timer is set but the callback also fires on next microtask. When the wrapped callback fires (with timeout enabled), it clears timeout/retry timers:

```ts
const effectiveCallback = hasTimeout
  ? (value) => {
      resolved = true;
      if (timeoutId) { clearTimeout(timeoutId); }
      if (retryId) { clearTimeout(retryId); }
      callback(value);
    }
  : callback;
```
