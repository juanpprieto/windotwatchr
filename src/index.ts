import type { DisposeFunction, SubscriberCallback, WatchWindotOptions } from './types.js';
import { watch } from './core/windot-watcher.js';
import { validateOptions } from './core/options.js';
import { runtimeState } from './core/runtime-state.js';

export type {
  DisposeFunction,
  SubscriberCallback,
  WatcherState,
  WatchWindotOptions,
} from './types.js';
export type {
  WwReadyDetail,
  WwTimeoutDetail,
  WwErrorDetail,
  WwWarningDetail,
} from './events.js';

/**
 * Dispose function that also implements the Explicit Resource Management
 * protocol, so it works with `using`:
 *
 * ```ts
 * using watcher = watchWindot('Stripe', onReady);
 * // auto-disposed at end of scope
 * ```
 *
 * Calling it directly (`watcher()`) still works for non-`using` callers.
 */
export type DisposableWatcher = DisposeFunction & { [Symbol.dispose](): void };

/**
 * Whether the current environment has a `window` global.
 * `false` in Node.js, Cloudflare Workers, Vercel Edge, etc.
 */
const isBrowser = typeof window !== 'undefined';

/**
 * Attach the `[Symbol.dispose]` protocol to a dispose function so it can be
 * used with `using`. Guarded for runtimes without `Symbol.dispose`.
 *
 * @param dispose - The plain dispose function.
 * @returns The same function with the disposal protocol when the runtime supports it.
 */
function asDisposable(dispose: DisposeFunction): DisposableWatcher {
  const d = dispose as DisposableWatcher;
  if (typeof Symbol !== 'undefined' && Symbol.dispose) {
    d[Symbol.dispose] = () => { dispose(); };
  }
  return d;
}

/** No-op dispose function returned in non-browser environments. */
const noop: DisposableWatcher = asDisposable(() => {});

/**
 * Build the rejection error for a `waitForWindot` timeout.
 *
 * Uses a `DOMException` with name `"TimeoutError"` to align with
 * `AbortSignal.timeout()` conventions where available; falls back to a
 * plain `Error` in older runtimes.
 *
 * @param path - The watched path.
 * @param timeout - The elapsed timeout in ms.
 * @returns The error to reject with.
 */
function makeTimeoutError(path: string, timeout: number): Error {
  const message = `windotwatchr: timeout after ${timeout}ms waiting for "${path}"`;
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'TimeoutError');
  }
  return Object.assign(new Error(message), { name: 'TimeoutError' });
}

/**
 * Build the rejection error for a `waitForWindot` abort with no explicit
 * `signal.reason`. Mirrors the `DOMException` `AbortError` that
 * `AbortController.abort()` produces by default.
 *
 * @returns The error to reject with.
 */
function makeAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('windotwatchr: aborted', 'AbortError');
  }
  return Object.assign(new Error('windotwatchr: aborted'), { name: 'AbortError' });
}

/**
 * Watch a `window` property path for a value to appear.
 *
 * Installs an `Object.defineProperty` trap on `window` for the root key
 * and wraps assigned objects in an ES6 `Proxy` to intercept nested
 * property assignments. Enabled auto/poll checks also sample snapshots.
 * Callback runs in a microtask after readiness is checked, with another
 * check after ready-event listener reentrancy.
 *
 * In non-browser environments (Node.js, Cloudflare Workers, Vercel Edge),
 * returns a no-op dispose function immediately. The callback is never invoked.
 *
 * @typeParam T - The expected type of the resolved value.
 * @param path - Dot-notation path on `window` (e.g., `"Stripe.checkout"`).
 * @param callback - Invoked with the resolved value when ready.
 * @param options - Configuration for timeout, polling, readiness, signal, etc.
 * @returns Dispose function to remove this subscription.
 *
 * @example
 * ```ts
 * import { watchWindot } from 'windotwatchr';
 *
 * const dispose = watchWindot<StripeCheckout>('Stripe.checkout', (checkout) => {
 *   checkout.redirectToCheckout({ sessionId: '...' });
 * });
 *
 * // Cleanup:
 * dispose();
 * ```
 *
 * @example
 * ```ts
 * // With timeout and retries:
 * watchWindot('Stripe', callback, {
 *   timeout: 10_000,
 *   retries: 3,
 * });
 * ```
 *
 * @example
 * ```ts
 * // With AbortSignal — abort() is equivalent to dispose():
 * const ctrl = new AbortController();
 * watchWindot('google.maps', callback, { signal: ctrl.signal });
 * ctrl.abort();
 * ```
 *
 * @example
 * ```ts
 * // Custom readiness predicate:
 * watchWindot('MySDK', callback, {
 *   ready: (v) => typeof v === 'object' && v !== null && 'init' in v,
 * });
 * ```
 */
export function watchWindot<T = unknown>(
  path: string,
  callback: SubscriberCallback<T>,
  options?: WatchWindotOptions,
): DisposableWatcher {
  if (!isBrowser) {
    return noop;
  }
  return asDisposable(watch(path, callback as SubscriberCallback, options));
}

/**
 * Promise-based variant of `watchWindot`.
 *
 * Resolves when the value at `path` passes the readiness predicate.
 * Automatically disposes the internal watcher on resolution.
 *
 * Rejects with a TimeoutError DOMException (Error fallback) after timeout
 * and retries. Abort rejects with the exact signal.reason, including null.
 * Cancellable manual timers preserve fractional input and cleanup semantics.
 *
 * In non-browser environments (Node.js, Cloudflare Workers, Vercel Edge),
 * rejects immediately with an `Error`. This prevents silent hangs from
 * `await waitForWindot('Stripe')` in SSR contexts where there is no
 * timeout default.
 *
 * @typeParam T - The expected type of the resolved value.
 * @param path - Dot-notation path on `window` (e.g., `"Stripe.checkout"`).
 * @param options - Configuration for timeout, polling, readiness, signal, etc.
 * @returns Promise that resolves with the value at `path`, or rejects on timeout/abort.
 *
 * @example
 * ```ts
 * import { waitForWindot } from 'windotwatchr';
 *
 * const maps = await waitForWindot<typeof google.maps>('google.maps');
 * const map = new maps.Map(element, { center, zoom: 12 });
 * ```
 *
 * @example
 * ```ts
 * // With timeout — rejects if Stripe doesn't load within 10 seconds:
 * const stripe = await waitForWindot<Stripe>('Stripe', {
 *   timeout: 10_000,
 *   retries: 3,
 * });
 * ```
 *
 * @example
 * ```ts
 * // With AbortSignal — rejects on abort:
 * const ctrl = new AbortController();
 * const stripe = waitForWindot<Stripe>('Stripe', { signal: ctrl.signal });
 * ctrl.abort(); // rejects with signal.reason
 * ```
 */
export function waitForWindot<T = unknown>(
  path: string,
  options?: WatchWindotOptions,
): Promise<T> {
  if (!isBrowser) {
    return Promise.reject(
      new Error('windotwatchr: window is not available'),
    );
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let dispose: DisposeFunction | undefined;
    const signal = options?.signal;
    const abortReason = (): unknown => signal && 'reason' in signal ? signal.reason : makeAbortError();
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort);
      dispose?.();
    };
    const settleReject = (error: unknown): void => {
      if (settled) {return;}
      settled = true;
      cleanup();
      reject(error);
    };
    const settleResolve = (value: unknown): void => {
      if (settled) {return;}
      settled = true;
      cleanup();
      resolve(value as T);
    };
    const onAbort = (): void => settleReject(abortReason());
    try {
      validateOptions(options ?? {});
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      const { signal: _signal, ...watchOptions } = options ?? {};
      dispose = watch(path, settleResolve, {
        ...watchOptions, correlationId: options?.correlationId ?? `ww_wait_${++runtimeState.sequence}`,
      }, { timeout: detail => {
        if (detail.attempts >= (options?.retries ?? 0)) {settleReject(makeTimeoutError(path, options!.timeout!));}
      } });
      if (settled) {dispose();}
      else if (signal?.aborted) {onAbort();}
    } catch (error) { settleReject(error); }
  });
}
