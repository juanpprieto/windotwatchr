import type { SubscriberCallback } from '../types.js';

/**
 * Microtask scheduler with fallback for older environments.
 *
 * Uses `queueMicrotask` when available (Chrome 71+, Firefox 69+, Safari 12.1+).
 * Falls back to `Promise.resolve().then()` for older browsers.
 *
 * @example
 * ```ts
 * schedule(() => console.log('runs on next microtask'));
 * ```
 */
const schedule: (fn: () => void) => void =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);

/**
 * Notify a set of subscribers asynchronously via microtask.
 *
 * Each callback is isolated in a `try/catch` — one subscriber throwing
 * never breaks other subscribers on the same path.
 *
 * The subscriber set is snapshot before scheduling to avoid issues
 * if a callback causes subscribe/unsubscribe during iteration.
 *
 * @param subscribers - Set of callbacks to invoke with the resolved value.
 * @param _path - Dot-notation path that resolved (e.g., `"Stripe.checkout"`).
 *   Reserved for `ww:error` CustomEvent detail.
 * @param value - The resolved value at the watched path.
 *
 * @example
 * ```ts
 * const subs = new Set<SubscriberCallback>([
 *   (v) => console.log('subscriber A got', v),
 *   (v) => console.log('subscriber B got', v),
 * ]);
 * notifySubscribers(subs, 'Stripe.checkout', stripeCheckoutObj);
 * // Both callbacks fire on next microtask, independently.
 * ```
 */
export function notifySubscribers(
  subscribers: Set<SubscriberCallback>,
  _path: string,
  value: unknown,
): void {
  const snapshot = [...subscribers];
  schedule(() => {
    for (const callback of snapshot) {
      try {
        callback(value);
      } catch {
        // TODO: dispatch ww:error CustomEvent with { path, error }
      }
    }
  });
}
