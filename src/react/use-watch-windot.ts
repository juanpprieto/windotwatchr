import React from 'react';
import type { WatchWindotOptions, WatcherState } from '../types.js';
import { watch } from '../core/windot-watcher.js';
import type { DisposeFunction } from '../types.js';
import { defaultReadyPredicate } from '../types.js';

// A default import also works with React 16's CommonJS exports in native ESM.
const { useState, useEffect, useRef } = React;

/**
 * Result object returned by {@link useWatchWindot}.
 *
 * @typeParam T - The expected type of the resolved value.
 *
 * @example
 * ```tsx
 * const { value, status, error } = useWatchWindot<Stripe>('Stripe');
 *
 * if (status === 'ready') {
 *   value.redirectToCheckout({ sessionId: '...' });
 * }
 * ```
 */
export interface WatchWindotResult<T> {
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
 * `watching` → `ready` | `timeout` | `error`.
 *
 * Readiness, timeout and error state come from this registration's private
 * callbacks. Public correlation labels can repeat without sibling cross-talk.
 * Changed option values resubscribe; predicates update and recheck in place,
 * so inline predicates do not create a resubscription/render loop.
 *
 * Watchers are disposed on unmount or when the path/options change.
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
 * import { useWatchWindot } from 'windotwatchr/react';
 *
 * function StripeLoader() {
 *   const { value: stripe, status, error } = useWatchWindot<Stripe>('Stripe', {
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
export function useWatchWindot<T = unknown>(
  path: string,
  options?: WatchWindotOptions,
): WatchWindotResult<T> {
  const [value, setValue] = useState<T | null>(null);
  const [status, setStatus] = useState<WatcherState>('watching');
  const [error, setError] = useState<Error | null>(null);
  const optionsRef = useRef(options);
  const refreshRef = useRef<(() => void) | undefined>(undefined);
  optionsRef.current = options;
  const { timeout, pollInterval, strategy, signal, retries, ready, once, correlationId } = options ?? {};

  useEffect(() => {
    let active = true;
    let dispose: DisposeFunction | undefined;
    setValue(null);
    setStatus('watching');
    setError(null);
    if (typeof window === 'undefined') {return;}
    try {
      dispose = watch(path, val => {
        if (!active) {return;}
        setValue(() => val as T);
        setStatus('ready');
        setError(null);
      }, { ...optionsRef.current, ready: candidate => (optionsRef.current?.ready ?? defaultReadyPredicate)(candidate) }, {
        refresh: sample => { refreshRef.current = sample; },
        notReady: () => { if (active) { setValue(null); setStatus('watching'); setError(null); } },
        abort: () => { if (active) { setValue(null); setStatus('idle'); setError(null); } },
        timeout: () => { if (active) {setStatus('timeout');} },
        error: failure => {
          if (!active) {return;}
          setValue(null);
          setStatus('error');
          setError(failure instanceof Error ? failure : new Error(String(failure)));
        },
      });
    } catch (failure) {
      setStatus('error');
      setError(failure instanceof Error ? failure : new Error(String(failure)));
    }
    return () => { active = false; refreshRef.current = undefined; dispose?.(); };
  }, [path, timeout, pollInterval, strategy, signal, retries, once, correlationId]);

  useEffect(() => { refreshRef.current?.(); }, [ready]);

  return { value, status, error };
}
