import type { DisposeFunction } from '../types.js';
import { DEFAULT_POLL_INTERVAL, defaultReadyPredicate } from '../types.js';
import type { ProxyWrapper } from './proxy-wrapper.js';
import type { SubscriptionManager } from './subscription-manager.js';
import { startPolling } from './poll-fallback.js';

/**
 * Configuration for {@link installTrap}.
 */
export interface TrapOptions {
  /**
   * Polling fallback interval in ms.
   * Used when Proxy wrapping fails (frozen/sealed) or defineProperty fails.
   * Defaults to {@link DEFAULT_POLL_INTERVAL} (100ms). Set to `0` to disable.
   */
  pollInterval?: number;

  /**
   * Readiness predicate for the root-level value.
   * Defaults to {@link defaultReadyPredicate} (`value != null`).
   */
  readyPredicate?: (value: unknown) => boolean;
}

/**
 * Install an `Object.defineProperty` setter/getter trap on `window`
 * for a given root key.
 *
 * When a third-party script assigns `window[rootKey] = value`, the
 * setter fires and:
 * 1. Wraps the value in an ES6 Proxy via {@link ProxyWrapper}.
 * 2. Notifies subscribers of the root key via {@link SubscriptionManager}.
 * 3. If the value is frozen/sealed (Proxy returns `null`), starts
 *    {@link startPolling | polling} as a fallback.
 *
 * The getter returns `undefined` before any assignment, mimicking an
 * absent property so SDKs that check `typeof window.Stripe` see
 * `"undefined"` as expected.
 *
 * The setter remains active after first assignment to handle root
 * replacement (e.g., SDK re-assigns `window.Stripe = newObj`). Each
 * reassignment re-wraps in a new Proxy and re-notifies.
 *
 * If `Object.defineProperty` itself fails (e.g., another script already
 * defined the property with `configurable: false`), falls back to polling
 * for the root key.
 *
 * @param rootKey - The top-level property name on `window` (e.g., `"Stripe"`).
 * @param subManager - SubscriptionManager to notify on assignment.
 * @param proxyWrapper - ProxyWrapper to wrap assigned values.
 * @param options - Optional polling interval and readiness predicate.
 * @returns Dispose function that removes the trap and restores the
 *   original property descriptor (if one existed).
 *
 * @example
 * ```ts
 * const dispose = installTrap('Stripe', subManager, proxyWrapper, {
 *   pollInterval: 100,
 *   readyPredicate: (v) => v != null,
 * });
 *
 * // Third-party script later does: window.Stripe = { checkout: {...} }
 * // → setter fires → ProxyWrapper wraps → subscribers notified
 *
 * // Cleanup:
 * dispose();
 * ```
 */
export function installTrap(
  rootKey: string,
  subManager: SubscriptionManager,
  proxyWrapper: ProxyWrapper,
  options?: TrapOptions,
): DisposeFunction {
  const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const predicate = options?.readyPredicate ?? defaultReadyPredicate;

  /** Saved original descriptor to restore on dispose. */
  const originalDescriptor = Object.getOwnPropertyDescriptor(window, rootKey);

  /** Current proxied value. `undefined` before first assignment. */
  let currentValue: unknown = undefined;

  /** Dispose function for active poll fallback, if any. */
  let pollDispose: DisposeFunction | null = null;

  /** Whether this trap has been disposed. */
  let disposed = false;

  /**
   * Handle a new value being assigned to `window[rootKey]`.
   *
   * Attempts to Proxy-wrap the value. If wrapping fails (frozen/sealed),
   * starts polling as fallback.
   *
   * @param newValue - The value assigned to `window[rootKey]`.
   */
  const handleAssignment = (newValue: unknown): void => {
    // Stop any existing poll fallback from a previous assignment
    if (pollDispose) {
      pollDispose();
      pollDispose = null;
    }

    if (newValue !== null && typeof newValue === 'object') {
      const proxied = proxyWrapper.wrap(newValue, rootKey);

      if (proxied) {
        // Proxy wrapping succeeded — store proxied value
        currentValue = proxied;
      } else {
        // Frozen/sealed — store raw value, start polling
        currentValue = newValue;
        if (pollInterval > 0) {
          pollDispose = startPolling(rootKey, subManager, {
            interval: pollInterval,
            readyPredicate: predicate,
          });
        }
      }
    } else {
      // Primitive or null — store as-is, no proxy needed
      currentValue = newValue;
    }

    subManager.notify(rootKey, currentValue);
  };

  try {
    // If the property already has a value, capture it before trapping
    const existingValue = originalDescriptor?.value
      ?? (originalDescriptor?.get ? originalDescriptor.get.call(window) : undefined);

    Object.defineProperty(window, rootKey, {
      configurable: true,
      enumerable: true,
      get() {
        return currentValue;
      },
      set(newValue: unknown) {
        handleAssignment(newValue);
      },
    });

    // If a value already existed, process it through the assignment handler
    if (existingValue !== undefined) {
      handleAssignment(existingValue);
    }
  } catch {
    // defineProperty failed — another script may have locked the property.
    // Fall back to polling for the root key.
    // TODO: dispatch ww:warning CustomEvent with { path: rootKey, reason: 'defineProperty failed' }
    if (pollInterval > 0) {
      pollDispose = startPolling(rootKey, subManager, {
        interval: pollInterval,
        readyPredicate: predicate,
      });
    }
  }

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;

    // Stop poll fallback if active
    if (pollDispose) {
      pollDispose();
      pollDispose = null;
    }

    // Restore original property descriptor or delete the trap
    try {
      if (originalDescriptor) {
        Object.defineProperty(window, rootKey, originalDescriptor);
      } else {
        // Property didn't exist before — remove our descriptor and set
        // the current value as a normal property (preserving SDK state)
        delete (window as unknown as Record<string, unknown>)[rootKey];
        if (currentValue !== undefined) {
          (window as unknown as Record<string, unknown>)[rootKey] = currentValue;
        }
      }
    } catch {
      // Best-effort restore. If it fails, the property may be in an
      // unexpected state, but we don't want dispose() to throw.
    }
  };
}
