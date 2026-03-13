import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePath, startPolling } from './poll-fallback.js';
import { SubscriptionManager } from './subscription-manager.js';

describe('resolvePath', () => {
  it('resolves a single-level path', () => {
    expect(resolvePath({ a: 1 }, 'a')).toBe(1);
  });

  it('resolves a multi-level path', () => {
    expect(resolvePath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('returns undefined for a missing intermediate segment', () => {
    expect(resolvePath({ a: { b: 1 } }, 'a.x.c')).toBeUndefined();
  });

  it('returns undefined for a missing leaf segment', () => {
    expect(resolvePath({ a: { b: 1 } }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined when root is null', () => {
    expect(resolvePath({ a: null } as object, 'a.b')).toBeUndefined();
  });

  it('handles empty string segments in path', () => {
    // Edge case: "a..b" splits to ["a", "", "b"]
    expect(resolvePath({ a: { '': { b: 1 } } }, 'a..b')).toBe(1);
  });
});

describe('startPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clean up window properties
    delete (window as unknown as Record<string, unknown>).TestSDK;
  });

  it('notifies when path value becomes ready', async () => {
    const mgr = new SubscriptionManager();
    const cb = vi.fn();
    mgr.subscribe('TestSDK.api', cb);

    startPolling('TestSDK.api', mgr, { interval: 50 });

    // Value not set yet — first check
    await vi.advanceTimersByTimeAsync(50);
    expect(cb).not.toHaveBeenCalled();

    // Set the value
    (window as unknown as Record<string, unknown>).TestSDK = { api: { ready: true } };

    // Next poll finds it
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve(); // flush microtask from notifySubscribers
    expect(cb).toHaveBeenCalledWith({ ready: true });
  });

  it('stops polling after value is found', async () => {
    const mgr = new SubscriptionManager();
    const cb = vi.fn();
    mgr.subscribe('TestSDK', cb);

    (window as unknown as Record<string, unknown>).TestSDK = 'found';
    startPolling('TestSDK', mgr, { interval: 50 });

    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);

    // Further ticks should not call again
    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('dispose stops the polling timer', async () => {
    const mgr = new SubscriptionManager();
    const cb = vi.fn();
    mgr.subscribe('TestSDK', cb);

    const dispose = startPolling('TestSDK', mgr, { interval: 50 });
    dispose();

    (window as unknown as Record<string, unknown>).TestSDK = 'val';
    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });

  it('uses custom readiness predicate', async () => {
    const mgr = new SubscriptionManager();
    const cb = vi.fn();
    mgr.subscribe('TestSDK', cb);

    // Set a value that fails the custom predicate
    (window as unknown as Record<string, unknown>).TestSDK = { initialized: false };

    startPolling('TestSDK', mgr, {
      interval: 50,
      readyPredicate: (v) =>
        typeof v === 'object' && v !== null && (v as Record<string, boolean>).initialized === true,
    });

    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();

    // Update to pass the predicate
    (window as unknown as Record<string, unknown>).TestSDK = { initialized: true };
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith({ initialized: true });
  });

  it('uses default interval when not specified', async () => {
    const mgr = new SubscriptionManager();
    const cb = vi.fn();
    mgr.subscribe('TestSDK', cb);

    (window as unknown as Record<string, unknown>).TestSDK = 'val';
    startPolling('TestSDK', mgr);

    // Default interval is 100ms
    await vi.advanceTimersByTimeAsync(99);
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(cb).toHaveBeenCalled();
  });
});
