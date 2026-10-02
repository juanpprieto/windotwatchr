/** Compare public behavior without adapting the scenario to either version. */
const { watchWindot, waitForWindot } = await import(new URLSearchParams(location.search).get('entry'));
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = {};

let calls = 0;
const same = watchWindot('SameSDK', () => calls++, { pollInterval: 0 });
window.SameSDK = 'A'; await flush(); window.SameSDK = 'A'; await flush();
results.equalAssignments = calls; same();

let events = 0;
window.addEventListener('ww:ready', event => { if (event.detail.path === 'EventsSDK') {events++;} });
const eventA = watchWindot('EventsSDK', () => {}, { pollInterval: 0 });
const eventB = watchWindot('EventsSDK', () => {}, { pollInterval: 0 });
window.EventsSDK = {}; await flush(); results.readyEventsForTwoSubscriptions = events;
eventA(); eventB();

const predicate = watchWindot('PredicateSDK', () => {}, { pollInterval: 0, ready: value => { if (value !== undefined) {throw new Error('predicate');} return false; } });
try { window.PredicateSDK = {}; results.predicateEscapesSDKWrite = false; }
catch { results.predicateEscapesSDKWrite = true; }
predicate(); await flush();

const raw = {}; window.IdentitySDK = raw;
const identity = watchWindot('IdentitySDK', () => {}, { pollInterval: 0 }); await flush(); identity();
results.restoresRawRoot = window.IdentitySDK === raw;

calls = 0;
const value = { loaded: false };
Object.defineProperty(window, 'LockedSDK', { value, configurable: false, writable: true });
const locked = watchWindot('LockedSDK', () => calls++, { pollInterval: 5, ready: candidate => candidate?.loaded === true });
await pause(15); value.loaded = true; await pause(20); results.nonconfigurableStrictReady = calls; locked();

calls = 0;
const callable = watchWindot('CallableSDK.api', () => calls++, { pollInterval: 0 });
window.CallableSDK = Object.assign(function SDK() {}, { api: 42 }); await flush();
results.callableRootDeliveries = calls; callable();

try { await waitForWindot('FractionSDK', { timeout: 1.5, pollInterval: 0 }); }
catch (error) { results.fractionalTimeoutName = error.name; }
results.fractionalTimeoutLeavesTrap = !!Object.getOwnPropertyDescriptor(window, 'FractionSDK')?.get;
const controller = new AbortController(); controller.abort(null);
try { await waitForWindot('AbortSDK', { signal: controller.signal, pollInterval: 0 }); }
catch (reason) { results.abortNullPreserved = reason === null; }

document.body.dataset.results = JSON.stringify(results);
