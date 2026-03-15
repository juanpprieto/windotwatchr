---
"windotwatchr": minor
---

Rename React hook and types for consistency with core API naming pattern:

- `useWindotWatchr` → `useWatchWindot`
- `WindotWatchrOptions` → `WatchWindotOptions`
- `WindotWatchrResult` → `WatchWindotResult`

**BREAKING:** All three symbols have been renamed. Update your imports:

```diff
-import { useWindotWatchr } from 'windotwatchr/react';
-import type { WindotWatchrOptions, WindotWatchrResult } from 'windotwatchr/react';
+import { useWatchWindot } from 'windotwatchr/react';
+import type { WatchWindotOptions, WatchWindotResult } from 'windotwatchr/react';
```
