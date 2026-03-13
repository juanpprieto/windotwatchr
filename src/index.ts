import type { DisposeFunction, SubscriberCallback, WindotWatchrOptions } from './types.js';
import { DEFAULT_POLL_INTERVAL, defaultReadyPredicate } from './types.js';
import { dispatchWatcherEvent } from './core/event-dispatcher.js';
import { watch } from './core/windot-watcher.js';
import { resolvePath } from './core/poll-fallback.js';

export type {
  DisposeFunction,
  SubscriberCallback,
  WatcherState,
  WindotWatchrOptions,
} from './types.js';

/**
 * Whether the current environment has a `window` global.
 * `false` in Node.js, Cloudflare Workers, Vercel Edge, etc.
 */
const isBrowser = typeof window !== 'undefined';

/** No-op dispose function returned in non-browser environments. */
const noop: DisposeFunction = () => {};

/**
 * Watch a `window` property path for a value to appear.
 *
 * Installs an `Object.defineProperty` trap on `window` for the root key
 * and wraps assigned objects in an ES6 `Proxy` to intercept nested
 * property assignments. Callback fires on the exact tick the value
 * passes the readiness predicate.
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
  options?: WindotWatchrOptions,
): DisposeFunction {
  if (!isBrowser) {
    return noop;
  }
  return watch(path, callback as SubscriberCallback, options);
}

/**
 * Promise-based variant of `watchWindot`.
 *
 * Resolves when the value at `path` passes the readiness predicate.
 * Automatically disposes the internal watcher on resolution.
 *
 * When `options.timeout` is set, rejects with a descriptive `Error`
 * after the timeout expires (plus any retries). When `options.signal`
 * is set, rejects with `"windotwatchr: aborted"` on abort.
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
 * ctrl.abort(); // rejects with "windotwatchr: aborted"
 * ```
 */
export function waitForWindot<T = unknown>(
  path: string,
  options?: WindotWatchrOptions,
): Promise<T> {
  if (!isBrowser) {
    return Promise.reject(
      new Error('windotwatchr: window is not available'),
    );
  }

  const timeout = options?.timeout;
  const retries = options?.retries ?? 0;
  const signal = options?.signal;

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    // Strip timeout/retries/signal from options passed to watch() —
    // waitForWindot handles its own timeout/retry to control the Promise.
    const { timeout: _t, retries: _r, signal: _s, ...watchOptions } = options ?? {};

    /** Clean up abort listener when settling via any path. */
    const cleanup = (): void => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const dispose = watch(
      path,
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) { clearTimeout(timeoutId); }
        cleanup();
        dispose();
        resolve(value as T);
      },
      watchOptions,
    );

    // --- Timeout + Retry ---
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (timeout !== undefined && timeout > 0) {
      const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
      const predicate = options?.ready ?? defaultReadyPredicate;
      let retryCount = 0;

      const onTimeout = (): void => {
        if (settled) {
          return;
        }

        dispatchWatcherEvent('ww:timeout', { path, attempts: retryCount, elapsed: timeout });

        if (retryCount < retries) {
          retryCount++;
          const value = resolvePath(window, path);
          if (predicate(value)) {
            settled = true;
            cleanup();
            dispose();
            resolve(value as T);
            return;
          }
          const retryInterval = pollInterval > 0 ? pollInterval : DEFAULT_POLL_INTERVAL;
          timeoutId = setTimeout(onTimeout, retryInterval);
          return;
        }

        settled = true;
        cleanup();
        dispose();
        reject(new Error(`windotwatchr: timeout after ${timeout}ms waiting for "${path}"`));
      };

      timeoutId = setTimeout(onTimeout, timeout);
    }

    // --- AbortSignal ---
    let onAbort: (() => void) | null = null;

    if (signal) {
      onAbort = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) { clearTimeout(timeoutId); }
        dispose();
        reject(new Error('windotwatchr: aborted'));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
