import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import React from 'react';
import { resetRegistry } from '../core/windot-watcher.js';
import { useWindotWatchr } from './use-windotwatchr.js';

/** Typed access to windot properties on `window`. */
type WindotRecord = Record<string, unknown>;

describe('useWindotWatchr (single path)', () => {
  const ROOT = '__ww_hook__';

  afterEach(() => {
    cleanup();
    resetRegistry();
    try {
      delete (window as unknown as WindotRecord)[ROOT];
    } catch {
      // non-configurable fallback
    }
  });

  it('returns null initially', () => {
    const { result } = renderHook(() => useWindotWatchr(ROOT));
    expect(result.current).toBeNull();
  });

  it('returns value after windot property is assigned', async () => {
    const { result } = renderHook(() => useWindotWatchr(ROOT));

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = { ready: true };
      await Promise.resolve();
    });

    expect(result.current).toEqual({ ready: true });
  });

  it('re-subscribes when path changes', async () => {
    const ROOT2 = '__ww_hook_2__';

    const { result, rerender } = renderHook(
      ({ path }) => useWindotWatchr(path),
      { initialProps: { path: ROOT } },
    );

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = 'first';
      await Promise.resolve();
    });
    expect(result.current).toBe('first');

    // Change path — resets to null, subscribes to new path
    rerender({ path: ROOT2 });
    expect(result.current).toBeNull();

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT2] = 'second';
      await Promise.resolve();
    });
    expect(result.current).toBe('second');

    try {
      delete (window as unknown as WindotRecord)[ROOT2];
    } catch {
      // non-configurable fallback
    }
  });

  it('cleans up on unmount — no notifications after unmount', async () => {
    const { result, unmount } = renderHook(() => useWindotWatchr(ROOT));

    unmount();

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = 'after-unmount';
      await Promise.resolve();
    });

    // result.current frozen at last render — still null
    expect(result.current).toBeNull();
  });

  it('works in StrictMode (double mount/unmount)', async () => {
    const { result } = renderHook(() => useWindotWatchr(ROOT), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = 'strict-value';
      await Promise.resolve();
    });

    expect(result.current).toBe('strict-value');
  });

  it('supports generic type parameter', async () => {
    interface WindotSDK { init(): void }

    const { result } = renderHook(() => useWindotWatchr<WindotSDK>(ROOT));

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT] = { init: () => {} };
      await Promise.resolve();
    });

    const sdk = result.current;
    expect(sdk).not.toBeNull();
    expect(sdk).toHaveProperty('init');
  });

  it('does not re-subscribe when options object identity changes', async () => {
    const watchSpy = vi.spyOn(await import('../index.js'), 'watchWindot');

    const { rerender } = renderHook(
      ({ opts }) => useWindotWatchr(ROOT, opts),
      { initialProps: { opts: { pollInterval: 100 } } },
    );

    const callCountAfterMount = watchSpy.mock.calls.length;

    // Pass a new options object with the same values — should NOT re-subscribe
    rerender({ opts: { pollInterval: 100 } });

    expect(watchSpy.mock.calls.length).toBe(callCountAfterMount);

    watchSpy.mockRestore();
  });
});

describe('useWindotWatchr (multi path)', () => {
  const ROOT_A = '__ww_multi_a__';
  const ROOT_B = '__ww_multi_b__';

  afterEach(() => {
    cleanup();
    resetRegistry();
    for (const key of [ROOT_A, ROOT_B]) {
      try {
        delete (window as unknown as WindotRecord)[key];
      } catch {
        // non-configurable fallback
      }
    }
  });

  it('returns record with all keys null initially', () => {
    const { result } = renderHook(() => useWindotWatchr([ROOT_A, ROOT_B]));

    expect(result.current).toEqual({
      [ROOT_A]: null,
      [ROOT_B]: null,
    });
  });

  it('updates individual keys as values arrive', async () => {
    const { result } = renderHook(() => useWindotWatchr([ROOT_A, ROOT_B]));

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT_A] = 'value-a';
      await Promise.resolve();
    });

    expect(result.current[ROOT_A]).toBe('value-a');
    expect(result.current[ROOT_B]).toBeNull();

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT_B] = 'value-b';
      await Promise.resolve();
    });

    expect(result.current[ROOT_A]).toBe('value-a');
    expect(result.current[ROOT_B]).toBe('value-b');
  });

  it('handles path list changes — re-subscribes', async () => {
    const ROOT_C = '__ww_multi_c__';

    const { result, rerender } = renderHook(
      ({ paths }) => useWindotWatchr(paths),
      { initialProps: { paths: [ROOT_A, ROOT_B] } },
    );

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT_A] = 'a';
      await Promise.resolve();
    });
    expect(result.current[ROOT_A]).toBe('a');

    // Change paths — resets all values
    rerender({ paths: [ROOT_B, ROOT_C] });
    expect(result.current[ROOT_B]).toBeNull();
    expect(result.current).not.toHaveProperty(ROOT_A);

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT_C] = 'c';
      await Promise.resolve();
    });
    expect(result.current[ROOT_C]).toBe('c');

    try {
      delete (window as unknown as WindotRecord)[ROOT_C];
    } catch {
      // non-configurable fallback
    }
  });

  it('cleans up all watchers on unmount', async () => {
    const { result, unmount } = renderHook(() => useWindotWatchr([ROOT_A, ROOT_B]));

    unmount();

    await act(async () => {
      (window as unknown as WindotRecord)[ROOT_A] = 'after-unmount';
      (window as unknown as WindotRecord)[ROOT_B] = 'after-unmount';
      await Promise.resolve();
    });

    expect(result.current[ROOT_A]).toBeNull();
    expect(result.current[ROOT_B]).toBeNull();
  });
});
