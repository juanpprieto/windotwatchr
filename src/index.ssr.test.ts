/**
 * @vitest-environment node
 *
 * Tests server imports where `window` is undefined.
 * Vitest's server environment runs under Bun without a simulated DOM.
 */
import { describe, expect, it } from 'vitest';
import { waitForWindot, watchWindot } from './index.js';
import { dispatchWatcherEvent } from './core/event-dispatcher.js';

describe('SSR (no window)', () => {
  it('event dispatch is harmless without a window', () => {
    expect(() => dispatchWatcherEvent('ww:ssr', { path: 'SDK' })).not.toThrow();
  });
  it('watchWindot returns a no-op dispose function', () => {
    const dispose = watchWindot('Stripe', () => {});
    expect(typeof dispose).toBe('function');
    dispose(); // should not throw
  });

  it('watchWindot callback is never invoked', async () => {
    let called = false;
    watchWindot('Stripe', () => { called = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(called).toBe(false);
  });

  it('waitForWindot rejects with Error', async () => {
    await expect(waitForWindot('Stripe')).rejects.toThrow(
      'windotwatchr: window is not available',
    );
  });
});
