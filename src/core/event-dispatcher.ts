/**
 * Dispatch a `CustomEvent` on `window` with the given name and detail.
 *
 * SSR-safe: silently no-ops when `window` is not available
 * (Node.js, Cloudflare Workers, Vercel Edge, etc.).
 *
 * All `ww:*` lifecycle events flow through this single function,
 * keeping SSR guards in one place rather than scattered across modules.
 *
 * @param name - Event name (e.g., `"ww:ready"`, `"ww:error"`).
 * @param detail - Payload attached to `CustomEvent.detail`.
 *
 * @example
 * ```ts
 * dispatchWatcherEvent('ww:ready', { path: 'Stripe.checkout', value: checkoutObj });
 * // → window.dispatchEvent(new CustomEvent('ww:ready', { detail: { path, value } }))
 * ```
 *
 * @example
 * ```ts
 * // Listening for events:
 * window.addEventListener('ww:error', (e) => {
 *   console.error('Watcher error:', e.detail.error);
 * });
 * ```
 */
export function dispatchWatcherEvent(
  name: string,
  detail: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
