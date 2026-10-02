import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import React from 'react';
import { resetRegistry } from '../core/windot-watcher.js';
import { useWatchWindot } from './use-watch-windot.js';

/** Typed access to windot properties on `window`. */
type WindotRecord = Record<string, unknown>;

describe('useWatchWindot', () => {
  const ROOT = '__ww_hook__';

  afterEach(() => {
    cleanup();
    resetRegistry();
    vi.restoreAllMocks();
    vi.useRealTimers();
    try {
      delete (window as unknown as WindotRecord)[ROOT];
    } catch {
      // non-configurable
    }
  });

  it('returns { value, status, error } shape', () => {
    const { result } = renderHook(() => useWatchWindot(ROOT));

    const keys = Object.keys(result.current);
    expect(keys).toContain('value');
    expect(keys).toContain('status');
    expect(keys).toContain('error');
  });

  it('initial state is { value: null, status: watching, error: null }', () => {
    const { result } = renderHook(() => useWatchWindot(ROOT));

    expect(result.current.value).toBeNull();
    expect(result.current.status).toBe('watching');
    expect(result.current.error).toBeNull();
  });

  it('transitions to ready when value resolves', async () => {
    const { result } = renderHook(() => useWatchWindot(ROOT));

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = { loaded: true };
      await Promise.resolve();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.value).toEqual({ loaded: true });
    expect(result.current.error).toBeNull();
  });

  it('transitions to timeout when ww:timeout fires', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useWatchWindot(ROOT, { timeout: 100, pollInterval: 0 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.status).toBe('timeout');
    expect(result.current.value).toBeNull();

    vi.useRealTimers();
  });

  it('reports its own predicate failure and clears it after recovery', async () => {
    const testError = new Error('windot test error');
    let broken = true;
    const { result } = renderHook(() =>
      useWatchWindot(ROOT, { correlationId: 'hook-err', pollInterval: 0,
        ready: value => { if (value === undefined) {return false;} if (broken) {throw testError;} return true; },
      }),
    );
    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = 42;
      await Promise.resolve();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(testError);
    await act(async () => {
      broken = false;
      (window as unknown as WindotRecord)[ROOT] = 42;
      await Promise.resolve();
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('ignores ww:timeout/ww:error events with a different correlation id', async () => {
    const { result } = renderHook(() =>
      useWatchWindot(ROOT, { correlationId: 'mine' }),
    );

    await act(async () => {
      // A sibling watcher on the same path times out — different id.
      window.dispatchEvent(
        new CustomEvent('ww:timeout', {
          detail: { path: ROOT, attempts: 0, elapsed: 100, id: 'someone-else' },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('ww:error', {
          detail: { path: ROOT, error: new Error('not mine'), id: 'someone-else' },
        }),
      );
    });

    expect(result.current.status).toBe('watching');
    expect(result.current.error).toBeNull();
  });

  it('two hooks on the same path do not cross-talk', async () => {
    vi.useFakeTimers();

    // Short-timeout hook and a long-timeout hook on the SAME path.
    const short = renderHook(() =>
      useWatchWindot(ROOT, { timeout: 100, pollInterval: 0, correlationId: 'same-label' }),
    );
    const long = renderHook(() =>
      useWatchWindot(ROOT, { timeout: 10_000, pollInterval: 0, correlationId: 'same-label' }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // Only the short watcher timed out; the long one is still watching.
    expect(short.result.current.status).toBe('timeout');
    expect(long.result.current.status).toBe('watching');

    short.unmount();
    long.unmount();
    vi.useRealTimers();
  });

  it('re-subscribes when path changes', async () => {
    const ROOT2 = '__ww_hook_2__';

    const { result, rerender } = renderHook(
      ({ path }) => useWatchWindot(path),
      { initialProps: { path: ROOT } },
    );

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = 'first';
      await Promise.resolve();
    });
    expect(result.current.value).toBe('first');
    expect(result.current.status).toBe('ready');

    // Change path — resets to watching, subscribes to new path
    rerender({ path: ROOT2 });
    expect(result.current.value).toBeNull();
    expect(result.current.status).toBe('watching');

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT2] = 'second';
      await Promise.resolve();
    });
    expect(result.current.value).toBe('second');
    expect(result.current.status).toBe('ready');

    try {
      delete (window as unknown as WindotRecord)[ROOT2];
    } catch {
      // non-configurable
    }
  });

  it('cleans up on unmount — no notifications after unmount', async () => {
    const { result, unmount } = renderHook(() => useWatchWindot(ROOT));

    unmount();

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = 'after-unmount';
      await Promise.resolve();
    });

    expect(result.current.value).toBeNull();
  });

  it('unmount releases its timers, signal listener and descriptor', () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const { unmount } = renderHook(() => useWatchWindot(ROOT, { timeout: 100, signal: controller.signal }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(removeSpy.mock.calls.some(([name]) => name === 'abort')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(Object.getOwnPropertyDescriptor(window, ROOT)).toBeUndefined();
  });

  it('works in StrictMode (double mount/unmount)', async () => {
    const { result } = renderHook(() => useWatchWindot(ROOT), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    expect(result.current.status).toBe('watching');

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = 'strict-value';
      await Promise.resolve();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.value).toBe('strict-value');
  });

  it('supports generic type parameter', async () => {
    interface WindotSDK { init(): void }

    const { result } = renderHook(() => useWatchWindot<WindotSDK>(ROOT));

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = { init: () => {} };
      await Promise.resolve();
    });

    const sdk = result.current.value;
    expect(sdk).not.toBeNull();
    expect(sdk).toHaveProperty('init');
  });

  it('does not re-subscribe when options object identity changes', async () => {
    const { rerender } = renderHook(
      ({ opts }) => useWatchWindot(ROOT, opts),
      { initialProps: { opts: { pollInterval: 100 } } },
    );

    const getter = Object.getOwnPropertyDescriptor(window, ROOT)?.get;

    // Pass a new options object with the same values — should NOT re-subscribe
    rerender({ opts: { pollInterval: 100 } });

    expect(Object.getOwnPropertyDescriptor(window, ROOT)?.get).toBe(getter);
  });

  it('changed timeout takes effect and the old deadline is cancelled', async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ timeout }) => useWatchWindot(ROOT, { timeout, pollInterval: 0 }), { initialProps: { timeout: 10 } });
    rerender({ timeout: 100 });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.status).toBe('watching');
    await act(async () => { await vi.advanceTimersByTimeAsync(90); });
    expect(result.current.status).toBe('timeout');
  });

  it('setup failure reports an error without leaked resources', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWatchWindot(ROOT, { timeout: NaN }));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBeInstanceOf(RangeError);
    expect(vi.getTimerCount()).toBe(0);
    expect(Object.getOwnPropertyDescriptor(window, ROOT)).toBeUndefined();
  });

  it('inline predicate changes recheck readiness without replacing the trap', async () => {
    (window as unknown as WindotRecord)[ROOT] = { level: 1 };
    const { result, rerender } = renderHook(({ level }) => useWatchWindot<{ level: number }>(ROOT, {
      pollInterval: 0, ready: candidate => (candidate as { level: number })?.level >= level,
    }), { initialProps: { level: 2 } });
    const getter = Object.getOwnPropertyDescriptor(window, ROOT)?.get;
    expect(result.current.status).toBe('watching');
    await act(async () => { rerender({ level: 1 }); await Promise.resolve(); });
    expect(result.current.status).toBe('ready');
    expect(result.current.value?.level).toBe(1);
    expect(Object.getOwnPropertyDescriptor(window, ROOT)?.get).toBe(getter);
    await act(async () => { rerender({ level: 2 }); await Promise.resolve(); });
    expect(result.current.status).toBe('watching');
    expect(result.current.value).toBeNull();
  });

  it('abort changes the hook to idle and discards the cancelled value', async () => {
    const controller = new AbortController();
    const { result } = renderHook(() => useWatchWindot(ROOT, { signal: controller.signal, pollInterval: 0 }));
    await act(async () => { (window as unknown as WindotRecord)[ROOT] = 42; await Promise.resolve(); });
    expect(result.current.status).toBe('ready');
    act(() => controller.abort());
    expect(result.current.status).toBe('idle'); expect(result.current.value).toBeNull();
  });
});
