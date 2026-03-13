import type { DisposeFunction } from '../types.js';
import { DEFAULT_POLL_INTERVAL, defaultReadyPredicate } from '../types.js';
import type { SubscriptionManager } from './subscription-manager.js';

/**
 * Resolve a dot-notation path against an object.
 *
 * Walks each segment of the path, returning `undefined` if any
 * intermediate segment is nullish.
 *
 * @param root - The root object to start from (typically `window`).
 * @param path - Dot-notation path (e.g., `"Stripe.checkout.sessions"`).
 * @returns The value at the path, or `undefined` if any segment is missing.
 *
 * @example
 * ```ts
 * const obj = { a: { b: { c: 42 } } };
 * resolvePath(obj, 'a.b.c');   // 42
 * resolvePath(obj, 'a.b.d');   // undefined
 * resolvePath(obj, 'a.x.c');   // undefined
 * ```
 */
export function resolvePath(root: object, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = root;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Start polling a dot-notation path on `window` at a fixed interval.
 *
 * Used as a fallback when Proxy-based detection cannot work:
 * - Target object is frozen (`Object.isFrozen()`)
 * - Target object is sealed (`Object.isSealed()`)
 * - `Object.defineProperty` trap failed (another script hijacked it)
 * - Property was deleted and needs re-trapping
 *
 * Polling uses a `setTimeout` chain (not `setInterval`) so each check
 * runs after the previous one completes. Stops automatically when the
 * readiness predicate passes.
 *
 * @param path - Full dot-notation path to poll (e.g., `"Stripe.checkout"`).
 * @param subManager - SubscriptionManager to notify when the value is ready.
 * @param options - Polling configuration.
 * @param options.interval - Milliseconds between checks. Defaults to {@link DEFAULT_POLL_INTERVAL}.
 * @param options.readyPredicate - Function to test if the value is ready.
 *   Defaults to {@link defaultReadyPredicate} (`value != null`).
 * @returns Dispose function that stops the polling timer.
 *
 * @example
 * ```ts
 * const dispose = startPolling('Stripe.checkout', subManager, {
 *   interval: 200,
 *   readyPredicate: (v) => typeof v === 'object' && v !== null,
 * });
 *
 * // Later, to stop polling:
 * dispose();
 * ```
 */
export function startPolling(
  path: string,
  subManager: SubscriptionManager,
  options?: {
    interval?: number;
    readyPredicate?: (value: unknown) => boolean;
  },
): DisposeFunction {
  const interval = options?.interval ?? DEFAULT_POLL_INTERVAL;
  const predicate = options?.readyPredicate ?? defaultReadyPredicate;

  let timerId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  /**
   * Single poll check. Resolves the path against `window`,
   * tests the predicate, and either notifies or re-schedules.
   */
  const check = (): void => {
    if (stopped) {
      return;
    }

    const value = resolvePath(window, path);

    if (predicate(value)) {
      subManager.notify(path, value);
      return;
    }

    timerId = setTimeout(check, interval);
  };

  timerId = setTimeout(check, interval);

  return () => {
    stopped = true;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };
}
