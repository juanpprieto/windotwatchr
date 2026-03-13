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
