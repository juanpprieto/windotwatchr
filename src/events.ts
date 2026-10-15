/**
 * Event detail shapes for the `ww:*` lifecycle events and the ambient
 * `WindowEventMap` augmentation that types them.
 *
 * Importing this module (directly or via the package types) makes
 * `window.addEventListener('ww:ready', e => e.detail.path)` type-check with
 * no casts.
 *
 * @packageDocumentation
 */

/**
 * Detail for the `ww:ready` event — a watched path resolved and passed its
 * readiness predicate.
 */
export interface WwReadyDetail {
  /** The dot-notation path that resolved. */
  path: string;
  /** The resolved value delivered to the callback. */
  value: unknown;
  /** Correlation id of the watcher that fired (see `WatchWindotOptions.correlationId`). */
  id: string;
}

/**
 * Detail for the `ww:timeout` event — a watcher's timeout (or a retry
 * attempt) elapsed without resolution.
 */
export interface WwTimeoutDetail {
  /** The dot-notation path being watched. */
  path: string;
  /** Number of retry attempts made so far (0 on the initial timeout). */
  attempts: number;
  /** The configured timeout in ms. */
  elapsed: number;
  /** Correlation id of the watcher that fired. */
  id: string;
}

/**
 * Detail for the `ww:error` event — a subscriber callback threw, or a poll
 * getter threw while resolving a path.
 */
export interface WwErrorDetail {
  /** The dot-notation path involved. */
  path: string;
  /** The thrown error. */
  error: unknown;
  /** Correlation id of the watcher, when the error originated from delivery. */
  id?: string;
}

/**
 * Detail for the `ww:warning` event — a non-fatal condition such as a
 * frozen/sealed value, a failed `defineProperty`, or watching a reserved
 * `Window` built-in.
 */
export interface WwWarningDetail {
  /** The dot-notation path involved. */
  path: string;
  /** Machine-readable reason: `'frozen' | 'sealed' | 'defineProperty failed' | 'reserved'`. */
  reason: string;
}

declare global {
  /**
   * Ambient typing for the `ww:*` lifecycle events so `addEventListener`
   * infers a correctly-typed `CustomEvent` without casts.
   */
  interface WindowEventMap {
    'ww:ready': CustomEvent<WwReadyDetail>;
    'ww:timeout': CustomEvent<WwTimeoutDetail>;
    'ww:error': CustomEvent<WwErrorDetail>;
    'ww:warning': CustomEvent<WwWarningDetail>;
  }
}
