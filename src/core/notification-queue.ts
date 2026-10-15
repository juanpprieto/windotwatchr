import type { Subscription } from './subscription-manager.js';
import { checkReadiness } from './subscription-manager.js';
import { dispatchWatcherEvent } from './event-dispatcher.js';
import { unwrapProxy } from './proxy-identity.js';

function canDeliver(sub: Subscription, path: string, value: unknown): boolean {
  if (sub.disposed) {return false;}
  if (sub.delivery === 'latest' && (!sub.observedReady || !Object.is(sub.observedValue, unwrapProxy(value)))) {
    return false;
  }
  return checkReadiness(sub, path, value);
}

/**
 * A single scheduled delivery: one value, to one subscription, tagged with
 * the path that resolved it (which may differ from the subscription's own
 * path when descendant resolution splits a parent assignment).
 */
export interface Delivery {
  /** The subscription to deliver to. */
  sub: Subscription;
  /** The dot-notation path that resolved (used in the `ww:ready` detail). */
  path: string;
  /** The resolved value to hand the callback. */
  value: unknown;
}

/**
 * Schedule a batch of deliveries on the next microtask.
 *
 * The batch is snapshot synchronously (callers may pass an array they mutate),
 * then delivered one microtask later. At delivery time, each subscription is
 * re-checked so late state changes are honored:
 *
 * - **Disposed** subscriptions are skipped — a `dispose()` that lands between
 *   `notify()` and delivery suppresses the callback (no post-dispose fire, no
 *   setState-after-unmount).
 * - Readiness is checked before the event and again after event reentrancy.
 * - Snapshot deduplication belongs to the subscription observation model;
 *   distinct intercepted writes remain distinct even for equal values.
 *
 * Each callback runs in its own `try/catch` — one subscriber throwing never
 * breaks the others. Every `ww:ready`/`ww:error` event carries the
 * subscription's correlation `id` so listeners can distinguish watchers on
 * the same path.
 *
 * @param deliveries - Deliveries to schedule. An empty array is a no-op.
 *
 * @example
 * ```ts
 * scheduleDeliveries([{ sub, path: 'Stripe.checkout', value: checkoutObj }]);
 * // sub.callback(checkoutObj) fires on the next microtask, unless disposed.
 * ```
 */
export function scheduleDeliveries(deliveries: Delivery[]): void {
  if (deliveries.length === 0) {
    return;
  }
  const snapshot = deliveries.slice();
  queueMicrotask(() => {
    for (const { sub, path, value } of snapshot) {
      if (!canDeliver(sub, path, value)) {continue;}
      dispatchWatcherEvent('ww:ready', { path, value, id: sub.id });
      if (!canDeliver(sub, path, value)) {continue;}
      try {
        sub.callback(value);
      } catch (error) {
        dispatchWatcherEvent('ww:error', { path, error, id: sub.id });
        sub.observers?.error?.(error);
      }
    }
  });
}
