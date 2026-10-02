/* eslint-disable no-await-in-loop -- React act scopes and disposal orders must run sequentially. */
import React from 'react';
import { createRoot, act } from './react-renderer.ts';
import { watchWindot } from 'windotwatchr';
import { useWatchWindot } from 'windotwatchr/react';
import { checkScopes } from './compiled/using.mjs';
import { useSDKInScope } from './compiled/readme-using.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sdk = window as unknown as Record<string, unknown>;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
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
    await act(async () => { if (disposeCoreFirst) {root.unmount();} else {dispose!();} });
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
