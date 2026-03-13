/**
 * Configuration options for windotwatchr watchers.
 *
 * Shared by the imperative API (`watchWindot`, `waitForWindot`) and
 * the React hooks (`useWindotWatchr`, `useWindotWatchrStatus`).
 * All fields defined upfront to avoid breaking changes.
 *
 * @example
 * ```ts
 * const opts: WindotWatchrOptions = {
 *   timeout: 10_000,
 *   retries: 3,
 *   pollInterval: 200,
 * };
 * ```
 */
export interface WindotWatchrOptions {
  /** Timeout in ms. No default — consumer must set explicitly. */
  timeout?: number;

  /** Polling fallback interval in ms. Default: 100. Set to 0 to disable. */
  pollInterval?: number;

  /** Detection strategy. Default: 'auto'. */
  strategy?: 'proxy' | 'poll' | 'auto';

  /** AbortSignal to tie watcher lifecycle to an AbortController. */
  signal?: AbortSignal;

  /** Number of retry attempts after timeout. Default: 0 (no retry). */
  retries?: number;

  /** Readiness predicate. Default: (value) => value != null. */
  ready?: (value: unknown) => boolean;
}

/** Cleanup function returned by windotwatchr watchers. */
export type DisposeFunction = () => void;

/** Subscriber callback invoked when a watched path resolves. */
export type SubscriberCallback<T = unknown> = (value: T) => void;

/** Watcher lifecycle states. */
export type WatcherState = 'idle' | 'watching' | 'ready' | 'timeout' | 'error';

/** Default readiness predicate: value is non-nullish. */
export const defaultReadyPredicate = (value: unknown): boolean =>
  value !== null && value !== undefined;

/** Default polling interval in ms. */
export const DEFAULT_POLL_INTERVAL = 100;
