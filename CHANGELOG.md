# windotwatchr

## 0.2.0

### Minor Changes

- [`a1b18d6`](https://github.com/juanpprieto/windotwatchr/commit/a1b18d63a0a836f148949f2c2997665fa2af5f10) Thanks [@juanpprieto](https://github.com/juanpprieto)! - Rename React hook and types for consistency with core API naming pattern:

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

## 0.1.1

### Patch Changes

- [`5eeb6e0`](https://github.com/juanpprieto/windotwatchr/commit/5eeb6e085ec6bcdb09f1f3ec9422f791daa1b2ab) Thanks [@juanpprieto](https://github.com/juanpprieto)! - Add publishConfig with provenance attestations and release process documentation
