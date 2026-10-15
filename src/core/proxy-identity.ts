/** Weak identity metadata shared by interception and snapshot detection. */
import { runtimeState } from './runtime-state.js';
const originals = runtimeState.originals;

/**
 * Associate a wrapper with its raw SDK object without retaining it globally.
 * @param proxy - Library-created wrapper.
 * @param target - Raw SDK object.
 */
export function registerProxy(proxy: object, target: object): void {
  originals.set(proxy, target);
}

/**
 * Resolve library wrappers to their original identity for snapshot comparisons.
 * @param value - A raw value or library wrapper.
 * @returns The raw identity; primitives pass through unchanged.
 * @example unwrapProxy(window.SDK)
 */
export function unwrapProxy(value: unknown): unknown {
  while (value !== null && (typeof value === 'object' || typeof value === 'function') && originals.has(value)) {
    value = originals.get(value);
  }
  return value;
}
