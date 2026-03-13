/**
 * @vitest-environment node
 *
 * Tests SSR behavior where `window` is undefined.
 * Must run in a Node.js environment, not jsdom.
 */
import { describe, expect, it } from 'vitest';
import { waitForWindot, watchWindot } from './index.js';

describe('SSR (no window)', () => {
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
