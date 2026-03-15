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

  it('populates error field on ww:error event', async () => {
    const { result } = renderHook(() => useWatchWindot(ROOT));

    const testError = new Error('windot test error');

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('ww:error', {
          detail: { path: ROOT, error: testError },
        }),
      );
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(testError);
  });

  it('ignores events for other paths', async () => {
    const { result } = renderHook(() => useWatchWindot(ROOT));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('ww:ready', {
          detail: { path: '__ww_other_path__' },
        }),
      );
    });

    expect(result.current.status).toBe('watching');
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

  it('cleans up event listeners on unmount', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useWatchWindot(ROOT));
    unmount();

    const removedEvents = removeSpy.mock.calls.map((call) => call[0]);
    expect(removedEvents).toContain('ww:ready');
    expect(removedEvents).toContain('ww:timeout');
    expect(removedEvents).toContain('ww:error');

    removeSpy.mockRestore();
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
    const watchSpy = vi.spyOn(await import('../index.js'), 'watchWindot');

    const { rerender } = renderHook(
      ({ opts }) => useWatchWindot(ROOT, opts),
      { initialProps: { opts: { pollInterval: 100 } } },
    );

    const callCountAfterMount = watchSpy.mock.calls.length;

    // Pass a new options object with the same values — should NOT re-subscribe
    rerender({ opts: { pollInterval: 100 } });

    expect(watchSpy.mock.calls.length).toBe(callCountAfterMount);

    watchSpy.mockRestore();
  });
});
