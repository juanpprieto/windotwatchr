import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import React from 'react';
import { resetRegistry } from '../core/global-watcher.js';
import { useWindotWatchrStatus } from './use-windotwatchr-status.js';

/** Typed access to windot properties on `window`. */
type WindotRecord = Record<string, unknown>;

describe('useWindotWatchrStatus', () => {
  const ROOT = '__ww_status__';

  afterEach(() => {
    cleanup();
    resetRegistry();
    try {
      delete (window as unknown as WindotRecord)[ROOT];
    } catch {
      // non-configurable fallback
    }
  });

  it('initial status is watching', () => {
    const { result } = renderHook(() => useWindotWatchrStatus(ROOT));

    expect(result.current.status).toBe('watching');
    expect(result.current.value).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('transitions to ready when value resolves', async () => {
    const { result } = renderHook(() => useWindotWatchrStatus(ROOT));

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
      useWindotWatchrStatus(ROOT, { timeout: 100, pollInterval: 0 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current.status).toBe('timeout');
    expect(result.current.value).toBeNull();

    vi.useRealTimers();
  });

  it('populates error field on ww:error event', async () => {
    const { result } = renderHook(() => useWindotWatchrStatus(ROOT));

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
    const { result } = renderHook(() => useWindotWatchrStatus(ROOT));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('ww:ready', {
          detail: { path: '__ww_other_path__' },
        }),
      );
    });

    // Status stays watching — event was for a different path
    expect(result.current.status).toBe('watching');
  });

  it('returns { value, status, error } shape', () => {
    const { result } = renderHook(() => useWindotWatchrStatus(ROOT));

    const keys = Object.keys(result.current);
    expect(keys).toContain('value');
    expect(keys).toContain('status');
    expect(keys).toContain('error');
  });

  it('cleans up event listeners on unmount', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useWindotWatchrStatus(ROOT));
    unmount();

    const removedEvents = removeSpy.mock.calls.map((call) => call[0]);
    expect(removedEvents).toContain('ww:ready');
    expect(removedEvents).toContain('ww:timeout');
    expect(removedEvents).toContain('ww:error');

    removeSpy.mockRestore();
  });

  it('works in StrictMode (double mount/unmount)', async () => {
    const { result } = renderHook(() => useWindotWatchrStatus(ROOT), {
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
});
