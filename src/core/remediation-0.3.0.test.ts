/** Durable acceptance cases omitted by the original 0.3.0 suite. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watch, resetRegistry } from './windot-watcher.js';
import { waitForWindot, watchWindot } from '../index.js';

const globals = window as unknown as Record<string, any>;
const roots: string[] = [];
const listeners: Array<[string, EventListener]> = [];
let sequence = 0;
const root = (): string => { const key = `__ww_remediation_${++sequence}`; roots.push(key); return key; };
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };
const listen = (name: string, fn: EventListener): void => { listeners.push([name, fn]); window.addEventListener(name, fn); };

afterEach(async () => {
  resetRegistry();
  await flush();
  for (const [name, fn] of listeners.splice(0)) {window.removeEventListener(name, fn);}
  for (const key of roots.splice(0)) {
    if (Object.getOwnPropertyDescriptor(window, key)?.configurable !== false) {delete globals[key];}
    else {globals[key] = undefined;}
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('0.3.0 remediation acceptance', () => {
  it('ordinary callbacks and direct disposal work without Symbol.dispose', async () => {
    const symbolFacade = Object.create(Symbol);
    Object.defineProperty(symbolFacade, 'dispose', { value: undefined });
    vi.stubGlobal('Symbol', symbolFacade);
    const key = root(); const callback = vi.fn(); const dispose = watchWindot(key, callback, { pollInterval: 0 });
    globals[key] = 42; await flush(); expect(callback).toHaveBeenCalledExactlyOnceWith(42);
    dispose(); expect(Object.getOwnPropertyDescriptor(window, key)?.get).toBeUndefined();
  });
  it('a retained proxy resumes notifications after its raw object is reattached', async () => {
    const key = root(); const child = { api: 1 }; globals[key] = { branch: child }; const callback = vi.fn();
    watch(`${key}.branch.api`, callback, { pollInterval: 0 }); await flush(); const held = globals[key].branch;
    globals[key].branch = { api: 2 }; await flush(); callback.mockClear(); held.api = 3; await flush(); expect(callback).not.toHaveBeenCalled();
    globals[key].branch = child; await flush(); callback.mockClear(); held.api = 4; await flush(); expect(callback).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('an error listener disposing the previous watcher cannot orphan a pending registration', async () => {
    const key = root(); const first = watch(`${key}.api`, vi.fn(), { pollInterval: 0, ready: value => { if (value === 1) {throw new Error('refresh');} return false; } });
    Object.defineProperty(window, key, { value: { api: 1 }, writable: true, configurable: true });
    listen('ww:error', (() => first()) as EventListener);
    const callback = vi.fn(); const second = watch(`${key}.api`, callback, { pollInterval: 0 }); await flush();
    expect(callback).toHaveBeenCalledWith(1);
    expect(() => watch(key, vi.fn(), { strategy: 'poll', pollInterval: 0 })).toThrow(/strategy conflict/);
    resetRegistry(); expect(Object.getOwnPropertyDescriptor(window, key)?.get).toBeUndefined(); second();
  });
  it('a retained branch write reports ancestor lookup failure without throwing', async () => {
    const key = root(); const child = { api: 1 }; let broken = false; const errors = vi.fn(); listen('ww:error', errors);
    globals[key] = { get branch() { if (broken) {throw new Error('ancestor getter');} return child; } };
    watch(`${key}.branch.api`, vi.fn(), { pollInterval: 0 }); await flush(); const held = globals[key].branch;
    broken = true; expect(() => { held.api = 42; }).not.toThrow(); await flush(); expect(errors).toHaveBeenCalledTimes(1);
  });
  it.each(['timeout', 'pollInterval', 'retries'] as const)('%s rejects invalid numbers before allocating', async option => {
    vi.useFakeTimers(); const values = [-1, NaN, Infinity, -Infinity, 2_147_483_648];
    if (option === 'retries') {values.push(1.5);}
    await Promise.all(values.map(async value => {
      const key = root(); const controller = new AbortController(); const add = vi.spyOn(controller.signal, 'addEventListener');
      expect(() => watch(key, vi.fn(), { [option]: value, signal: controller.signal })).toThrow(RangeError);
      await expect(waitForWindot(key, { [option]: value, signal: controller.signal })).rejects.toBeInstanceOf(RangeError);
      expect(Object.getOwnPropertyDescriptor(window, key)).toBeUndefined(); expect(add).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    }));
  });

  it('timer setup failure rolls back a trap and abort listener', async () => {
    const key = root(); const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener');
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => { throw new Error('timer setup'); });
    await expect(waitForWindot(key, { signal: controller.signal })).rejects.toThrow('timer setup');
    expect(Object.getOwnPropertyDescriptor(window, key)).toBeUndefined(); expect(remove.mock.calls.some(([name]) => name === 'abort')).toBe(true);
  });

  it('poll errors are one per subscription episode; recovery and new join reset reporting', async () => {
    vi.useFakeTimers(); const key = root(); let broken = true; let thrown = new Error('first'); const errors = vi.fn(); const ready = vi.fn(); listen('ww:error', errors);
    globals[key] = { get api() { if (broken) {throw thrown;} return 42; } };
    const a = watch(`${key}.api`, ready, { strategy: 'poll', pollInterval: 10, correlationId: 'a' });
    await vi.advanceTimersByTimeAsync(20); thrown = new Error('changed'); await vi.advanceTimersByTimeAsync(10);
    expect(errors).toHaveBeenCalledTimes(1);
    const b = watch(`${key}.api`, vi.fn(), { strategy: 'poll', pollInterval: 10, correlationId: 'b' });
    expect(errors).toHaveBeenCalledTimes(2); broken = false; await vi.advanceTimersByTimeAsync(10); expect(ready).toHaveBeenCalledWith(42);
    broken = true; await vi.advanceTimersByTimeAsync(10); expect(errors).toHaveBeenCalledTimes(4);
    a(); b(); await vi.advanceTimersByTimeAsync(20); expect(errors).toHaveBeenCalledTimes(4);
  });

  it('a raw A-to-B-to-A history between polls is unobservable', async () => {
    vi.useFakeTimers(); const key = root(); const sdk = { api: 'A' }; globals[key] = sdk; const callback = vi.fn();
    watch(`${key}.api`, callback, { strategy: 'poll', pollInterval: 10 }); await flush();
    sdk.api = 'B'; sdk.api = 'A'; await vi.advanceTimersByTimeAsync(10); expect(callback.mock.calls).toEqual([['A']]);
  });

  it('an external predicate flag requires enabled snapshot checks', async () => {
    vi.useFakeTimers(); const key = root(); let enabled = false; globals[key] = {}; const polled = vi.fn(); const intercepted = vi.fn();
    watch(key, polled, { pollInterval: 10, ready: () => enabled }); watch(key, intercepted, { strategy: 'proxy', ready: () => enabled });
    enabled = true; await vi.advanceTimersByTimeAsync(10); expect(polled).toHaveBeenCalledTimes(1); expect(intercepted).not.toHaveBeenCalled();
  });

  it('ready-event predicate invalidation suppresses callback', async () => {
    const key = root(); const value = { ready: true }; const callback = vi.fn();
    watch(key, callback, { pollInterval: 0, ready: v => (v as typeof value)?.ready === true });
    listen('ww:ready', ((event: CustomEvent) => { if (event.detail.path === key) {value.ready = false;} }) as EventListener);
    globals[key] = value; await flush(); expect(callback).not.toHaveBeenCalled();
  });

  it('once survives reentrant writes and overlapping queued occurrences', async () => {
    const key = root(); const callback = vi.fn(() => { globals[key] = 3; });
    watch(key, callback, { pollInterval: 0, once: true }); globals[key] = 1; globals[key] = 2; await flush();
    expect(callback).toHaveBeenCalledExactlyOnceWith(1); expect(globals[key]).toBe(3);
  });

  it('manual timeout and abort work without optional AbortSignal static methods or reason', async () => {
    vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { throw new Error('must not call timeout'); });
    if ('any' in AbortSignal) {vi.spyOn(AbortSignal, 'any').mockImplementation(() => { throw new Error('must not call any'); });}
    const key = root(); const signal = new EventTarget() as EventTarget & { aborted: boolean }; signal.aborted = false;
    const result = waitForWindot(key, { signal: signal as AbortSignal, timeout: 10 }).catch(error => error);
    signal.aborted = true; signal.dispatchEvent(new Event('abort'));
    expect((await result).name).toBe('AbortError'); expect(vi.getTimerCount()).toBe(0);
    const timeout = waitForWindot(root(), { timeout: 1.5, pollInterval: 0 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(2); expect((await timeout).name).toBe('TimeoutError'); expect(vi.getTimerCount()).toBe(0);
  });

  it('missing DOMException retains recognizable timeout/abort names', async () => {
    vi.useFakeTimers(); vi.stubGlobal('DOMException', undefined);
    const result = waitForWindot(root(), { timeout: 1, pollInterval: 0 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1); expect((await result).name).toBe('TimeoutError');
  });

  it('nested setters report the actual transformed or ignored value', async () => {
    const key = root(); let value = 1; const callback = vi.fn();
    globals[key] = { get api() { return value; }, set api(next: number) { if (next > 0) {value = next * 2;} } };
    watch(`${key}.api`, callback, { pollInterval: 0 }); await flush(); callback.mockClear();
    globals[key].api = 5; globals[key].api = -1; await flush();
    expect(callback.mock.calls).toEqual([[10], [10]]);
  });

  it('a post-set getter failure cannot turn a successful SDK write into an exception', async () => {
    const key = root(); let value = 1; let broken = false; const callback = vi.fn(); const errors = vi.fn(); listen('ww:error', errors);
    globals[key] = { get api() { if (broken) {throw new Error('post-set');} return value; }, set api(next: number) { value = next; broken = true; } };
    watch(`${key}.api`, callback, { pollInterval: 0 }); await flush(); callback.mockClear();
    expect(() => { globals[key].api = 5; }).not.toThrow(); await flush();
    expect(callback).not.toHaveBeenCalled(); expect(errors).toHaveBeenCalledTimes(1);
  });

  it('locking an active root cannot prevent cleanup and raw access', async () => {
    vi.useFakeTimers(); const key = root(); const sdk = { ready: true }; globals[key] = sdk;
    const dispose = watch(key, vi.fn(), { pollInterval: 10, timeout: 100 }); await flush();
    Object.defineProperty(window, key, { configurable: false });
    expect(dispose).not.toThrow(); expect(globals[key]).toBe(sdk); expect(vi.getTimerCount()).toBe(0);
    const next = watch(key, vi.fn(), { strategy: 'poll', pollInterval: 0 }); next();
  });

  it('deleting an own leaf observes the inherited value it reveals', async () => {
    const key = root(); globals[key] = Object.assign(Object.create({ api: 42 }), { api: 1 }); const callback = vi.fn();
    watch(`${key}.api`, callback, { pollInterval: 0 }); await flush(); callback.mockClear();
    delete globals[key].api; await flush(); expect(callback).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('descendant getter recovery with the same identity delivers again', async () => {
    const key = root(); const child = {}; let broken = false; const callback = vi.fn();
    const sdk = { get api() { if (broken) {throw new Error('getter');} return child; } };
    watch(`${key}.api`, callback, { pollInterval: 0 }); globals[key] = sdk; await flush();
    broken = true; globals[key] = sdk; await flush(); broken = false;
    const joined = watch(`${key}.api`, vi.fn(), { pollInterval: 0 });
    globals[key] = sdk; await flush(); expect(callback).toHaveBeenCalledTimes(2); joined();
  });

  it.each(['assign', 'define'])('nested %s of a handed-out proxy preserves the raw SDK identity', async mode => {
    const key = root(); const child = { api: 1 }; const sdk = { branch: child }; globals[key] = sdk;
    const dispose = watch(`${key}.branch.api`, vi.fn(), { pollInterval: 0 }); await flush();
    const observed = globals[key].branch;
    if (mode === 'assign') {globals[key].branch = observed;} else {Object.defineProperty(globals[key], 'branch', { value: observed });}
    dispose(); expect(globals[key]).toBe(sdk); expect(sdk.branch).toBe(child);
  });

  it('callable intermediate namespaces stay callable and intercept children', async () => {
    const key = root(); globals[key] = { factory: () => 'called' }; const callback = vi.fn();
    watch(`${key}.factory.api`, callback, { pollInterval: 0 });
    expect(globals[key].factory()).toBe('called'); globals[key].factory.api = 42; await flush();
    expect(callback).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('aliases share proxy identity and route writes to both current paths', async () => {
    const key = root(); const child = { api: 1 }; globals[key] = { a: child, b: child }; const a = vi.fn(); const b = vi.fn();
    watch(`${key}.a.api`, a, { pollInterval: 0 }); watch(`${key}.b.api`, b, { pollInterval: 0 }); await flush();
    expect(globals[key].a).toBe(globals[key].b); a.mockClear(); b.mockClear();
    globals[key].a.api = 42; await flush(); expect(a).toHaveBeenCalledExactlyOnceWith(42); expect(b).toHaveBeenCalledExactlyOnceWith(42);
    const old = globals[key].a; globals[key].a = { api: 2 }; await flush(); a.mockClear(); b.mockClear();
    old.api = 7; await flush(); expect(a).not.toHaveBeenCalled(); expect(b).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('non-configurable root does not stop before strict readiness', async () => {
    vi.useFakeTimers(); const key = root(); const value = { loaded: false }; const callback = vi.fn();
    Object.defineProperty(window, key, { value, configurable: false, writable: true });
    watch(key, callback, { ready: v => (v as typeof value)?.loaded === true, pollInterval: 10 });
    await vi.advanceTimersByTimeAsync(20); value.loaded = true;
    await vi.advanceTimersByTimeAsync(10);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('shared predicates remain independent, reverse=%s', async reverse => {
    vi.useFakeTimers(); const key = root(); const item = { level: 0 }; globals[key] = Object.freeze({ item });
    const low = vi.fn(); const high = vi.fn();
    const configs = [{ callback: low, level: 1 }, { callback: high, level: 2 }];
    for (const config of reverse ? [configs[1]!, configs[0]!] : configs) {watch(`${key}.item`, config.callback, {
      ready: v => (v as typeof item)?.level >= config.level, pollInterval: 10,
    });}
    item.level = 1; await vi.advanceTimersByTimeAsync(10);
    item.level = 2; await vi.advanceTimersByTimeAsync(10);
    expect(low).toHaveBeenCalledTimes(1); expect(high).toHaveBeenCalledTimes(1);
  });

  it('pure poll observes readiness transitions until disposal', async () => {
    vi.useFakeTimers(); const key = root(); const value = { loaded: true }; globals[key] = value; const callback = vi.fn();
    const dispose = watch(key, callback, { strategy: 'poll', pollInterval: 10, ready: v => (v as typeof value)?.loaded });
    await flush(); await vi.advanceTimersByTimeAsync(20);
    expect(callback).toHaveBeenCalledTimes(1);
    value.loaded = false; await vi.advanceTimersByTimeAsync(10);
    value.loaded = true; await vi.advanceTimersByTimeAsync(10);
    expect(callback).toHaveBeenCalledTimes(2);
    dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it('fastest live poll interval wins and leaves with its subscriber', async () => {
    vi.useFakeTimers(); const key = root(); const fast = vi.fn(); const slow = vi.fn();
    const stopFast = watch(key, fast, { strategy: 'poll', pollInterval: 10 });
    const stopSlow = watch(key, slow, { strategy: 'poll', pollInterval: 100 });
    stopFast(); globals[key] = 1;
    await vi.advanceTimersByTimeAsync(99); expect(slow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(slow).toHaveBeenCalledWith(1);
    stopSlow(); expect(vi.getTimerCount()).toBe(0);
  });

  it('the middle object actually arrives after root assignment', async () => {
    const key = root(); const callback = vi.fn(); watch(`${key}.a.b`, callback, { pollInterval: 0 });
    globals[key] = {}; await flush(); globals[key].a = { b: 42 }; await flush();
    expect(callback).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('a callable root resolves pre-registered descendants', async () => {
    const key = root(); const callback = vi.fn(); watch(`${key}.item`, callback, { pollInterval: 0 });
    globals[key] = Object.assign(function SDK() {}, { item: 42 }); await flush();
    expect(callback).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('a late sealed closure getter remains covered', async () => {
    vi.useFakeTimers(); const key = root(); let item: unknown; const callback = vi.fn();
    watch(`${key}.item`, callback, { pollInterval: 10 });
    globals[key] = Object.seal({ get item() { return item; } });
    await vi.advanceTimersByTimeAsync(10); item = { ready: true }; await vi.advanceTimersByTimeAsync(10);
    expect(callback).toHaveBeenCalledExactlyOnceWith(item);
  });

  it('child writes reconsider ancestor readiness', async () => {
    const key = root(); const callback = vi.fn(); watch(key, callback, { pollInterval: 0, ready: v => (v as any)?.loaded === true });
    globals[key] = { loaded: false }; await flush(); globals[key].loaded = true; await flush();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it.each(['poll', 'proxy'])('conflicting %s/other registration rolls back', first => {
    const key = root(); const dispose = watch(key, vi.fn(), { strategy: first as 'poll' | 'proxy', pollInterval: 0 });
    expect(() => watch(key, vi.fn(), { strategy: first === 'poll' ? 'proxy' : 'poll', pollInterval: 0 })).toThrow(/strategy/i);
    dispose(); expect(Object.getOwnPropertyDescriptor(window, key)).toBeUndefined();
  });

  it.each(['auto', 'proxy'])('auto/proxy sharing works, first=%s', async first => {
    const key = root(); const a = vi.fn(); const b = vi.fn();
    const da = watch(`${key}.a`, a, { strategy: first as 'auto' | 'proxy', pollInterval: 0 });
    const db = watch(`${key}.b`, b, { strategy: first === 'auto' ? 'proxy' : 'auto', pollInterval: 0 });
    globals[key] = { a: 1, b: 2 }; await flush(); expect(a).toHaveBeenCalledWith(1); expect(b).toHaveBeenCalledWith(2);
    da(); globals[key].b = 3; await flush(); expect(b).toHaveBeenLastCalledWith(3); db();
  });

  it('throwing predicate cannot disrupt successful SDK write or healthy subscriber', async () => {
    const key = root(); const healthy = vi.fn(); const failure = new Error('predicate'); const errors = vi.fn(); listen('ww:error', errors);
    watch(key, vi.fn(), { pollInterval: 0, ready: v => { if (v !== null && v !== undefined) {throw failure;} return false; }, correlationId: 'bad-predicate' });
    watch(key, healthy, { pollInterval: 0 });
    expect(() => { globals[key] = { ready: true }; }).not.toThrow(); await flush();
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.some(([event]) => event.detail.id === 'bad-predicate' && event.detail.error === failure)).toBe(true);
  });

  it('throwing descendant getter cannot disrupt SDK assignment', async () => {
    const key = root(); const healthy = vi.fn();
    watch(`${key}.bad`, vi.fn(), { pollInterval: 0 }); watch(key, healthy, { pollInterval: 0 });
    expect(() => { globals[key] = { get bad() { throw new Error('getter'); } }; }).not.toThrow(); await flush();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('teardown restores the latest raw value, including undefined', async () => {
    const key = root(); const initial = { initial: true }; const next = { ready: true }; globals[key] = initial;
    const dispose = watch(key, vi.fn(), { pollInterval: 0 }); globals[key] = next; dispose();
    expect(globals[key]).toBe(next);
    const dispose2 = watch(key, vi.fn(), { pollInterval: 0 }); globals[key] = undefined; dispose2();
    expect(globals[key]).toBeUndefined(); await flush();
  });

  it('original accessor setter and assigned state are preserved', () => {
    const key = root(); let value: unknown = 'placeholder'; const getter = () => value; const setter = vi.fn((next: unknown) => { value = next; });
    Object.defineProperty(window, key, { get: getter, set: setter, configurable: true, enumerable: false });
    const dispose = watch(key, vi.fn(), { pollInterval: 0 }); const assigned = { ready: true }; globals[key] = assigned; dispose();
    expect(setter).toHaveBeenCalledExactlyOnceWith(assigned); expect(globals[key]).toBe(assigned);
    expect(Object.getOwnPropertyDescriptor(window, key)).toEqual({ get: getter, set: setter, configurable: true, enumerable: false });
  });

  it('deleted trap/new root survives old teardown and joining watcher recovers', async () => {
    const key = root(); const original = watch(key, vi.fn(), { pollInterval: 0 });
    delete globals[key]; const replacement = { sdk: true }; globals[key] = replacement;
    const callback = vi.fn(); const joined = watch(key, callback, { pollInterval: 0 }); await flush();
    original(); globals[key] = { next: true }; await flush(); expect(callback).toHaveBeenCalledTimes(2);
    joined(); expect(globals[key]).toEqual({ next: true });
  });

  it('external descriptor is not overwritten during teardown', () => {
    const key = root(); const dispose = watch(key, vi.fn(), { pollInterval: 0 });
    const external = { external: true }; Object.defineProperty(window, key, { value: external, writable: true, configurable: true });
    dispose(); expect(globals[key]).toBe(external);
  });

  it('throwing once callback cleans up and cannot fire again', async () => {
    const key = root(); const value = { ready: true }; const callback = vi.fn(() => { throw new Error('callback'); });
    watch(key, callback, { once: true, pollInterval: 0 }); globals[key] = value; await flush();
    globals[key] = { ready: true }; await flush(); expect(callback).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyDescriptor(window, key)?.get).toBeUndefined();
  });

  it('ready-event disposal prevents the following callback', async () => {
    const key = root(); const callback = vi.fn(); const dispose = watch(key, callback, { pollInterval: 0 });
    listen('ww:ready', ((event: CustomEvent) => { if (event.detail.path === key) {dispose();} }) as EventListener);
    globals[key] = 42; await flush(); expect(callback).not.toHaveBeenCalled();
  });

  it('repeated equal assignments remain distinct, even in one task', async () => {
    const key = root(); const callback = vi.fn(); watch(key, callback, { pollInterval: 0 });
    globals[key] = 42; globals[key] = 42; await flush(); expect(callback).toHaveBeenCalledTimes(2);
    globals[key] = 42; await flush(); expect(callback).toHaveBeenCalledTimes(3);
  });

  it('readiness invalidated before delivery suppresses callback', async () => {
    const key = root(); const callback = vi.fn(); const value = { loaded: true };
    watch(key, callback, { pollInterval: 0, ready: v => (v as typeof value)?.loaded === true });
    globals[key] = value; value.loaded = false; await flush(); expect(callback).not.toHaveBeenCalled();
  });

  it('intercepted write followed by polls is one observed delivery', async () => {
    vi.useFakeTimers(); const key = root(); const callback = vi.fn(); watch(`${key}.child`, callback, { pollInterval: 10 });
    globals[key] = {}; globals[key].child = { ready: true }; await flush(); await vi.advanceTimersByTimeAsync(100);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('callback still resolves after timeout and retry exhaustion through pure polling', async () => {
    vi.useFakeTimers(); const key = root(); const callback = vi.fn();
    const dispose = watch(key, callback, { strategy: 'poll', pollInterval: 10, timeout: 20, retries: 2 });
    await vi.advanceTimersByTimeAsync(60); globals[key] = 42; await vi.advanceTimersByTimeAsync(10);
    expect(callback).toHaveBeenCalledExactlyOnceWith(42); dispose(); expect(vi.getTimerCount()).toBe(0);
  });

  it('fractional promise timeout cleans up every resource', async () => {
    vi.useFakeTimers(); const key = root(); const result = waitForWindot(key, { timeout: 1.5, pollInterval: 0 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(5); expect((await result).name).toBe('TimeoutError');
    expect(Object.getOwnPropertyDescriptor(window, key)).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, false, 0, '', { reason: true }])('abort reason preserved exactly: %j', async reason => {
    const key = root(); const controller = new AbortController();
    const result = waitForWindot(key, { signal: controller.signal, pollInterval: 0 }).catch(error => error);
    controller.abort(reason); expect(await result).toBe(reason); expect(Object.getOwnPropertyDescriptor(window, key)).toBeUndefined();
  });

  it.each([false, true])('locked child is invariant-safe, locked after watch=%s', async late => {
    const key = root(); const child = { ready: true }; const sdk = { branch: child };
    if (!late) {Object.defineProperty(sdk, 'branch', { value: child, writable: false, configurable: false });}
    globals[key] = sdk; const callback = vi.fn(); const dispose = watch(`${key}.branch.ready`, callback, { pollInterval: 0 });
    if (late) {Object.defineProperty(sdk, 'branch', { value: child, writable: false, configurable: false });}
    expect(() => globals[key].branch).not.toThrow(); expect(globals[key].branch).toBe(child);
    await flush(); expect(callback).toHaveBeenCalledWith(true); dispose();
  });
});
