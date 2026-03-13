import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetRegistry, watch } from './global-watcher.js';

describe('GlobalWatcher (watch)', () => {
  const ROOT = '__ww_gw_test__';

  afterEach(() => {
    resetRegistry();
    try {
      delete (window as unknown as Record<string, unknown>)[ROOT];
    } catch {
      // non-configurable fallback
    }
  });

  it('notifies when root property is assigned', async () => {
    const cb = vi.fn();
    const dispose = watch(ROOT, cb);

    (window as unknown as Record<string, unknown>)[ROOT] = { sdk: true };

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('notifies when nested sub-path is assigned', async () => {
    const cb = vi.fn();
    const dispose = watch(`${ROOT}.checkout`, cb);

    (window as unknown as Record<string, unknown>)[ROOT] = {};
    const sdk = (window as unknown as Record<string, unknown>)[ROOT] as Record<string, unknown>;
    sdk.checkout = { ready: true };

    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith({ ready: true });
    dispose();
  });

  it('shares a singleton per root key — multiple subscribers on same root', async () => {
    const cbA = vi.fn();
    const cbB = vi.fn();

    const dA = watch(`${ROOT}.checkout`, cbA);
    const dB = watch(`${ROOT}.elements`, cbB);

    (window as unknown as Record<string, unknown>)[ROOT] = {};
    const sdk = (window as unknown as Record<string, unknown>)[ROOT] as Record<string, unknown>;
    sdk.checkout = 'c';
    sdk.elements = 'e';

    await Promise.resolve();
    expect(cbA).toHaveBeenCalledWith('c');
    expect(cbB).toHaveBeenCalledWith('e');
    dA();
    dB();
  });

  it('resolves immediately (next microtask) when value already exists', async () => {
    (window as unknown as Record<string, unknown>)[ROOT] = { existing: true };

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, {
      ready: (v) => v !== null && v !== undefined,
    });

    // Not called synchronously
    expect(cb).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('resolves sub-path immediately when value already exists', async () => {
    (window as unknown as Record<string, unknown>)[ROOT] = { api: { ready: true } };

    const cb = vi.fn();
    const dispose = watch(`${ROOT}.api`, cb, {
      ready: (v) => v !== null && v !== undefined,
    });

    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith({ ready: true });
    dispose();
  });

  it('does not resolve already-existing value that fails readiness predicate', async () => {
    (window as unknown as Record<string, unknown>)[ROOT] = null;

    const cb = vi.fn();
    const dispose = watch(ROOT, cb);

    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
    dispose();
  });

  it('tears down RootWatcher when last subscriber disposes', async () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    const d1 = watch(`${ROOT}.a`, cb1);
    const d2 = watch(`${ROOT}.b`, cb2);

    d1();
    d2(); // last subscriber — should tear down

    // Assign after teardown — should NOT notify
    (window as unknown as Record<string, unknown>)[ROOT] = { a: 1, b: 2 };
    await Promise.resolve();
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
  });

  it('dispose is idempotent', () => {
    const dispose = watch(ROOT, vi.fn());
    dispose();
    expect(() => {
      dispose();
    }).not.toThrow();
  });

  it('gates already-existing value through custom readiness predicate', async () => {
    // Value exists but fails the custom predicate (no `init` property)
    (window as unknown as Record<string, unknown>)[ROOT] = { other: true };

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, {
      ready: (v) =>
        typeof v === 'object' && v !== null && 'init' in (v as object),
    });

    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
    dispose();
  });

  it('cleans up sub-path polls on dispose', async () => {
    vi.useFakeTimers();

    // Root exists but sub-path is null (fails default predicate)
    (window as unknown as Record<string, unknown>)[ROOT] = { api: null };

    const cb = vi.fn();
    const dispose = watch(`${ROOT}.api`, cb, { pollInterval: 50 });

    // Dispose stops the poll timer
    dispose();

    // Advance time — no notification should fire after dispose
    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('handles independent root keys without interference', async () => {
    const ROOT2 = '__ww_gw_test2__';
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    const d1 = watch(ROOT, cb1);
    const d2 = watch(ROOT2, cb2);

    (window as unknown as Record<string, unknown>)[ROOT] = 'val1';
    await Promise.resolve();
    expect(cb1).toHaveBeenCalledWith('val1');
    expect(cb2).not.toHaveBeenCalled();

    d1();
    d2();
    delete (window as unknown as Record<string, unknown>)[ROOT2];
  });
});

describe('watch — timeout + retry', () => {
  const ROOT = '__ww_timeout_test__';

  afterEach(() => {
    resetRegistry();
    try {
      delete (window as unknown as Record<string, unknown>)[ROOT];
    } catch {
      // non-configurable fallback
    }
  });

  it('fires ww:timeout event after configured ms', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    window.addEventListener('ww:timeout', listener);

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { timeout: 200, pollInterval: 0 });

    await vi.advanceTimersByTimeAsync(200);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.path).toBe(ROOT);
    expect(event.detail.attempts).toBe(0);
    expect(event.detail.elapsed).toBe(200);

    window.removeEventListener('ww:timeout', listener);
    dispose();
    vi.useRealTimers();
  });

  it('watcher stays alive after timeout (does not auto-dispose)', async () => {
    vi.useFakeTimers();

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { timeout: 100, pollInterval: 0 });

    await vi.advanceTimersByTimeAsync(100);
    expect(cb).not.toHaveBeenCalled();

    // Assign value AFTER timeout — watcher is still subscribed
    (window as unknown as Record<string, unknown>)[ROOT] = { late: true };
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(cb).toHaveBeenCalledTimes(1);

    dispose();
    vi.useRealTimers();
  });

  it('retry re-checks at pollInterval after timeout', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    window.addEventListener('ww:timeout', listener);

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { timeout: 100, retries: 2, pollInterval: 50 });

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(100);
    expect(listener).toHaveBeenCalledTimes(1); // initial timeout

    // Advance one retry interval — value still not there
    await vi.advanceTimersByTimeAsync(50);
    expect(listener).toHaveBeenCalledTimes(2); // retry 1

    window.removeEventListener('ww:timeout', listener);
    dispose();
    vi.useRealTimers();
  });

  it('retry resolves if value appears during retry window', async () => {
    vi.useFakeTimers();

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { timeout: 100, retries: 3, pollInterval: 50 });

    await vi.advanceTimersByTimeAsync(100); // timeout fires

    // Set value before first retry fires
    (window as unknown as Record<string, unknown>)[ROOT] = { found: true };

    await vi.advanceTimersByTimeAsync(50); // retry fires, finds value
    await Promise.resolve();

    expect(cb).toHaveBeenCalledTimes(1);

    dispose();
    vi.useRealTimers();
  });

  it('all retries exhausted — watcher still in timeout state', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    window.addEventListener('ww:timeout', listener);

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { timeout: 100, retries: 2, pollInterval: 50 });

    // timeout + 2 retries
    await vi.advanceTimersByTimeAsync(100); // timeout
    await vi.advanceTimersByTimeAsync(50);  // retry 1
    await vi.advanceTimersByTimeAsync(50);  // retry 2

    // 1 initial timeout + 2 retries = 3 events
    expect(listener).toHaveBeenCalledTimes(3);
    expect(cb).not.toHaveBeenCalled();

    window.removeEventListener('ww:timeout', listener);
    dispose();
    vi.useRealTimers();
  });

  it('dispose during retry window stops further retry events', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    window.addEventListener('ww:timeout', listener);

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { timeout: 100, retries: 5, pollInterval: 50 });

    // Let timeout fire
    await vi.advanceTimersByTimeAsync(100);
    expect(listener).toHaveBeenCalledTimes(1);

    // Dispose during retry window
    dispose();

    // Advance past all remaining retries — no more events
    await vi.advanceTimersByTimeAsync(500);
    expect(listener).toHaveBeenCalledTimes(1); // still just the initial one

    window.removeEventListener('ww:timeout', listener);
    vi.useRealTimers();
  });

  it('trap-based resolution during retry window cancels remaining retries', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    window.addEventListener('ww:timeout', listener);

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { timeout: 100, retries: 5, pollInterval: 50 });

    // Let timeout fire
    await vi.advanceTimersByTimeAsync(100);
    expect(listener).toHaveBeenCalledTimes(1);

    // Value arrives via trap (defineProperty setter), not retry poll
    (window as unknown as Record<string, unknown>)[ROOT] = { fromTrap: true };
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(cb).toHaveBeenCalledTimes(1);

    // Advance past remaining retries — no more timeout events
    await vi.advanceTimersByTimeAsync(300);
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener('ww:timeout', listener);
    dispose();
    vi.useRealTimers();
  });

  it('ww:ready fires for already-existing values (immediate resolve)', async () => {
    vi.useFakeTimers();
    (window as unknown as Record<string, unknown>)[ROOT] = { preloaded: true };

    const readyListener = vi.fn();
    window.addEventListener('ww:ready', readyListener);

    const cb = vi.fn();
    const dispose = watch(ROOT, cb);

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(readyListener).toHaveBeenCalledTimes(1);
    const event = readyListener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail.path).toBe(ROOT);

    window.removeEventListener('ww:ready', readyListener);
    dispose();
    vi.useRealTimers();
  });

  it('timeout cleared when value resolves before timeout', async () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    window.addEventListener('ww:timeout', listener);

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { timeout: 200, pollInterval: 0 });

    // Assign value before timeout
    (window as unknown as Record<string, unknown>)[ROOT] = { early: true };
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(cb).toHaveBeenCalledTimes(1);

    // Advance past timeout — should NOT fire
    await vi.advanceTimersByTimeAsync(200);
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener('ww:timeout', listener);
    dispose();
    vi.useRealTimers();
  });
});

describe('watch — AbortSignal', () => {
  const ROOT = '__ww_abort_test__';

  afterEach(() => {
    resetRegistry();
    try {
      delete (window as unknown as Record<string, unknown>)[ROOT];
    } catch {
      // non-configurable fallback
    }
  });

  it('abort() calls dispose — stops notifications', async () => {
    const ctrl = new AbortController();
    const cb = vi.fn();
    watch(ROOT, cb, { signal: ctrl.signal, pollInterval: 0 });

    ctrl.abort();

    (window as unknown as Record<string, unknown>)[ROOT] = 'val';
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });

  it('already-aborted signal returns no-op dispose immediately', async () => {
    const ctrl = new AbortController();
    ctrl.abort(); // abort before passing

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { signal: ctrl.signal, pollInterval: 0 });

    (window as unknown as Record<string, unknown>)[ROOT] = 'val';
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();

    // Calling dispose again should be safe (idempotent)
    expect(() => dispose()).not.toThrow();
  });

  it('abort during retry window stops retries', async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    const listener = vi.fn();
    window.addEventListener('ww:timeout', listener);

    const cb = vi.fn();
    watch(ROOT, cb, { signal: ctrl.signal, timeout: 100, retries: 5, pollInterval: 50 });

    // Let timeout fire
    await vi.advanceTimersByTimeAsync(100);
    expect(listener).toHaveBeenCalledTimes(1);

    // Abort during retry window
    ctrl.abort();

    // Advance past remaining retries — should produce no more events
    await vi.advanceTimersByTimeAsync(300);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cb).not.toHaveBeenCalled();

    window.removeEventListener('ww:timeout', listener);
    vi.useRealTimers();
  });

  it('abort listener is removed on manual dispose', () => {
    const ctrl = new AbortController();
    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { signal: ctrl.signal, pollInterval: 0 });

    dispose();

    // Aborting after dispose should not throw or cause issues
    expect(() => ctrl.abort()).not.toThrow();
  });
});

describe('resetRegistry', () => {
  it('tears down all watchers', async () => {
    const cb = vi.fn();
    watch('__reset_test__', cb);

    resetRegistry();

    (window as unknown as Record<string, unknown>).__reset_test__ = 'val';
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();

    delete (window as unknown as Record<string, unknown>).__reset_test__;
  });
});
