import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetRegistry } from './core/windot-watcher.js';
import { waitForWindot, watchWindot } from './index.js';

// Helper type for window property access
type WindowRecord = Record<string, unknown>;

describe('watchWindot', () => {
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
    const dispose = watchWindot(ROOT, cb);

    (window as unknown as Record<string, unknown>)[ROOT] = { ready: true };

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ ready: true }));
    dispose();
  });

  it('returns a dispose function that stops notifications', async () => {
    const cb = vi.fn();
    const dispose = watchWindot(ROOT, cb);
    dispose();

    (window as unknown as Record<string, unknown>)[ROOT] = 'val';
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });

  it('supports generic type parameter', async () => {
    interface MySDK { init(): void }
    const cb = vi.fn();
    const dispose = watchWindot<MySDK>(ROOT, cb as (value: MySDK) => void);

    (window as unknown as Record<string, unknown>)[ROOT] = { init: () => {} };

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toHaveProperty('init');
    dispose();
  });

  it('watches nested paths', async () => {
    const cb = vi.fn();
    const dispose = watchWindot(`${ROOT}.deep.path`, cb);

    (window as unknown as Record<string, unknown>)[ROOT] = {};
    const sdk = (window as unknown as Record<string, unknown>)[ROOT] as Record<string, unknown>;
    sdk.deep = {};
    (sdk.deep as Record<string, unknown>).path = 'found';

    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith('found');
    dispose();
  });
});

describe('waitForWindot', () => {
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
    const promise = waitForWindot<{ ok: boolean }>(ROOT);

    // Assign asynchronously
    setTimeout(() => {
      (window as unknown as Record<string, unknown>)[ROOT] = { ok: true };
    }, 10);

    const result = await promise;
    expect(result).toEqual({ ok: true });
  });

  it('resolves immediately (next tick) when value already exists', async () => {
    (window as unknown as Record<string, unknown>)[ROOT] = 'already';

    const result = await waitForWindot<string>(ROOT);
    expect(result).toBe('already');
  });

  it('auto-disposes the watcher on resolution', async () => {
    const promise = waitForWindot(ROOT);

    (window as unknown as Record<string, unknown>)[ROOT] = 'val';
    const result = await promise;
    expect(result).toBe('val');

    // Further assignments should not cause issues (watcher is gone)
    expect(() => {
      (window as unknown as Record<string, unknown>)[ROOT] = 'val2';
    }).not.toThrow();
  });

  it('rejects on timeout with descriptive Error', async () => {
    vi.useFakeTimers();

    const promise = waitForWindot(ROOT, { timeout: 500, pollInterval: 0 });

    // Attach rejection handler before advancing timers to avoid unhandled rejection
    let rejectedError: Error | undefined;
    promise.catch((err: Error) => { rejectedError = err; });

    await vi.advanceTimersByTimeAsync(500);

    expect(rejectedError).toBeDefined();
    expect(rejectedError!.message).toBe(
      `windotwatchr: timeout after 500ms waiting for "${ROOT}"`,
    );

    vi.useRealTimers();
  });

  it('resolves if value appears during retry window', async () => {
    vi.useFakeTimers();

    const promise = waitForWindot(ROOT, {
      timeout: 100,
      retries: 3,
      pollInterval: 50,
    });

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(100);

    // Set value before first retry
    (window as unknown as WindowRecord)[ROOT] = 'during-retry';

    // Advance past first retry
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;
    expect(result).toBe('during-retry');

    vi.useRealTimers();
  });

  it('rejects after all retries exhausted', async () => {
    vi.useFakeTimers();

    const promise = waitForWindot(ROOT, {
      timeout: 100,
      retries: 2,
      pollInterval: 50,
    });

    // Attach rejection handler before advancing timers to avoid unhandled rejection
    let rejectedError: Error | undefined;
    promise.catch((err: Error) => { rejectedError = err; });

    // timeout + 2 retries
    await vi.advanceTimersByTimeAsync(100 + 50 + 50);

    expect(rejectedError).toBeDefined();
    expect(rejectedError!.message).toBe(
      `windotwatchr: timeout after 100ms waiting for "${ROOT}"`,
    );

    vi.useRealTimers();
  });

  it('with AbortSignal: abort rejects', async () => {
    const ctrl = new AbortController();
    const promise = waitForWindot(ROOT, { signal: ctrl.signal });

    ctrl.abort();

    await expect(promise).rejects.toThrow('windotwatchr: aborted');
  });

  it('with already-aborted signal rejects immediately', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(
      waitForWindot(ROOT, { signal: ctrl.signal }),
    ).rejects.toThrow('windotwatchr: aborted');
  });

  it('dispatches ww:timeout event during timeout', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    window.addEventListener('ww:timeout', listener);

    const promise = waitForWindot(ROOT, { timeout: 200, pollInterval: 0 });
    let rejectedError: Error | undefined;
    promise.catch((err: Error) => { rejectedError = err; });

    await vi.advanceTimersByTimeAsync(200);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.path).toBe(ROOT);
    expect(rejectedError).toBeDefined();

    window.removeEventListener('ww:timeout', listener);
    vi.useRealTimers();
  });

  it('cleans up abort listener on normal resolution', async () => {
    const ctrl = new AbortController();
    const removeSpy = vi.spyOn(ctrl.signal, 'removeEventListener');

    const promise = waitForWindot(ROOT, { signal: ctrl.signal });

    (window as unknown as WindowRecord)[ROOT] = 'resolved';
    const result = await promise;

    expect(result).toBe('resolved');
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));

    removeSpy.mockRestore();
  });
});

describe('watchWindot — AbortSignal', () => {
  const ROOT = '__ww_watch_abort__';

  afterEach(() => {
    resetRegistry();
    try {
      delete (window as unknown as WindowRecord)[ROOT];
    } catch {
      // non-configurable fallback
    }
  });

  it('abort stops notifications', async () => {
    const ctrl = new AbortController();
    const cb = vi.fn();
    watchWindot(ROOT, cb, { signal: ctrl.signal, pollInterval: 0 });

    ctrl.abort();

    (window as unknown as WindowRecord)[ROOT] = 'val';
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });
});
