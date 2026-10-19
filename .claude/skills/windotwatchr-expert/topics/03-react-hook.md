# React hook

```tsx
import { useWatchWindot } from 'windotwatchr/react';

function SDKStatus() {
  const { value, status, error } = useWatchWindot('SDK.api', {
    timeout: 10_000,
    ready: candidate => typeof candidate === 'function',
  });
  return <p>{error?.message ?? (value ? 'API ready' : status)}</p>;
}
```

The hook gets lifecycle updates privately from its own registration. It does not listen to global ww events. Duplicate public correlation labels do not cause sibling status changes.

A current ready callback sets value/status and clears an earlier error. Older queued occurrences cannot overwrite newer observed state. An observed readiness loss clears value and returns to watching. A detection error clears value and sets error status; successful recovery can deliver again. A timeout sets timeout status while mounted detection remains available for late readiness. Abort clears value/error and sets idle. Unobserved raw changes can still leave stale UI until a poll or intercepted check.

Path changes and changes to timeout, pollInterval, strategy, signal, retries, once or correlationId replace the registration and reset state. An unchanged options object's values do not restart it. The ready predicate is published through a ref after React commits and rechecked in place when changed; inline predicates do not trigger a resubscription loop.

Cleanup marks the effect inactive before disposal, preventing queued state updates after unmount. Setup failures become hook errors and release acquired resources. StrictMode mounts/unmounts are covered by the core lifetime model. SSR does not register detection and remains watching until a browser effect runs.
