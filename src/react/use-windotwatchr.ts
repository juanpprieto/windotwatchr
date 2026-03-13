import { useState, useEffect, useRef } from 'react';
import type { WindotWatchrOptions } from '../types.js';
import { watchWindot } from '../index.js';

/**
 * React hook that watches one or more `window.*` property paths.
 *
 * **Single path** — subscribes to the given `window.*` path and returns
 * the resolved value (or `null` until ready).
 *
 * **Multiple paths** — opens one subscription per path and returns a
 * `Record` keyed by path. Values update independently as each resolves.
 *
 * Watchers are disposed on unmount or when the path(s) change.
 * StrictMode-safe: the singleton ref-counting in the core engine handles
 * double-mount/unmount cycles correctly.
 *
 * @typeParam T - Expected type of the resolved value (single-path overload).
 * @param path - Dot-notation path on `window` (e.g., `"Stripe.checkout"`).
 * @param options - Configuration for timeout, polling, readiness, etc.
 * @returns The resolved value (`T | null`) or a `Record` of values.
 *
 * @example
 * ```tsx
 * import { useWindotWatchr } from 'windotwatchr/react';
 *
 * // Single path
 * function StripeButton() {
 *   const stripe = useWindotWatchr<Stripe>('Stripe');
 *   if (!stripe) return <div>Loading Stripe...</div>;
 *   return <button onClick={() => stripe.redirectToCheckout({ sessionId: '...' })}>Pay</button>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * import { useWindotWatchr } from 'windotwatchr/react';
 *
 * // Multiple paths
 * function ThirdPartyStatus() {
 *   const sdks = useWindotWatchr(['Stripe', 'google.maps', 'analytics']);
 *   return (
 *     <ul>
 *       <li>Stripe: {sdks.Stripe ? 'Ready' : 'Loading...'}</li>
 *       <li>Maps: {sdks['google.maps'] ? 'Ready' : 'Loading...'}</li>
 *     </ul>
 *   );
 * }
 * ```
 */
export function useWindotWatchr<T = unknown>(
  path: string,
  options?: WindotWatchrOptions,
): T | null;

/**
 * Multi-path overload — watches several `window.*` paths simultaneously.
 *
 * Opens one subscription per path and returns a `Record` keyed by each
 * path. Each value is `null` until the corresponding path resolves.
 *
 * @typeParam K - Union of literal string path names.
 * @param paths - Array of dot-notation paths on `window`.
 * @param options - Configuration for timeout, polling, readiness, etc.
 * @returns Record mapping each path to its resolved value or `null`.
 *
 * @example
 * ```tsx
 * const sdks = useWindotWatchr(['Stripe', 'google.maps']);
 * // sdks.Stripe    → Stripe object | null
 * // sdks['google.maps'] → google.maps object | null
 * ```
 */
export function useWindotWatchr<K extends string>(
  paths: K[],
  options?: WindotWatchrOptions,
): Record<K, unknown>;

export function useWindotWatchr<T = unknown>(
  pathOrPaths: string | string[],
  options?: WindotWatchrOptions,
): T | null | Record<string, unknown> {
  if (Array.isArray(pathOrPaths)) {
    return useWindotWatchrMany(pathOrPaths, options);
  }
  return useWindotWatchrSingle<T>(pathOrPaths, options);
}

/**
 * Single-path watcher implementation.
 *
 * @internal
 * @typeParam T - Expected type of the resolved value.
 * @param path - Dot-notation path on `window`.
 * @param options - Watcher configuration (stored in a ref to avoid re-subscriptions).
 * @returns The resolved value or `null`.
 *
 * @example
 * ```ts
 * // Called internally by useWindotWatchr when a string is passed:
 * useWindotWatchrSingle<Stripe>('Stripe', opts);
 * ```
 */
function useWindotWatchrSingle<T>(
  path: string,
  options: WindotWatchrOptions | undefined,
): T | null {
  const [value, setValue] = useState<T | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    setValue(null);
    const dispose = watchWindot<T>(path, setValue, optionsRef.current);
    return dispose;
  }, [path]);

  return value;
}

/**
 * Multi-path watcher implementation.
 *
 * @internal
 * @typeParam K - Union of literal string path names.
 * @param paths - Array of dot-notation paths on `window`.
 * @param options - Watcher configuration (stored in a ref to avoid re-subscriptions).
 * @returns Record mapping each path to its resolved value or `null`.
 *
 * @example
 * ```ts
 * // Called internally by useWindotWatchr when an array is passed:
 * useWindotWatchrMany(['Stripe', 'google.maps'], opts);
 * ```
 */
function useWindotWatchrMany<K extends string>(
  paths: K[],
  options: WindotWatchrOptions | undefined,
): Record<K, unknown> {
  const [values, setValues] = useState<Record<K, unknown>>(() => {
    const initial = {} as Record<K, unknown>;
    for (const p of paths) {
      initial[p] = null;
    }
    return initial;
  });

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Serialized for stable useEffect dependency comparison —
  // avoids re-subscribing when the caller passes a new array reference
  // with the same contents.
  const pathsKey = JSON.stringify(paths);

  useEffect(() => {
    const currentPaths = JSON.parse(pathsKey) as K[];

    setValues(() => {
      const fresh = {} as Record<K, unknown>;
      for (const p of currentPaths) {
        fresh[p] = null;
      }
      return fresh;
    });

    const disposers = currentPaths.map((p) =>
      watchWindot(p, (val) => {
        setValues((prev) => ({ ...prev, [p]: val }));
      }, optionsRef.current),
    );

    return () => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, [pathsKey]);

  return values;
}
