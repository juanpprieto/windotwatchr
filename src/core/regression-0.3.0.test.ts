/**
 * Regression tests for the 0.3.0 fixes: wholesale-assignment resolution,
 * predicate enforcement, poll ref-counting, dispose safety, strategy, and
 * hardening. Each reproduces a concrete failure and asserts the fix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetRegistry, watch } from './windot-watcher.js';
import { watchWindot } from '../index.js';

const W = window as unknown as Record<string, unknown>;
const ROOT = '__ww_ac_test__';

/** Flush the microtask queue a couple of times for scheduled deliveries. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  resetRegistry();
  vi.useRealTimers();
  try {
    delete W[ROOT];
  } catch {
    // may be a leftover accessor from a throwing-getter test
    Object.defineProperty(window, ROOT, { value: undefined, configurable: true, writable: true });
    delete W[ROOT];
  }
});

describe('wholesale root assignment resolves pre-registered sub-path watchers', () => {
  it('resolves a sub-path watcher with pollInterval:0 (descendant resolution, no poll)', async () => {
    const cb = vi.fn();
    watch(`${ROOT}.checkout`, cb, { pollInterval: 0 });

    W[ROOT] = { checkout: { ready: true } };

    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ ready: true });
  });

  it('resolves with the default pollInterval too', async () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    watch(`${ROOT}.checkout`, cb);

    W[ROOT] = { checkout: { ready: true } };

    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(cb).toHaveBeenCalledWith({ ready: true });
  });

  it('resolves a 3-level path whose middle arrives wholesale', async () => {
    const cb = vi.fn();
    watch(`${ROOT}.a.b`, cb, { pollInterval: 0 });

    W[ROOT] = { a: { b: 42 } };

    await flush();
    expect(cb).toHaveBeenCalledWith(42);
  });

  it('resolves a sub-path when the root arrives frozen (poll path)', async () => {
    const cb = vi.fn();
    watch(`${ROOT}.checkout`, cb, { pollInterval: 0 });

    W[ROOT] = Object.freeze({ checkout: { ready: 1 } });

    await flush();
    expect(cb).toHaveBeenCalledWith({ ready: 1 });
  });

  it('re-fires on root reassignment when not `once`', async () => {
    const cb = vi.fn();
    watch(`${ROOT}.checkout`, cb, { pollInterval: 0 });

    W[ROOT] = { checkout: { v: 1 } };
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith({ v: 1 });

    W[ROOT] = { checkout: { v: 2 } };
    await flush();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith({ v: 2 });
  });

  it('does not double-fire when both a poll and the set trap resolve the same value', async () => {
    vi.useFakeTimers();
    W[ROOT] = {}; // root exists & proxied; checkout not yet present → poll starts
    const cb = vi.fn();
    watch(`${ROOT}.checkout`, cb, { pollInterval: 50 });

    (W[ROOT] as Record<string, unknown>).checkout = { ready: 1 }; // set trap delivers

    await vi.advanceTimersByTimeAsync(200); // poll finds the same reference → deduped
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('readiness predicate enforced on every delivery', () => {
  it('does not fire for values that fail the predicate, including null', async () => {
    const cb = vi.fn();
    watch(ROOT, cb, { ready: (v: any) => v?.loaded === true, pollInterval: 0 });

    W[ROOT] = { loaded: false };
    await flush();
    expect(cb).not.toHaveBeenCalled();

    W[ROOT] = null;
    await flush();
    expect(cb).not.toHaveBeenCalled();

    W[ROOT] = { loaded: true };
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('honors different predicates for two watchers on the same path', async () => {
    const strict = vi.fn();
    const loose = vi.fn();
    watch(ROOT, strict, { ready: (v: any) => v?.ready === true, pollInterval: 0 });
    watch(ROOT, loose, { pollInterval: 0 });

    W[ROOT] = { ready: false };
    await flush();

    expect(strict).not.toHaveBeenCalled();
    expect(loose).toHaveBeenCalledTimes(1);
  });
});

describe('ref-counted sub-path polls', () => {
  it('keeps polling for remaining subscribers after one disposes', async () => {
    vi.useFakeTimers();
    const cbA = vi.fn();
    const cbB = vi.fn();
    // strategy 'poll' → no trap; the shared poll is the ONLY detection route,
    // isolating the ref-count behavior from descendant resolution.
    const dA = watch(`${ROOT}.sub`, cbA, { strategy: 'poll', pollInterval: 50 });
    watch(`${ROOT}.sub`, cbB, { strategy: 'poll', pollInterval: 50 });

    dA(); // must NOT stop the shared poll

    W[ROOT] = { sub: { ok: 1 } };
    await vi.advanceTimersByTimeAsync(100);
    await flush();

    expect(cbB).toHaveBeenCalledWith({ ok: 1 });
    expect(cbA).not.toHaveBeenCalled();
  });

  it('stops the shared poll (zero timers) once the last subscriber disposes', async () => {
    vi.useFakeTimers();
    const dA = watch(`${ROOT}.sub`, vi.fn(), { strategy: 'poll', pollInterval: 50 });
    const dB = watch(`${ROOT}.sub`, vi.fn(), { strategy: 'poll', pollInterval: 50 });

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    dA();
    expect(vi.getTimerCount()).toBeGreaterThan(0); // B still polling
    dB();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('no delivery after dispose', () => {
  it('does not fire a callback disposed in the same task as the assignment', async () => {
    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { pollInterval: 0 });

    W[ROOT] = { ready: true }; // notification scheduled on microtask
    dispose(); // before the microtask runs

    await flush();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('dispose preserves the SDK-assigned value', () => {
  it('does not revert window[root] to its stale pre-trap value', () => {
    W[ROOT] = 'placeholder';
    const dispose = watch(ROOT, vi.fn(), { pollInterval: 0 });

    W[ROOT] = { real: 'sdk' };
    dispose(); // last subscriber → teardown → restore

    expect(W[ROOT]).toMatchObject({ real: 'sdk' });
  });

  it('survives an unmount→remount cycle with the value intact (StrictMode shape)', async () => {
    W[ROOT] = 'placeholder';
    const d1 = watch(ROOT, vi.fn(), { pollInterval: 0 });
    W[ROOT] = { real: 'sdk' };
    d1(); // unmount

    const cb2 = vi.fn();
    const d2 = watch(ROOT, cb2, { pollInterval: 0 }); // remount traps the existing value

    await flush();
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(W[ROOT]).toMatchObject({ real: 'sdk' });
    d2();
  });
});

describe('strategy is honored', () => {
  it('strategy:"poll" never installs an accessor on window', async () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { strategy: 'poll', pollInterval: 50 });

    // Before assignment: nothing defined by us.
    expect(Object.getOwnPropertyDescriptor(window, ROOT)).toBeUndefined();

    W[ROOT] = { ready: 1 };
    const desc = Object.getOwnPropertyDescriptor(window, ROOT);
    expect(desc && 'get' in desc).toBeFalsy(); // plain data property, no trap

    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(cb).toHaveBeenCalledWith({ ready: 1 });
    dispose();
  });

  it('strategy:"proxy" warns on a frozen value and starts no poll timer', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    window.addEventListener('ww:warning', warn);

    const dispose = watch(ROOT, vi.fn(), { strategy: 'proxy' });
    W[ROOT] = Object.freeze({ frozen: true });
    await flush();

    const frozenWarn = warn.mock.calls
      .map((c) => (c[0] as CustomEvent).detail)
      .find((d) => d.path === ROOT);
    expect(frozenWarn?.reason).toBe('frozen');
    expect(vi.getTimerCount()).toBe(0); // no poll fallback under 'proxy'

    window.removeEventListener('ww:warning', warn);
    dispose();
  });
});

describe('hardening', () => {
  it('watching a reserved Window built-in warns, polls, and leaves the native untouched', async () => {
    const warn = vi.fn();
    window.addEventListener('ww:warning', warn);
    const originalDoc = window.document;

    const dispose = watch('document.body', vi.fn(), { pollInterval: 0 });

    const reservedWarn = warn.mock.calls
      .map((c) => (c[0] as CustomEvent).detail)
      .find((d) => d.path === 'document');
    expect(reservedWarn?.reason).toBe('reserved');
    // window.document must remain the native object — never trapped.
    expect(window.document).toBe(originalDoc);

    window.removeEventListener('ww:warning', warn);
    dispose();
  });

  it('poll survives a throwing getter (ww:error) and resolves once it stops throwing', async () => {
    vi.useFakeTimers();
    const errListener = vi.fn();
    window.addEventListener('ww:error', errListener);

    let throwing = true;
    Object.defineProperty(window, ROOT, {
      configurable: true,
      get() {
        if (throwing) { throw new Error('hostile getter'); }
        return { ok: 1 };
      },
    });

    const cb = vi.fn();
    const dispose = watch(ROOT, cb, { strategy: 'poll', pollInterval: 50 });

    await vi.advanceTimersByTimeAsync(50); // getter throws → ww:error + reschedule
    expect(errListener).toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();

    throwing = false;
    await vi.advanceTimersByTimeAsync(50); // now resolves
    await flush();
    expect(cb).toHaveBeenCalledWith({ ok: 1 });

    window.removeEventListener('ww:error', errListener);
    dispose();
  });

  it('a rejected (non-writable) proxied write does not notify', async () => {
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, 'locked', {
      value: 'orig', writable: false, configurable: false, enumerable: true,
    });
    W[ROOT] = target;

    const cb = vi.fn();
    watch(`${ROOT}.locked`, cb, { pollInterval: 0 });
    await flush();
    expect(cb).toHaveBeenCalledTimes(1); // initial value delivered once
    expect(cb).toHaveBeenCalledWith('orig');

    const proxied = W[ROOT] as Record<string, unknown>;
    try {
      proxied.locked = 'new'; // rejected — non-writable
    } catch {
      // strict-mode assignment throws when the set trap returns false
    }

    await flush();
    expect(cb).toHaveBeenCalledTimes(1); // failed write produced no notification
  });
});

describe('platform APIs', () => {
  it('watchWindot dispose supports Symbol.dispose', async () => {
    const cb = vi.fn();
    const dispose = watchWindot(ROOT, cb, { pollInterval: 0 });

    expect(typeof dispose[Symbol.dispose]).toBe('function');

    // Disposing via the protocol stops delivery.
    W[ROOT] = { ready: true };
    dispose[Symbol.dispose]();
    await flush();
    expect(cb).not.toHaveBeenCalled();

    expect(() => dispose()).not.toThrow(); // still idempotent as a plain fn
  });

  it('once:true delivers exactly once and tears down', async () => {
    const cb = vi.fn();
    watch(ROOT, cb, { once: true, pollInterval: 0 });

    W[ROOT] = { v: 1 };
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);

    W[ROOT] = { v: 2 }; // watcher already disposed → no second delivery
    await flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
