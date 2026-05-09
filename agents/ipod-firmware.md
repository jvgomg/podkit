# `@podkit/ipod-firmware`

iPod firmware inquiry — SCSI (SG_IO/IOKit via koffi) and USB (control transfer via the `usb` npm package).

Read this when working on:

- The inquiry orchestrator, transport selection, or probe.
- The diagnostic logger surface.
- Bundling `@podkit/ipod-firmware` (or anything that depends on it transitively) into a single-file binary.

## Diagnostic logging

The library does not write to stderr/stdout. It exposes `setLogger(fn | null)` and emits structured `FirmwareLogEvent`s through it. Default is no-op.

```ts
import { setLogger } from '@podkit/ipod-firmware';

setLogger((event) => {
  process.stderr.write(`[${event.level}] ${event.message}\n`);
});
```

The CLI installs a logger in its `preAction` hook when `-v` is passed; library code stays platform/UI-agnostic. If you build another consumer (Tauri app, daemon, etc.) and want diagnostic output, install your own receiver.

## Bundling into a single-file binary

`@podkit/ipod-firmware` depends on the `usb` npm package, which uses `node-gyp-build` to load a per-platform prebuilt `.node` from `node_modules/usb/prebuilds/` at runtime. Bundlers like Bun `--compile` can't reach that path inside a compiled binary, so consumers must do two things:

### 1. Build-time: stage the prebuild

Detect the build host's platform/arch and copy the matching file out of `node_modules/usb/prebuilds/` into your bundle's working directory:

| Platform / arch | Prebuild path inside `usb` package |
|------------------|-------------------------------------|
| darwin (any arch) | `prebuilds/darwin-x64+arm64/node.napi.node` |
| linux x64 (glibc) | `prebuilds/linux-x64/node.napi.glibc.node` |
| linux x64 (musl)  | `prebuilds/linux-x64/node.napi.musl.node` |
| linux arm64 (any libc) | `prebuilds/linux-arm64/node.napi.armv8.node` |

Only `linux-x64` ships separate glibc/musl prebuilds. `linux-arm64` ships a single ABI-tagged file (`node.napi.armv8.node`) that works on both glibc and musl — so don't try to detect libc on arm64. See `packages/podkit-cli/scripts/compile.sh` for a working example. musl detection on Linux x64 uses `ldd /bin/sh | grep -q musl`.

### 2. Runtime: hand the prebuild to `bundleUsbNative`

In your single-file binary's CJS entry shim, statically `require()` both the staged native and the bundle helper, then wire them up:

```js
// Bun --compile detects static require() of .node files and embeds them.
try {
  const { bundleUsbNative } = require('@podkit/ipod-firmware/bundle');
  bundleUsbNative(require('./your-staged-usb.node'));
} catch (err) {
  // Surface for diagnostics; safe to continue — commands that don't touch
  // USB inquiry will still work.
  globalThis.__usb_bundle_error = err;
}
```

The helper installs a scoped `Module._resolveFilename` hook that intercepts `require('node-gyp-build')` **only** when the requesting module lives inside `usb/dist/` — other packages with their own `node-gyp-build` dep keep normal resolution.

### Why this lives in `@podkit/ipod-firmware`

The native dep is owned by this package, so the bundling story is owned here too. Any consumer (CLI, daemon, Tauri app, future GUI) follows the same recipe — staging script + `bundleUsbNative` call — without re-deriving the `node-gyp-build` interception. If the `usb` package's loader changes, the fix lands in `bundle.cjs` and all consumers pick it up via a version bump.
