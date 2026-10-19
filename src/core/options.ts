import type { WatchWindotOptions } from '../types.js';

/** Largest delay supported consistently by the browser/Node timer APIs. */
const MAX_TIMER_DELAY = 2_147_483_647;

/**
 * Validate numeric domains before listeners, traps, subscriptions or timers exist.
 * Zero disables timeout/polling; positive fractional milliseconds are supported.
 * @param options - Registration options.
 * @throws RangeError for invalid delay/retry values.
 * @example validateOptions({ timeout: 1.5, pollInterval: 100, retries: 2 });
 */
export function validateOptions(options: WatchWindotOptions): void {
  for (const name of ['timeout', 'pollInterval', 'retries'] as const) {
    const value = options[name];
    if (value === undefined) {continue;}
    if (!Number.isFinite(value) || value < 0 || value > MAX_TIMER_DELAY || (name === 'retries' && !Number.isInteger(value))) {
      throw new RangeError(`windotwatchr: ${name} must be ${name === 'retries' ? 'an integer' : 'a finite number'} between 0 and ${MAX_TIMER_DELAY}`);
    }
  }
  if (options.strategy !== undefined && !['auto', 'proxy', 'poll'].includes(options.strategy)) {
    throw new TypeError('windotwatchr: unknown detection strategy');
  }
}
