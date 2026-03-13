import type { SubscriptionManager } from './subscription-manager.js';

/**
 * Creates a ProxyWrapper bound to a {@link SubscriptionManager}.
 *
 * The wrapper intercepts property assignments on objects via ES6 Proxy
 * and notifies subscribers through the SubscriptionManager.
 *
 * @param subManager - The SubscriptionManager to notify on property changes.
 * @returns A {@link ProxyWrapper} instance with `wrap()` method.
 *
 * @example
 * ```ts
 * const wrapper = createProxyWrapper(subscriptionManager);
 * const proxied = wrapper.wrap(sdkObject, 'Stripe');
 * // Now `sdkObject.checkout = {...}` notifies subscribers of "Stripe.checkout"
 * ```
 */
export function createProxyWrapper(subManager: SubscriptionManager): ProxyWrapper {
  return new ProxyWrapperImpl(subManager);
}

/**
 * Public interface for ProxyWrapper.
 * Wraps objects in ES6 Proxy to intercept property assignments.
 */
export interface ProxyWrapper {
  /**
   * Wrap a target object in an ES6 Proxy.
   *
   * Returns `null` if the target is frozen or sealed (caller should
   * fall back to polling).
   *
   * @param target - The object to wrap (e.g., the value assigned to `window.Stripe`).
   * @param parentPath - Dot-notation path prefix (e.g., `"Stripe"`).
   * @returns The Proxy-wrapped object, or `null` if target is frozen/sealed.
   *
   * @example
   * ```ts
   * const proxied = wrapper.wrap(stripeObj, 'Stripe');
   * if (!proxied) {
   *   // stripeObj is frozen/sealed — use PollFallback instead
   * }
   * ```
   */
  wrap(target: object, parentPath: string): object | null;
}

/**
 * Internal ProxyWrapper implementation.
 *
 * Uses three Proxy traps:
 * - `set`: Intercepts direct property assignment (`obj.x = val`).
 * - `defineProperty`: Intercepts `Object.defineProperty(obj, 'x', desc)` calls.
 * - `get`: Lazy nesting — returns nested proxy only when deeper subscribers exist.
 *
 * A `WeakMap<object, object>` deduplicates proxies to prevent double-wrapping
 * and handle circular references (e.g., `window.Stripe.self = window.Stripe`).
 */
class ProxyWrapperImpl implements ProxyWrapper {
  /**
   * Dedup map: original object → its Proxy.
   * WeakMap allows GC of unreferenced objects.
   */
  private proxyCache = new WeakMap<object, object>();

  /** @param subManager - SubscriptionManager for notification routing. */
  private subManager: SubscriptionManager;

  constructor(subManager: SubscriptionManager) {
    this.subManager = subManager;
  }

  wrap(target: object, parentPath: string): object | null {
    if (typeof target !== 'object' || target === null) {
      return null;
    }

    if (Object.isFrozen(target) || Object.isSealed(target)) {
      return null;
    }

    const cached = this.proxyCache.get(target);
    if (cached) {
      return cached;
    }

    const proxy = this.createProxy(target, parentPath);
    this.proxyCache.set(target, proxy);
    return proxy;
  }

  /**
   * Create an ES6 Proxy with `set`, `defineProperty`, and `get` traps.
   *
   * @param source - The plain object to proxy.
   * @param parentPath - Dot-notation prefix for subscriber path matching.
   * @returns The proxied object.
   */
  private createProxy(source: object, parentPath: string): object {
    const handler: ProxyHandler<object> = {
      /**
       * Intercepts direct property assignment: `obj.prop = value`.
       *
       * Passes `target` (not `receiver`) as 4th arg to `Reflect.set`.
       * When `receiver` is the proxy and the property is new, `[[Set]]`
       * internally calls `Receiver.[[DefineOwnProperty]]()`, triggering
       * the `defineProperty` trap — causing double notification. Passing
       * `target` routes `[[DefineOwnProperty]]` to the plain object.
       *
       * Trade-off: bypasses prototype-chain setters. Acceptable because
       * SDK globals are plain objects, not prototype-inheriting instances.
       */
      set: (target, prop, value, _receiver) => {
        if (typeof prop === 'symbol') {
          return Reflect.set(target, prop, value, target);
        }

        const result = Reflect.set(target, prop, value, target);
        const fullPath = `${parentPath}.${String(prop)}`;
        this.subManager.notify(fullPath, value);
        return result;
      },

      /**
       * Intercepts explicit `Object.defineProperty()` calls.
       *
       * Only fires for SDK code that uses `Object.defineProperty` internally
       * (common pattern). Normal assignment routes through the `set` trap
       * above (which passes `target`, not `receiver`, to avoid triggering
       * this trap).
       *
       * Only notifies when the descriptor contains a `value` property
       * (accessor descriptors with get/set don't have a concrete value
       * to notify with).
       */
      defineProperty: (target, prop, descriptor) => {
        if (typeof prop === 'symbol') {
          return Reflect.defineProperty(target, prop, descriptor);
        }

        const result = Reflect.defineProperty(target, prop, descriptor);
        if ('value' in descriptor) {
          const fullPath = `${parentPath}.${String(prop)}`;
          this.subManager.notify(fullPath, descriptor.value);
        }
        return result;
      },

      /**
       * Intercepts property reads for lazy proxy nesting.
       *
       * When a subscriber watches `"Stripe.checkout.sessions"`, the
       * SubscriptionManager records `"Stripe.checkout"` as a deep prefix.
       * This trap checks `hasDeepSubscribers` before creating a nested
       * proxy — avoiding overhead for unmonitored depth levels.
       *
       * Uses the `proxyCache` WeakMap to deduplicate nested proxies
       * and handle circular references safely.
       */
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);

        if (
          typeof prop === 'symbol' ||
          value === null ||
          typeof value !== 'object'
        ) {
          return value;
        }

        const fullPath = `${parentPath}.${String(prop)}`;

        if (!this.subManager.hasDeepSubscribers(fullPath)) {
          return value;
        }

        return this.getOrCreateNestedProxy(value, fullPath);
      },
    };

    return new Proxy(source, handler);
  }

  /**
   * Get an existing nested proxy from cache, or create one.
   *
   * @param target - The nested object to wrap.
   * @param path - Full dot-notation path for this nesting level.
   * @returns The proxied nested object, or the original if frozen/sealed.
   */
  private getOrCreateNestedProxy(target: object, path: string): object {
    const cached = this.proxyCache.get(target);
    if (cached) {
      return cached;
    }

    // Don't proxy frozen/sealed nested objects — return as-is.
    // PollFallback handles these at the root level; nested frozen
    // objects simply don't get proxy-based detection.
    if (Object.isFrozen(target) || Object.isSealed(target)) {
      return target;
    }

    const proxy = this.createProxy(target, path);
    this.proxyCache.set(target, proxy);
    return proxy;
  }
}
