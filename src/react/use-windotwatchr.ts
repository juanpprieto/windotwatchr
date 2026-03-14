import { useState, useEffect, useRef } from 'react';
import type { WindotWatchrOptions, WatcherState } from '../types.js';
import { watchWindot } from '../index.js';

/**
 * Result object returned by {@link useWindotWatchr}.
 *
 * @typeParam T - The expected type of the resolved value.
 *
 * @example
 * ```tsx
 * const { value, status, error } = useWindotWatchr<Stripe>('Stripe');
 *
 * if (status === 'ready') {
 *   value.redirectToCheckout({ sessionId: '...' });
 * }
 * ```
 */
export interface WindotWatchrResult<T> {
  /** The resolved value, or `null` if not yet available. */
  value: T | null;
  /** Current watcher lifecycle state. */
  status: WatcherState;
  /** Error object if the watcher entered an error state, otherwise `null`. */
  error: Error | null;
}

/**
 * React hook that watches a `window.*` property path with full lifecycle tracking.
 *
 * Subscribes to the given dot-notation path on `window` and returns an object
 * with `value`, `status`, and `error` fields. Status transitions through
 * `watching` → `ready` | `timeout` | `error` based on `ww:*` lifecycle events.
 *
 * Watchers are disposed on unmount or when the path changes.
 * StrictMode-safe: the singleton ref-counting in the core engine handles
 * double-mount/unmount cycles correctly.
 *
 * @typeParam T - Expected type of the resolved value.
 * @param path - Dot-notation path on `window` (e.g., `"Stripe.checkout"`).
 * @param options - Configuration for timeout, polling, readiness, etc.
 * @returns Object with `value`, `status`, and `error` fields.
 *
 * @example
 * ```tsx
 * import { useWindotWatchr } from 'windotwatchr/react';
 *
 * function StripeLoader() {
 *   const { value: stripe, status, error } = useWindotWatchr<Stripe>('Stripe', {
 *     timeout: 10_000,
 *   });
 *
 *   if (status === 'error') return <div>Error: {error?.message}</div>;
 *   if (status === 'timeout') return <div>Stripe is taking too long to load...</div>;
 *   if (!stripe) return <div>Loading Stripe ({status})...</div>;
 *   return <button onClick={() => stripe.redirectToCheckout({ sessionId: '...' })}>Pay</button>;
 * }
 * ```
 */
export function useWindotWatchr<T = unknown>(
  path: string,
  options?: WindotWatchrOptions,
): WindotWatchrResult<T> {
  const [value, setValue] = useState<T | null>(null);
  const [status, setStatus] = useState<WatcherState>('watching');
  const [error, setError] = useState<Error | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    setValue(null);
    setStatus('watching');
    setError(null);

    const onReady = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { path: string };
      if (detail.path === path) {
        setStatus('ready');
      }
    };

    const onTimeout = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { path: string };
      if (detail.path === path) {
        setStatus('timeout');
      }
    };

    const onError = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { path: string; error?: Error };
      if (detail.path === path) {
        setStatus('error');
        if (detail.error) {
          setError(detail.error);
        }
      }
    };

    window.addEventListener('ww:ready', onReady);
    window.addEventListener('ww:timeout', onTimeout);
    window.addEventListener('ww:error', onError);

    const dispose = watchWindot<T>(path, (val) => {
      setValue(() => val);
    }, optionsRef.current);

    return () => {
      dispose();
      window.removeEventListener('ww:ready', onReady);
      window.removeEventListener('ww:timeout', onTimeout);
      window.removeEventListener('ww:error', onError);
    };
  }, [path]);

  return { value, status, error };
}
