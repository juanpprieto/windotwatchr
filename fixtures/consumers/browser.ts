/* eslint-disable no-await-in-loop -- React act scopes and disposal orders must run sequentially. */
import React from 'react';
import { createRoot, act } from './react-renderer.ts';
import { watchWindot, waitForWindot } from 'windotwatchr';
import { useWatchWindot } from 'windotwatchr/react';
import { checkScopes } from './compiled/using.mjs';
import { useSDKInScope } from './compiled/readme-using.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sdk = window as unknown as Record<string, unknown>;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const promised = waitForWindot<number>('PromiseSDK.api', { timeout: 1000 });
const promisedRaw = { api: 42 };
sdk.PromiseSDK = promisedRaw;
assert(await promised === 42 && sdk.PromiseSDK === promisedRaw
  && !Object.getOwnPropertyDescriptor(window, 'PromiseSDK')?.get, 'packed promise readiness releases its root');
let timeoutReason: unknown;
try { await waitForWindot('TimedOutSDK.api', { timeout: 20, pollInterval: 10 }); }
catch (reason) { timeoutReason = reason; }
assert(timeoutReason instanceof Error && timeoutReason.name === 'TimeoutError'
  && !Object.getOwnPropertyDescriptor(window, 'TimedOutSDK'), 'packed promise final timeout cleans up');
const controller = new AbortController();
const aborted = waitForWindot('AbortedSDK.api', { signal: controller.signal });
controller.abort(null);
let abortReason: unknown = 'not rejected';
try { await aborted; } catch (reason) { abortReason = reason; }
assert(abortReason === null && !Object.getOwnPropertyDescriptor(window, 'AbortedSDK'), 'packed promise preserves null abort reason and cleans up');
const events: { type: string; path: string; id?: string; value?: unknown; error?: unknown }[] = [];
const collect = (event: Event) => events.push({ type: event.type, ...(event as CustomEvent).detail });
window.addEventListener('ww:ready', collect);
window.addEventListener('ww:error', collect);
try {
  let wholeCalls = 0;
  let middleCalls = 0;
  using _whole = watchWindot('LateWhole.branch.api', () => wholeCalls++, { pollInterval: 0 });
  using _middle = watchWindot('LateMiddle.branch.api', () => middleCalls++, { pollInterval: 0 });
  sdk.LateWhole = { branch: { api: 1 } };
  sdk.LateMiddle = {};
  (sdk.LateMiddle as Record<string, unknown>).branch = { api: 2 };
  await flush();
  assert(wholeCalls === 1 && middleCalls === 1, 'late whole roots and middle branches deliver descendants');

  const failure = new Error('intentional predicate failure');
  let healthyCalls = 0;
  let throwingCalls = 0;
  using _bad = watchWindot('IsolatedSDK', () => {}, {
    ready: value => { if (value !== null && value !== undefined) {throw failure;} return false; },
    pollInterval: 0, correlationId: 'predicate-failure',
  });
  using _good = watchWindot('IsolatedSDK', () => healthyCalls++, { pollInterval: 0, correlationId: 'healthy' });
  const raw = {};
  sdk.IsolatedSDK = raw;
  await flush();
  assert(healthyCalls === 1, 'a throwing predicate does not break the SDK write or sibling');
  assert(events.filter(event => event.id === 'predicate-failure' && event.error === failure).length === 1, 'predicate failure is correlated once');

  using _once = watchWindot('ThrowingOnceSDK', () => { throwingCalls++; throw failure; }, {
    once: true, pollInterval: 0, correlationId: 'throwing-once',
  });
  sdk.ThrowingOnceSDK = raw;
  await flush();
  assert(!Object.getOwnPropertyDescriptor(window, 'ThrowingOnceSDK')?.get && sdk.ThrowingOnceSDK === raw, 'throwing once restores raw descriptor');
  sdk.ThrowingOnceSDK = {};
  await flush();
  assert(throwingCalls === 1 && events.filter(event => event.id === 'throwing-once' && event.type === 'ww:error').length === 1, 'throwing once fires and reports only once');

  let countedCalls = 0;
  using _first = watchWindot('CountedSDK', () => countedCalls++, { pollInterval: 0, correlationId: 'first' });
  using _second = watchWindot('CountedSDK', () => countedCalls++, { pollInterval: 0, correlationId: 'second' });
  sdk.CountedSDK = raw;
  await flush();
  const readyEvents = events.filter(event => event.path === 'CountedSDK');
  assert(countedCalls === 2 && readyEvents.length === 2, 'one ready event per subscriber');
  assert(readyEvents.every(event => event.type === 'ww:ready' && event.value !== undefined)
    && readyEvents.some(event => event.id === 'first') && readyEvents.some(event => event.id === 'second'), 'ready detail carries path, value and subscriber label');

  sdk.RawPollSDK = raw;
  const descriptor = Object.getOwnPropertyDescriptor(window, 'RawPollSDK');
  let pollCalls = 0;
  const polling = watchWindot('RawPollSDK', value => { assert(value === raw, 'poll callback preserves identity'); pollCalls++; }, { strategy: 'poll', pollInterval: 10 });
  await flush();
  assert(sdk.RawPollSDK === raw && Object.getOwnPropertyDescriptor(window, 'RawPollSDK')?.get === descriptor?.get, 'pure poll leaves raw descriptor and identity intact');
  polling();
  assert(pollCalls === 1, 'initial poll readiness delivers once');
} finally {
  window.removeEventListener('ww:ready', collect);
  window.removeEventListener('ww:error', collect);
}

await checkScopes();
const ready = useSDKInScope();
const raw = {};
sdk.SDK = raw;
await ready;
assert(sdk.SDK === raw && !Object.getOwnPropertyDescriptor(window, 'SDK')?.get, 'README scope cleanup');

for (const coreFirst of [true, false]) {
  for (const disposeCoreFirst of [true, false]) {
    const path = `Consumer_${coreFirst}_${disposeCoreFirst}`;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let state: ReturnType<typeof useWatchWindot>;
    let calls = 0;
    let dispose: () => void;
    function Component() { state = useWatchWindot(path, { pollInterval: 0 }); return null; }
    const core = () => { dispose = watchWindot(path, () => calls++, { pollInterval: 0 }); };
    await act(async () => {
      if (coreFirst) {core();}
      root.render(React.createElement(Component));
    });
    if (!coreFirst) {core();}
    await act(async () => { sdk[path] = 1; await Promise.resolve(); });
    assert(calls === 1 && state!.value === 1, 'core and hook share readiness');
    await act(async () => { if (disposeCoreFirst) {dispose!();} else {root.unmount();} });
    await act(async () => { sdk[path] = 2; await Promise.resolve(); });
    assert(disposeCoreFirst ? calls === 1 && state!.value === 2 : calls === 2, 'surviving entry remains active');
    const callsBeforeCleanup = calls;
    const stateBeforeCleanup = state!;
    await act(async () => {
      sdk[path] = 3;
      if (disposeCoreFirst) {root.unmount();} else {dispose!();}
      await Promise.resolve();
    });
    assert(calls === callsBeforeCleanup && state === stateBeforeCleanup, 'assignment immediately before final cleanup cannot deliver queued updates');
    assert(sdk[path] === 3, 'final cleanup preserves the last assigned raw value');
    assert(!Object.getOwnPropertyDescriptor(window, path)?.get, 'last disposal restores descriptor');
    container.remove();
    delete sdk[path];
  }
}

const container = document.createElement('div');
document.body.append(container);
const root = createRoot(container);
let conflict: ReturnType<typeof useWatchWindot>;
const stop = watchWindot('ConflictSDK', () => {}, { strategy: 'poll', pollInterval: 0 });
function Conflict() { conflict = useWatchWindot('ConflictSDK', { strategy: 'proxy', pollInterval: 0 }); return null; }
await act(async () => { root.render(React.createElement(Conflict)); });
assert(conflict!.status === 'error' && /strategy conflict/.test(conflict!.error!.message), 'conflicting registration reports error');
await act(async () => { root.unmount(); });
stop();
container.remove();
document.body.dataset.result = 'passed';
