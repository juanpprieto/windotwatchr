/**
 * Configuration options for windotwatchr watchers.
 *
 * Shared by the imperative API (`watchWindot`, `waitForWindot`) and
 * the React hook (`useWatchWindot`).
 *
 * @example
 * ```ts
 * const opts: WatchWindotOptions = {
 *   timeout: 10_000,
 *   retries: 3,
 *   pollInterval: 200,
 * };
 * ```
 */
export interface WatchWindotOptions {
  /** Initial deadline in ms; zero disables. Finite 0..2147483647, fractions round up. */
  timeout?: number;

  /** Persistent snapshot interval in ms. Default: 100; zero disables detection polling. */
  pollInterval?: number;

  /** Detection strategy. Default: 'auto'. */
  strategy?: 'proxy' | 'poll' | 'auto';

  /** AbortSignal to tie watcher lifecycle to an AbortController. */
  signal?: AbortSignal;

  /** Extra deadline checks; integer 0..2147483647. Persistent detection outlives retries. */
  retries?: number;

  /** Synchronous, side-effect-free readiness predicate. Default: value != null. */
  ready?: (value: unknown) => boolean;

  /**
   * Auto-dispose the watcher after its first resolution.
   *
   * When `true`, the callback fires at most once and the underlying
   * subscription, timers, and poll fallbacks are torn down immediately
   * after delivery. Default: `false` (re-fires on root reassignment).
   */
  once?: boolean;

  /**
   * Public label on this registration's ready, timeout and error events.
   *
   * Lets multiple watchers on the same path be told apart by listeners —
   * `event.detail.id` echoes this value. Auto-generated when omitted.
   * Labels can repeat; internal registration identity and hook isolation are
   * independent of this label. Root-wide warnings do not carry one.
   */
  correlationId?: string;
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

/** The optional disposal protocol is declared here for ordinary strict consumers. */
declare global {
  interface SymbolConstructor {
    readonly dispose: unique symbol;
  }
}
