import type { DisposeFunction, SubscriberCallback, WatchGlobalOptions } from '../types.js';
import { DEFAULT_POLL_INTERVAL, defaultReadyPredicate } from '../types.js';
import { dispatchWatcherEvent } from './event-dispatcher.js';
import { createProxyWrapper } from './proxy-wrapper.js';
import { installTrap } from './property-trap.js';
import { resolvePath, startPolling } from './poll-fallback.js';
import { SubscriptionManager } from './subscription-manager.js';

/**
 * Internal state for a single root key (e.g., `"Stripe"`).
 *
 * Holds the SubscriptionManager, PropertyTrap dispose, and
 * any active poll fallbacks for sub-paths. Created lazily on
 * first subscription to a root key and torn down when the
 * last subscriber disposes.
 */
interface RootWatcher {
  /** Manages path → callback subscriptions for this root key. */
  subManager: SubscriptionManager;

  /** Disposes the `Object.defineProperty` trap on `window[rootKey]`. */
  trapDispose: DisposeFunction;

  /** Active poll fallbacks for sub-paths keyed by full path. */
  subPathPolls: Map<string, DisposeFunction>;
}

/**
 * Singleton registry: root key → RootWatcher.
 *
 * Multiple calls to `watch("Stripe.checkout", ...)` and
 * `watch("Stripe.elements", ...)` share one RootWatcher for `"Stripe"`.
 */
const registry = new Map<string, RootWatcher>();

/**
 * Microtask scheduler matching notification-queue.ts.
 * Used for next-tick resolve of already-existing values.
 */
const schedule: (fn: () => void) => void =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);

/**
 * Parse a dot-notation path into root key and optional sub-path.
 *
 * @param path - Full dot-notation path (e.g., `"Stripe.checkout.sessions"`).
 * @returns Tuple of `[rootKey, subPath | undefined]`.
 *
 * @example
 * ```ts
 * parsePath('Stripe');                  // ['Stripe', undefined]
 * parsePath('Stripe.checkout');         // ['Stripe', 'checkout']
 * parsePath('Stripe.checkout.sessions'); // ['Stripe', 'checkout.sessions']
 * ```
 */
function parsePath(path: string): [rootKey: string, subPath: string | undefined] {
  const dotIndex = path.indexOf('.');
  if (dotIndex === -1) {
    return [path, undefined];
  }
  return [path.slice(0, dotIndex), path.slice(dotIndex + 1)];
}

/**
 * Create a new RootWatcher for a root key.
 *
 * Instantiates a SubscriptionManager, ProxyWrapper, and PropertyTrap.
 * The PropertyTrap installs an `Object.defineProperty` setter/getter
 * on `window[rootKey]`.
 *
 * @param rootKey - Top-level property name (e.g., `"Stripe"`).
 * @param options - Polling interval and readiness predicate.
 * @returns The created RootWatcher.
 */
function createRootWatcher(rootKey: string, options: WatchGlobalOptions): RootWatcher {
  const subManager = new SubscriptionManager();
  const proxyWrapper = createProxyWrapper(subManager);
  const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const predicate = options.ready ?? defaultReadyPredicate;

  const trapDispose = installTrap(rootKey, subManager, proxyWrapper, {
    pollInterval,
    readyPredicate: predicate,
  });

  return {
    subManager,
    trapDispose,
    subPathPolls: new Map(),
  };
}

/**
 * Tear down a RootWatcher and remove it from the registry.
 *
 * Disposes the PropertyTrap, stops all active sub-path polls,
 * and deletes the registry entry.
 *
 * @param rootKey - The root key to tear down.
 * @param watcher - The RootWatcher to dispose.
 */
function teardownRootWatcher(rootKey: string, watcher: RootWatcher): void {
  watcher.trapDispose();
  for (const pollDispose of watcher.subPathPolls.values()) {
    pollDispose();
  }
  watcher.subPathPolls.clear();
  registry.delete(rootKey);
}

/**
 * Watch a dot-notation path on `window` for a value to appear.
 *
 * This is the main orchestration function. It:
 * 1. Parses the path into root key and sub-path.
 * 2. Gets or creates a singleton RootWatcher for the root key.
 * 3. Subscribes the callback for the full path.
 * 4. If the value already exists, schedules a next-tick notification.
 * 5. Optionally starts a timeout timer and retry loop.
 * 6. Optionally wires an AbortSignal to the dispose function.
 * 7. Returns a dispose function that cleans up this subscription
 *    and tears down the RootWatcher when the last subscriber leaves.
 *
 * @param path - Dot-notation path on `window` (e.g., `"Stripe.checkout"`).
 * @param callback - Invoked with the value when the path is ready.
 * @param options - Configuration for timeout, polling, readiness, signal, etc.
 * @returns Dispose function to remove this subscription.
 *
 * @example
 * ```ts
 * const dispose = watch('Stripe.checkout', (checkout) => {
 *   console.log('Stripe Checkout ready:', checkout);
 * });
 *
 * // Later:
 * dispose();
 * ```
 */
export function watch(
  path: string,
  callback: SubscriberCallback,
  options: WatchGlobalOptions = {},
): DisposeFunction {
  const [rootKey, subPath] = parsePath(path);
  const predicate = options.ready ?? defaultReadyPredicate;
  const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const hasTimeout = options.timeout !== undefined && options.timeout > 0;

  // Get or create singleton RootWatcher
  let watcher = registry.get(rootKey);
  if (!watcher) {
    watcher = createRootWatcher(rootKey, options);
    registry.set(rootKey, watcher);
  }

  // Timeout/retry state — declared before subscription so the
  // wrapped callback can close over them.
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let retryId: ReturnType<typeof setTimeout> | null = null;
  let resolved = false;

  // Wrap callback to detect resolution and clear timeout/retry timers.
  // When there's no timeout, use the raw callback to avoid overhead.
  const effectiveCallback: SubscriberCallback = hasTimeout
    ? (value) => {
        resolved = true;
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        if (retryId) { clearTimeout(retryId); retryId = null; }
        callback(value);
      }
    : callback;

  // Subscribe callback for the full path
  const unsubscribe = watcher.subManager.subscribe(path, effectiveCallback);

  // Check if the value already exists (late mount scenario).
  // Always resolve on next microtask to avoid Zalgo.
  const currentRoot = (window as unknown as Record<string, unknown>)[rootKey];
  if (currentRoot !== undefined) {
    if (!subPath) {
      // Root-level watch — value already exists
      if (predicate(currentRoot)) {
        schedule(() => {
          dispatchWatcherEvent('ww:ready', { path, value: currentRoot });
          effectiveCallback(currentRoot);
        });
      }
    } else {
      // Sub-path watch — resolve the full path
      const currentValue = resolvePath(
        { [rootKey]: currentRoot } as object,
        path,
      );
      if (predicate(currentValue)) {
        schedule(() => {
          dispatchWatcherEvent('ww:ready', { path, value: currentValue });
          effectiveCallback(currentValue);
        });
      } else if (pollInterval > 0 && !watcher.subPathPolls.has(path)) {
        // Value not ready yet — start polling for this sub-path.
        // The Proxy set trap will also catch it if it's assigned later,
        // but polling covers frozen nested objects.
        const pollDispose = startPolling(path, watcher.subManager, {
          interval: pollInterval,
          readyPredicate: predicate,
        });
        watcher.subPathPolls.set(path, pollDispose);
      }
    }
  }

  // --- Timeout + Retry ---
  if (hasTimeout) {
    const timeout = options.timeout!;
    const retries = options.retries ?? 0;
    let attempts = 0;

    const onTimeout = (): void => {
      if (resolved) {
        return;
      }

      dispatchWatcherEvent('ww:timeout', { path, attempts, elapsed: timeout });

      if (attempts < retries) {
        const retryInterval = pollInterval > 0 ? pollInterval : DEFAULT_POLL_INTERVAL;

        const retryCheck = (): void => {
          if (resolved) {
            return;
          }
          attempts++;

          const value = resolvePath(window, path);
          if (predicate(value)) {
            schedule(() => {
              dispatchWatcherEvent('ww:ready', { path, value });
              effectiveCallback(value);
            });
            return;
          }

          dispatchWatcherEvent('ww:timeout', { path, attempts, elapsed: timeout });

          if (attempts < retries) {
            retryId = setTimeout(retryCheck, retryInterval);
          }
        };

        retryId = setTimeout(retryCheck, retryInterval);
      }
    };

    timeoutId = setTimeout(onTimeout, timeout);
  }

  // --- Dispose ---
  let disposed = false;

  const dispose: DisposeFunction = () => {
    if (disposed) {
      return;
    }
    disposed = true;

    // Clear timeout/retry timers
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (retryId) {
      clearTimeout(retryId);
      retryId = null;
    }

    unsubscribe();

    // Stop sub-path poll if this was the trigger
    const pollDispose = watcher!.subPathPolls.get(path);
    if (pollDispose) {
      pollDispose();
      watcher!.subPathPolls.delete(path);
    }

    // Tear down RootWatcher if no subscribers remain
    if (watcher!.subManager.getSubscriberCount() === 0) {
      teardownRootWatcher(rootKey, watcher!);
    }

    // Clean up abort listener
    if (options.signal) {
      options.signal.removeEventListener('abort', dispose);
    }
  };

  // --- AbortSignal ---
  if (options.signal) {
    if (options.signal.aborted) {
      dispose();
      return dispose;
    }
    options.signal.addEventListener('abort', dispose, { once: true });
  }

  return dispose;
}

/**
 * Reset the global watcher registry.
 *
 * Tears down all active RootWatchers and clears the registry.
 * Intended for testing only — not exported from the public API.
 *
 * @example
 * ```ts
 * // In test teardown:
 * resetRegistry();
 * ```
 */
export function resetRegistry(): void {
  for (const [rootKey, watcher] of registry) {
    teardownRootWatcher(rootKey, watcher);
  }
  registry.clear();
}
