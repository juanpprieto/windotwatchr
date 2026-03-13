import type { DisposeFunction, SubscriberCallback } from '../types.js';
import { notifySubscribers } from './notification-queue.js';

/**
 * Manages subscriptions from dot-notation paths to subscriber callbacks.
 *
 * One SubscriptionManager exists per root key (e.g., `"Stripe"`).
 * Multiple watchers on `"Stripe.checkout"` and `"Stripe.elements"` share
 * the same SubscriptionManager instance.
 *
 * @example
 * ```ts
 * const mgr = new SubscriptionManager();
 *
 * const dispose = mgr.subscribe('Stripe.checkout', (value) => {
 *   console.log('checkout ready:', value);
 * });
 *
 * // When Proxy set trap fires for "Stripe.checkout":
 * mgr.notify('Stripe.checkout', checkoutObj);
 *
 * // Cleanup:
 * dispose();
 * ```
 */
export class SubscriptionManager {
  /**
   * Map from exact dot-path to its subscriber callbacks.
   * Lookup is O(1) via `Map.get()`.
   *
   * @example
   * ```
   * "Stripe"           → Set<cb1, cb2>
   * "Stripe.checkout"  → Set<cb3>
   * "Stripe.elements"  → Set<cb4, cb5>
   * ```
   */
  private subscribers = new Map<string, Set<SubscriberCallback>>();

  /**
   * Set of all ancestor prefixes derived from subscriber paths.
   * Used by ProxyWrapper's `get` trap to decide whether to create
   * a nested proxy at a given depth.
   *
   * When a subscriber registers for `"Stripe.checkout.sessions"`,
   * this set contains `"Stripe"` and `"Stripe.checkout"` — but NOT
   * `"Stripe.checkout.sessions"` itself (that's a leaf, not a prefix).
   *
   * @example
   * ```ts
   * // After subscribe("Stripe.checkout.sessions", cb):
   * mgr.hasDeepSubscribers("Stripe");           // true
   * mgr.hasDeepSubscribers("Stripe.checkout");   // true
   * mgr.hasDeepSubscribers("Stripe.checkout.sessions"); // false (leaf)
   * ```
   */
  private deepPrefixes = new Map<string, number>();

  /**
   * Register a callback for a dot-notation path.
   *
   * Returns a dispose function that removes this specific subscription.
   * When the last subscriber for a path disposes, the path entry is
   * cleaned up from the Map.
   *
   * @param path - Dot-notation path to watch (e.g., `"Stripe.checkout"`).
   * @param callback - Invoked with the resolved value when the path is ready.
   * @returns Dispose function to remove this subscription.
   *
   * @example
   * ```ts
   * const dispose = mgr.subscribe('Stripe.checkout', (checkout) => {
   *   checkout.redirectToCheckout({ sessionId: '...' });
   * });
   *
   * // Later:
   * dispose(); // Removes only this subscriber
   * ```
   */
  subscribe(path: string, callback: SubscriberCallback): DisposeFunction {
    let set = this.subscribers.get(path);
    if (!set) {
      set = new Set();
      this.subscribers.set(path, set);
    }
    set.add(callback);

    this.addPrefixes(path);

    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }
      disposed = true;

      set!.delete(callback);
      if (set!.size === 0) {
        this.subscribers.delete(path);
      }
      this.removePrefixes(path);
    };
  }

  /**
   * Notify all subscribers watching an exact path.
   *
   * Delegates to {@link notifySubscribers} which schedules delivery
   * on the next microtask with per-callback isolation.
   *
   * If no subscribers exist for the path, returns immediately (O(1) skip).
   *
   * @param path - The dot-notation path that resolved (e.g., `"Stripe.checkout"`).
   * @param value - The value assigned at that path.
   *
   * @example
   * ```ts
   * // Called from ProxyWrapper's set trap:
   * mgr.notify('Stripe.checkout', window.Stripe.checkout);
   * ```
   */
  notify(path: string, value: unknown): void {
    const set = this.subscribers.get(path);
    if (!set || set.size === 0) {
      return;
    }
    notifySubscribers(set, path, value);
  }

  /**
   * Check whether any subscriber watches a path deeper than `pathPrefix`.
   *
   * Used by ProxyWrapper's `get` trap to decide whether to create a
   * nested proxy. If no subscriber watches anything under `"Stripe.checkout"`,
   * there's no reason to proxy `checkout`'s children.
   *
   * O(1) lookup via the maintained `deepPrefixes` Map.
   *
   * @param pathPrefix - Ancestor path to check (e.g., `"Stripe"`).
   * @returns `true` if at least one subscriber watches a deeper path.
   *
   * @example
   * ```ts
   * mgr.subscribe('Stripe.checkout.sessions', cb);
   * mgr.hasDeepSubscribers('Stripe');           // true
   * mgr.hasDeepSubscribers('Stripe.checkout');   // true
   * mgr.hasDeepSubscribers('Stripe.elements');   // false
   * ```
   */
  hasDeepSubscribers(pathPrefix: string): boolean {
    return (this.deepPrefixes.get(pathPrefix) ?? 0) > 0;
  }

  /**
   * Total number of individual subscriptions across all paths.
   *
   * Used by GlobalWatcher for singleton ref-counting. When this
   * reaches 0, the PropertyTrap and ProxyWrapper for the root key
   * can be torn down.
   *
   * @returns Total subscriber count across all paths.
   *
   * @example
   * ```ts
   * mgr.subscribe('Stripe.checkout', cb1);
   * mgr.subscribe('Stripe.elements', cb2);
   * mgr.getSubscriberCount(); // 2
   * ```
   */
  getSubscriberCount(): number {
    let count = 0;
    for (const set of this.subscribers.values()) {
      count += set.size;
    }
    return count;
  }

  /**
   * Increment ref-counts for all ancestor prefixes of a path.
   *
   * For path `"Stripe.checkout.sessions"`, increments counts for
   * `"Stripe"` and `"Stripe.checkout"`.
   *
   * @param path - The subscriber's dot-notation path.
   */
  private addPrefixes(path: string): void {
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('.');
      this.deepPrefixes.set(prefix, (this.deepPrefixes.get(prefix) ?? 0) + 1);
    }
  }

  /**
   * Decrement ref-counts for all ancestor prefixes of a path.
   *
   * Removes entries that reach 0 to avoid memory leaks.
   *
   * @param path - The subscriber's dot-notation path.
   */
  private removePrefixes(path: string): void {
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('.');
      const count = (this.deepPrefixes.get(prefix) ?? 0) - 1;
      if (count <= 0) {
        this.deepPrefixes.delete(prefix);
      } else {
        this.deepPrefixes.set(prefix, count);
      }
    }
  }
}
