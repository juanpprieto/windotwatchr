/**
 * @vitest-environment node
 *
 * Tests SSR behavior where `window` is undefined.
 * Must run in a Node.js environment, not jsdom.
 */
import { describe, expect, it } from 'vitest';
import { waitForGlobal, watchGlobal } from './index.js';

describe('SSR (no window)', () => {
  it('watchGlobal returns a no-op dispose function', () => {
    const dispose = watchGlobal('Stripe', () => {});
    expect(typeof dispose).toBe('function');
    dispose(); // should not throw
  });

  it('watchGlobal callback is never invoked', async () => {
    let called = false;
    watchGlobal('Stripe', () => { called = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(called).toBe(false);
  });

  it('waitForGlobal rejects with Error', async () => {
    await expect(waitForGlobal('Stripe')).rejects.toThrow(
      'windotwatchr: window is not available',
    );
  });
});
