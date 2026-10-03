# SSR safety

## Environment detection

The core entry evaluates this guarded check at module load:

```ts
const isBrowser = typeof window !== 'undefined';
```

When `window` is absent, imports do not access it. Node and Bun server imports
have dedicated checks. Other runtimes with no `window` follow the same guard;
this is not evidence that detection works in Workers or worklets. A runtime
that supplies `window` still needs the browser APIs used by the selected route.

## Behavior without window

| API | Server behavior |
|---|---|
| `watchWindot` | Returns a no-op callable disposer; never invokes the callback |
| `waitForWindot` | Rejects with `Error('windotwatchr: window is not available')` |
| `useWatchWindot` | Renders `{ value: null, status: 'watching', error: null }`; its effect does not run |
| Internal event dispatch | Does nothing when `window` is absent |

Handle rejected server waits if you call them. The rejection prevents an
indefinite wait; it does not initialize an SDK on the server.

## Next.js components

In the App Router, put hooks in a Client Component and render it from the page.
Client Components can still render to HTML on the server or during a static
build; `'use client'` does not make render-time access to `window` safe.

```tsx
'use client';

import { useWatchWindot } from 'windotwatchr/react';

export function SDKStatus() {
  const { status, error } = useWatchWindot<() => void>('acmeSDK.initialize', {
    ready: candidate => typeof candidate === 'function',
    timeout: 5_000,
  });

  return <p>{error?.message ?? status}</p>;
}
```

Pages Router components can use the same hook without the `'use client'`
directive. Server rendering produces the initial watching state; detection
starts in the browser effect after hydration.

The repository's Next.js example uses `output: 'export'`: its production pages
are rendered at build time and hydrated in the browser. This checks prerendering
and hydration, rather than per-request SSR. See
[Next.js static exports](https://nextjs.org/docs/app/guides/static-exports).

## A cancellable wait in an effect

This example uses the fictional Maps SDK from the repository demos. It waits for
the constructor, since `acme.maps` can exist before `acme.maps.Map`. The signal
ends a pending wait on unmount, and cleanup destroys a map that was created.

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { waitForWindot } from 'windotwatchr';

interface MapInstance {
  render(): MapInstance;
  destroy(): void;
}

type MapConstructor = new (
  element: HTMLElement,
  options: { center: { lat: number; lng: number }; zoom: number },
) => MapInstance;

export function MapComponent() {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let map: MapInstance | undefined;

    void waitForWindot<MapConstructor>('acme.maps.Map', {
      timeout: 5_000,
      signal: controller.signal,
      ready: candidate => typeof candidate === 'function',
    }).then(Map => {
      if (controller.signal.aborted || !elementRef.current) return;
      map = new Map(elementRef.current, {
        center: { lat: 40, lng: -74 },
        zoom: 12,
      });
      map.render();
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) console.error(reason);
    });

    return () => {
      controller.abort();
      map?.destroy();
    };
  }, []);

  return <div ref={elementRef} style={{ height: 400 }} />;
}
```

The type parameter describes the mock constructor; it does not prove that any
function is constructible. A real SDK integration needs its documented type
and initialization contract.

## Hydration

The hook begins in `watching` on both server and client, including when the SDK
already exists. Detection updates occur after the browser effect runs. Render
the same initial UI in both environments.

A render branch based solely on browser availability can produce different
initial markup:

```tsx
export function BrowserOnlyStatus() {
  return typeof window === 'undefined'
    ? <p>Server</p>
    : <p>Browser</p>;
}
```

This example mismatches server and initial client rendering. Adding a
`typeof window` guard does not itself cause a mismatch: the problem is different
markup. A guard combined with `status === 'ready'` is initially false in both
environments because the hook starts in `watching`.

## Validation

`src/index.ssr.test.ts` checks no-window imports, no-op watches, rejected waits
and internal event dispatch in Vitest's Bun server project. Packed consumer
checks also import core and React under the recorded Node minimum/current
runtimes. Browser hydration and server-runtime coverage are separate checks.
