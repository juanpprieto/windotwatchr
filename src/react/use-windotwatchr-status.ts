import { useState, useEffect, useRef } from 'react';
import type { WindotWatchrOptions, WatcherState } from '../types.js';
import { watchWindot } from '../index.js';

/**
 * Result object returned by `useWindotWatchrStatus`.
 *
 * @typeParam T - The expected type of the resolved value.
 *
 * @example
 * ```tsx
 * const { value, status, error } = useWindotWatchrStatus<Stripe>('Stripe');
 *
 * if (status === 'ready') {
 *   value.redirectToCheckout({ sessionId: '...' });
 * }
 * ```
 */
export interface WindotWatchrStatusResult<T> {
  /** The resolved value, or `null` if not yet available. */
  value: T | null;
  /** Current watcher lifecycle state. */
  status: WatcherState;
  /** Error object if the watcher entered an error state, otherwise `null`. */
  error: Error | null;
}

/**
 * Status-aware React hook for watching a `window.*` property path.
 *
 * Like `useWindotWatchr` but additionally tracks the watcher lifecycle
 * through four observable states: `watching` → `ready` | `timeout` | `error`.
 *
 * Listens for `ww:ready`, `ww:timeout`, and `ww:error` events on `window`
 * to drive status transitions. Only reacts to events matching the given `path`.
 *
 * @typeParam T - The expected type of the resolved value.
 * @param path - Dot-notation path on `window` (e.g., `"Stripe.checkout"`).
 * @param options - Configuration for timeout, polling, readiness, etc.
 * @returns Object with `value`, `status`, and `error` fields.
 *
 * @example
 * ```tsx
 * import { useWindotWatchrStatus } from 'windotwatchr/react';
 *
 * function StripeLoader() {
 *   const { value: stripe, status, error } = useWindotWatchrStatus<Stripe>('Stripe', {
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
export function useWindotWatchrStatus<T = unknown>(
  path: string,
  options?: WindotWatchrOptions,
): WindotWatchrStatusResult<T> {
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
      setValue(val);
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
