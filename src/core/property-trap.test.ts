import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxyWrapper } from './proxy-wrapper.js';
import { installTrap } from './property-trap.js';
import { SubscriptionManager } from './subscription-manager.js';

describe('installTrap', () => {
  const ROOT = '__ww_test_prop__';

  afterEach(() => {
    // Clean up window property after each test
    try {
      delete (window as unknown as Record<string, unknown>)[ROOT];
    } catch {
      // If property is non-configurable, reset by assigning undefined
      (window as unknown as Record<string, unknown>)[ROOT] = undefined;
    }
  });

  function setup(opts?: { pollInterval?: number; readyPredicate?: (v: unknown) => boolean }) {
    const subManager = new SubscriptionManager();
    const proxyWrapper = createProxyWrapper(subManager);
    const dispose = installTrap(ROOT, subManager, proxyWrapper, {
      pollInterval: opts?.pollInterval ?? 0, // disable poll in most tests
      readyPredicate: opts?.readyPredicate,
    });
    return { subManager, proxyWrapper, dispose };
  }

  it('intercepts assignment to window[rootKey]', async () => {
    const { subManager, dispose } = setup();
    const cb = vi.fn();
    subManager.subscribe(ROOT, cb);

    (window as unknown as Record<string, unknown>)[ROOT] = { sdk: true };

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ sdk: true });
    dispose();
  });

  it('getter returns undefined before any assignment', () => {
    const { dispose } = setup();
    expect((window as unknown as Record<string, unknown>)[ROOT]).toBeUndefined();
    dispose();
  });

  it('getter returns the value after assignment', () => {
    const { dispose } = setup();
    (window as unknown as Record<string, unknown>)[ROOT] = { checkout: {} };
    const val = (window as unknown as Record<string, unknown>)[ROOT] as Record<string, unknown>;
    expect(val).toBeDefined();
    expect(val.checkout).toBeDefined();
    dispose();
  });

  it('wraps assigned object in a Proxy (nested set triggers notification)', async () => {
    const { subManager, dispose } = setup();
    const cb = vi.fn();
    subManager.subscribe(`${ROOT}.checkout`, cb);

    (window as unknown as Record<string, unknown>)[ROOT] = {};
    const sdk = (window as unknown as Record<string, unknown>)[ROOT] as Record<string, unknown>;
    sdk.checkout = { ready: true };

    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith({ ready: true });
    dispose();
  });

  it('re-wraps and re-notifies on root replacement', async () => {
    const { subManager, dispose } = setup();
    const cb = vi.fn();
    subManager.subscribe(ROOT, cb);

    (window as unknown as Record<string, unknown>)[ROOT] = { v: 1 };
    (window as unknown as Record<string, unknown>)[ROOT] = { v: 2 };

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('handles primitive value assignment', async () => {
    const { subManager, dispose } = setup();
    const cb = vi.fn();
    subManager.subscribe(ROOT, cb);

    (window as unknown as Record<string, unknown>)[ROOT] = 'string-val';

    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith('string-val');
    dispose();
  });

  it('falls back to polling when value is frozen', async () => {
    vi.useFakeTimers();
    const { subManager, dispose } = setup({ pollInterval: 50 });
    const cb = vi.fn();
    subManager.subscribe(ROOT, cb);

    const frozen = Object.freeze({ api: true });
    (window as unknown as Record<string, unknown>)[ROOT] = frozen;

    // Notification for root key fires via microtask
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);

    dispose();
    vi.useRealTimers();
  });

  it('processes already-existing value on trap installation', async () => {
    (window as unknown as Record<string, unknown>)[ROOT] = { existing: true };

    const subManager = new SubscriptionManager();
    const proxyWrapper = createProxyWrapper(subManager);
    const cb = vi.fn();
    subManager.subscribe(ROOT, cb);

    const dispose = installTrap(ROOT, subManager, proxyWrapper, { pollInterval: 0 });

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ existing: true }));
    dispose();
  });

  it('captures existing value from a getter-based descriptor', async () => {
    Object.defineProperty(window, ROOT, {
      configurable: true,
      enumerable: true,
      get: () => ({ fromGetter: true }),
    });

    const subManager = new SubscriptionManager();
    const proxyWrapper = createProxyWrapper(subManager);
    const cb = vi.fn();
    subManager.subscribe(ROOT, cb);

    const dispose = installTrap(ROOT, subManager, proxyWrapper, { pollInterval: 0 });

    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ fromGetter: true }));
    dispose();
  });

  it('restores original property on dispose when no prior value existed', () => {
    const { dispose } = setup();
    (window as unknown as Record<string, unknown>)[ROOT] = { data: 1 };
    dispose();

    const val = (window as unknown as Record<string, unknown>)[ROOT];
    expect(val).toEqual({ data: 1 });

    const desc = Object.getOwnPropertyDescriptor(window, ROOT);
    expect(desc?.get).toBeUndefined();
    expect(desc?.set).toBeUndefined();
    expect(desc?.writable).toBe(true);
  });

  it('restores a pre-existing property descriptor on dispose', () => {
    const original = { preExisting: true };
    Object.defineProperty(window, ROOT, {
      value: original,
      configurable: true,
      writable: true,
      enumerable: true,
    });

    const { dispose } = setup();
    dispose();

    const desc = Object.getOwnPropertyDescriptor(window, ROOT);
    expect(desc?.value).toEqual(original);
    expect(desc?.writable).toBe(true);
    expect(desc?.configurable).toBe(true);
    expect(desc?.get).toBeUndefined();
    expect(desc?.set).toBeUndefined();
  });

  it('dispose is idempotent', () => {
    const { dispose } = setup();
    dispose();
    expect(() => {
      dispose();
    }).not.toThrow();
  });

  it('dispatches ww:warning when value is frozen', async () => {
    const listener = vi.fn();
    window.addEventListener('ww:warning', listener);

    const { dispose } = setup({ pollInterval: 0 });
    (window as unknown as Record<string, unknown>)[ROOT] = Object.freeze({ api: true });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ path: ROOT, reason: 'frozen' });

    window.removeEventListener('ww:warning', listener);
    dispose();
  });

  it('dispatches ww:warning when value is sealed', async () => {
    const listener = vi.fn();
    window.addEventListener('ww:warning', listener);

    const { dispose } = setup({ pollInterval: 0 });
    (window as unknown as Record<string, unknown>)[ROOT] = Object.seal({ api: true });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ path: ROOT, reason: 'sealed' });

    window.removeEventListener('ww:warning', listener);
    dispose();
  });

  it('dispatches ww:warning when defineProperty fails', async () => {
    const listener = vi.fn();
    window.addEventListener('ww:warning', listener);

    Object.defineProperty(window, ROOT, {
      value: undefined,
      writable: true,
      configurable: false,
    });

    const subManager = new SubscriptionManager();
    const proxyWrapper = createProxyWrapper(subManager);
    const dispose = installTrap(ROOT, subManager, proxyWrapper, { pollInterval: 0 });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ path: ROOT, reason: 'defineProperty failed' });

    window.removeEventListener('ww:warning', listener);
    dispose();
  });

  it('falls back to polling when defineProperty fails', async () => {
    vi.useFakeTimers();

    // Pre-define with configurable: false to make our trap fail
    Object.defineProperty(window, ROOT, {
      value: undefined,
      writable: true,
      configurable: false,
    });

    const subManager = new SubscriptionManager();
    const proxyWrapper = createProxyWrapper(subManager);
    const cb = vi.fn();
    subManager.subscribe(ROOT, cb);

    const dispose = installTrap(ROOT, subManager, proxyWrapper, {
      pollInterval: 50,
    });

    // Set value via direct assignment (our trap didn't install)
    (window as unknown as Record<string, unknown>)[ROOT] = { fallback: true };

    // Poll should find it
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith({ fallback: true });

    dispose();
    vi.useRealTimers();
  });
});
