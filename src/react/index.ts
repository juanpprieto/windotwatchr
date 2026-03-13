/**
 * React hooks for `windotwatchr`.
 *
 * Provides reactive wrappers around the core windotwatchr engine.
 * Import from `windotwatchr/react` — React is a peer dependency
 * and is NOT bundled into the output.
 *
 * @packageDocumentation
 */
export { useWindotWatchr } from './use-windotwatchr.js';
export { useWindotWatchrStatus } from './use-windotwatchr-status.js';
export type { WindotWatchrStatusResult } from './use-windotwatchr-status.js';
export type { WindotWatchrOptions, WatcherState } from '../types.js';
