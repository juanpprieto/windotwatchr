import type { DisposeFunction, SubscriberCallback, WatchGlobalOptions } from './types.js';
import { watch } from './core/global-watcher.js';

export type {
  DisposeFunction,
  SubscriberCallback,
  WatcherState,
  WatchGlobalOptions,
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
 * @param options - Configuration for polling, readiness predicate, etc.
 * @returns Dispose function to remove this subscription.
 *
 * @example
 * ```ts
 * import { watchGlobal } from 'windotwatchr';
 *
 * const dispose = watchGlobal<StripeCheckout>('Stripe.checkout', (checkout) => {
 *   checkout.redirectToCheckout({ sessionId: '...' });
 * });
 *
 * // Cleanup:
 * dispose();
 * ```
 *
 * @example
 * ```ts
 * // With AbortSignal (supported in options, handled in future release):
 * const ctrl = new AbortController();
 * watchGlobal('google.maps', callback, { signal: ctrl.signal });
 * ctrl.abort(); // equivalent to dispose()
 * ```
 *
 * @example
 * ```ts
 * // Custom readiness predicate:
 * watchGlobal('MySDK', callback, {
 *   ready: (v) => typeof v === 'object' && v !== null && 'init' in v,
 * });
 * ```
 */
export function watchGlobal<T = unknown>(
  path: string,
  callback: SubscriberCallback<T>,
  options?: WatchGlobalOptions,
): DisposeFunction {
  if (!isBrowser) {
    return noop;
  }
  return watch(path, callback as SubscriberCallback, options);
}

/**
 * Promise-based variant of {@link watchGlobal}.
 *
 * Resolves when the value at `path` passes the readiness predicate.
 * Automatically disposes the internal watcher on resolution.
 *
 * In non-browser environments (Node.js, Cloudflare Workers, Vercel Edge),
 * rejects immediately with an `Error`. This prevents silent hangs from
 * `await waitForGlobal('Stripe')` in SSR contexts where there is no
 * timeout default.
 *
 * @typeParam T - The expected type of the resolved value.
 * @param path - Dot-notation path on `window` (e.g., `"Stripe.checkout"`).
 * @param options - Configuration for polling, readiness predicate, etc.
 * @returns Promise that resolves with the value at `path`.
 *
 * @example
 * ```ts
 * import { waitForGlobal } from 'windotwatchr';
 *
 * const maps = await waitForGlobal<typeof google.maps>('google.maps');
 * const map = new maps.Map(element, { center, zoom: 12 });
 * ```
 *
 * @example
 * ```ts
 * // With timeout (handled in future release):
 * const stripe = await waitForGlobal<Stripe>('Stripe', {
 *   timeout: 10_000,
 *   retries: 3,
 * });
 * ```
 */
export function waitForGlobal<T = unknown>(
  path: string,
  options?: WatchGlobalOptions,
): Promise<T> {
  if (!isBrowser) {
    return Promise.reject(
      new Error('windotwatchr: window is not available'),
    );
  }

  return new Promise<T>((resolve) => {
    const dispose = watch(
      path,
      (value) => {
        dispose();
        resolve(value as T);
      },
      options,
    );
  });
}
