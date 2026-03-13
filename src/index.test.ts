import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetRegistry } from './core/global-watcher.js';
import { waitForGlobal, watchGlobal } from './index.js';

describe('watchGlobal', () => {
  const ROOT = '__ww_api_test__';

  afterEach(() => {
    resetRegistry();
    try {
      delete (window as unknown as Record<string, unknown>)[ROOT];
    } catch {
      // non-configurable fallback
    }
  });

  it('notifies callback when window property is assigned', async () => {
    const cb = vi.fn();
    const dispose = watchGlobal(ROOT, cb);

    (window as unknown as Record<string, unknown>)[ROOT] = { ready: true };

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ready: true }));
    dispose();
  });

  it('returns a dispose function that stops notifications', async () => {
    const cb = vi.fn();
    const dispose = watchGlobal(ROOT, cb);
    dispose();

    (window as unknown as Record<string, unknown>)[ROOT] = 'val';
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });

  it('supports generic type parameter', async () => {
    interface MySDK { init(): void }
    const cb = vi.fn();
    const dispose = watchGlobal<MySDK>(ROOT, cb as (value: MySDK) => void);

    (window as unknown as Record<string, unknown>)[ROOT] = { init: () => {} };

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toHaveProperty('init');
    dispose();
  });

  it('watches nested paths', async () => {
    const cb = vi.fn();
    const dispose = watchGlobal(`${ROOT}.deep.path`, cb);

    (window as unknown as Record<string, unknown>)[ROOT] = {};
    const sdk = (window as unknown as Record<string, unknown>)[ROOT] as Record<string, unknown>;
    sdk.deep = {};
    (sdk.deep as Record<string, unknown>).path = 'found';

    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith('found');
    dispose();
  });
});

describe('waitForGlobal', () => {
  const ROOT = '__ww_wait_test__';

  afterEach(() => {
    resetRegistry();
    try {
      delete (window as unknown as Record<string, unknown>)[ROOT];
    } catch {
      // non-configurable fallback
    }
  });

  it('resolves when property becomes available', async () => {
    const promise = waitForGlobal<{ ok: boolean }>(ROOT);

    // Assign asynchronously
    setTimeout(() => {
      (window as unknown as Record<string, unknown>)[ROOT] = { ok: true };
    }, 10);

    const result = await promise;
    expect(result).toEqual({ ok: true });
  });

  it('resolves immediately (next tick) when value already exists', async () => {
    (window as unknown as Record<string, unknown>)[ROOT] = 'already';

    const result = await waitForGlobal<string>(ROOT);
    expect(result).toBe('already');
  });

  it('auto-disposes the watcher on resolution', async () => {
    const promise = waitForGlobal(ROOT);

    (window as unknown as Record<string, unknown>)[ROOT] = 'val';
    const result = await promise;
    expect(result).toBe('val');

    // Further assignments should not cause issues (watcher is gone)
    expect(() => {
      (window as unknown as Record<string, unknown>)[ROOT] = 'val2';
    }).not.toThrow();
  });
});
