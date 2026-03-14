# Contributing — Core & React

## Project Structure

```
src/
├── types.ts                          # Shared type exports + defaults
├── index.ts                          # watchWindot, waitForWindot (public API)
├── index.test.ts                     # Public API tests
├── index.ssr.test.ts                 # SSR behavior tests
├── core/
│   ├── windot-watcher.ts             # watch() orchestration + singleton registry
│   ├── property-trap.ts              # Object.defineProperty on window[rootKey]
│   ├── proxy-wrapper.ts              # ES6 Proxy handler + WeakMap cache
│   ├── subscription-manager.ts       # Path → callback Set management
│   ├── notification-queue.ts         # Microtask scheduling + error isolation
│   ├── event-dispatcher.ts           # SSR-safe CustomEvent dispatch
│   └── poll-fallback.ts              # resolvePath + setTimeout chain
└── react/
    ├── index.ts                      # Barrel export
    ├── use-windotwatchr.ts           # React hook implementation
    └── use-windotwatchr.test.ts      # Hook tests
```

Every `.ts` file has a co-located `.test.ts` file.

## Code Standards

### TSDoc Required on Everything

All functions, interfaces, types, and props MUST have TSDoc comments with `@param`, `@returns`, and `@example` blocks. This is non-negotiable.

```ts
/**
 * Brief description of what this does.
 *
 * Extended explanation if needed.
 *
 * @param name - What this parameter is.
 * @returns What the function returns.
 *
 * @example
 * ```ts
 * const result = myFunction('input');
 * ```
 */
```

### No "Phase N" Comments

Use `TODO:` for deferred work. Phase references belong in `docs/` plans only, never in shipped source code.

### Reflect.set Pattern

When modifying Proxy traps, ALWAYS pass `target` (not `receiver`) as the 4th argument to `Reflect.set`:

```ts
// CORRECT:
Reflect.set(target, prop, value, target);

// WRONG — causes double notification:
Reflect.set(target, prop, value, receiver);
```

### Conditional Exports Order

In `package.json`, `types` must come FIRST in each conditional export block:

```json
{
  "import": {
    "types": "./dist/index.d.ts",     // FIRST
    "default": "./dist/index.js"       // SECOND
  }
}
```

## Build & Test

```bash
pnpm install            # Install deps + husky hooks
pnpm check              # typecheck + lint + test (run before pushing)
pnpm build              # tsup → dist/ (ESM + CJS + .d.ts)
pnpm test               # vitest run
pnpm test:watch         # vitest (watch mode)
pnpm typecheck          # tsc --noEmit
pnpm lint               # oxlint src/
```

### Build Output

tsup produces:
- `dist/index.js` + `dist/index.d.ts` (ESM)
- `dist/index.cjs` + `dist/index.d.cts` (CJS)
- `dist/react.js` + `dist/react.d.ts` (ESM)
- `dist/react.cjs` + `dist/react.d.cts` (CJS)

## Test Patterns

### Test Setup & Teardown

```ts
import { resetRegistry } from './core/windot-watcher.js';

afterEach(() => {
  resetRegistry(); // Tear down all RootWatchers
  try {
    delete (window as Record<string, unknown>)[testKey];
  } catch {
    // Handle non-configurable properties
  }
});
```

`resetRegistry()` is internal-only (not exported from public API). It tears down all active RootWatchers and clears the singleton registry.

### Fake Timers

```ts
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// In tests:
vi.advanceTimersByTime(100); // Advance polling/timeout
```

### Microtask Flushing

Notifications are delivered via microtask. To assert on callback results:

```ts
// Trigger assignment
(window as any).testKey = { value: 42 };

// Flush microtask queue
await vi.waitFor(() => {
  expect(callback).toHaveBeenCalled();
});
```

Or use `queueMicrotask` / `Promise.resolve().then()` + `vi.runAllTicks()`.

### React Hook Testing

```ts
import { renderHook, act } from '@testing-library/react';
import { useWindotWatchr } from './use-windotwatchr.js';

it('transitions to ready when value appears', async () => {
  const { result } = renderHook(() => useWindotWatchr('testSDK'));

  expect(result.current.status).toBe('watching');
  expect(result.current.value).toBeNull();

  act(() => {
    (window as any).testSDK = { loaded: true };
  });

  await vi.waitFor(() => {
    expect(result.current.status).toBe('ready');
    expect(result.current.value).toEqual({ loaded: true });
  });
});
```

### SSR Testing

```ts
// src/index.ssr.test.ts
// Tests run with window mocked as undefined
describe('SSR (no window)', () => {
  it('watchWindot returns no-op dispose', () => {
    const dispose = watchWindot('test', vi.fn());
    expect(dispose).toBeTypeOf('function');
    dispose(); // Must not throw
  });
});
```

## Contributing to Core Engine

### Adding a New Detection Strategy

1. Create `src/core/new-strategy.ts` with co-located test
2. Implement the strategy with a dispose function return
3. Wire it into `installTrap()` or `watch()` based on `options.strategy`
4. Dispatch appropriate `ww:*` events
5. Ensure SSR safety (guard `window` access)
6. Update types if adding new strategy options

### Modifying Proxy Traps

1. **Always test for double notification** — the `Reflect.set(target)` pattern is critical
2. **Test with frozen/sealed objects** — Proxy wrapping must return `null`
3. **Test with Symbol keys** — must be ignored (no notification)
4. **Test WeakMap cache** — same object should return same proxy
5. **Test circular references** — `obj.self = obj` must not infinite loop

### Modifying Subscription Manager

1. **Test ref-counting** — `deepPrefixes` must increment/decrement correctly
2. **Test cleanup** — disposing last subscriber for a path must clean up the Set
3. **Test `getSubscriberCount()`** — used for singleton teardown decisions

## Contributing to React Binding

### Adding New Hook Features

1. Keep the hook thin — delegate to core engine, don't duplicate logic
2. Status transitions must come from `ww:*` events, not from callbacks directly
3. Always filter events by `detail.path === path`
4. Cleanup all event listeners in the effect return
5. Use `optionsRef` pattern — don't put options in the dependency array
6. Test with `renderHook` from `@testing-library/react`

### StrictMode Considerations

React StrictMode double-mounts components. The core engine handles this via ref-counting in the singleton registry. If adding new features:

1. Test with StrictMode enabled
2. Ensure no duplicate watchers after double mount/unmount
3. Ensure cleanup runs correctly on the intermediate unmount

## Changesets

If your change is user-facing, add a changeset:

```bash
pnpm changeset
```

This creates a markdown file in `.changeset/` describing the change. Commit it with your PR.

## Precommit Hooks

Husky runs `lint-staged` on commit:
- `*.{ts,tsx}` files → `oxlint`

Full quality gate (`typecheck + lint + test`) runs in CI.
