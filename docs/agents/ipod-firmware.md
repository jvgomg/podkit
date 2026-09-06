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

### 2. Build-time: wire the plugin

`@podkit/ipod-firmware` exports a Bun bundler plugin via its `./bundler-plugin` subpath. The plugin intercepts the `node-gyp-build` specifier **only** for importers inside the `usb` package and resolves it to a generated shim (`module.exports = () => require("<staged path>");`). Bun detects the static `.node` require in that shim and embeds the binary — no runtime require hook needed.

```ts
import { usbNativeBundlerPlugin } from '@podkit/ipod-firmware/bundler-plugin';
import path from 'node:path';

await Bun.build({
  entrypoints: ['./src/compile-entry.js'],
  target: 'bun',
  compile: { outfile: './bin/my-binary' },
  plugins: [
    usbNativeBundlerPlugin(path.resolve('./staged/usb.node')),
  ],
});
```

Pass the **absolute** path to the staged prebuild (from step 1). See `packages/podkit-cli/scripts/compile-build.ts` for the full working example.

**Why it must be build-time.** Bun links `require()` calls between bundled modules statically at bundle time, before the compiled binary ever runs. A runtime `Module._resolveFilename` hook — even one installed in the CJS entry shim — is never consulted when Bun resolves those inter-module requires. A runtime approach appears to work on machines that still have the build tree on disk (dev machines, test VMs where `node_modules/usb/prebuilds/` happens to exist at the baked-in path), which is exactly how it evades local testing. On a clean machine or inside a CI artifact it fails immediately.

Because `bun build --compile` (the CLI form) does not accept a `--plugin` flag, the compile pipeline runs through a JS build script (`packages/podkit-cli/scripts/compile-build.ts`) invoked by `scripts/compile.sh` after staging.

### Why this lives in `@podkit/ipod-firmware`

The native dep is owned by this package, so the bundling story is owned here too. Any consumer (CLI, daemon, Tauri app, future GUI) follows the same recipe — staging script + `usbNativeBundlerPlugin` call — without re-deriving the `node-gyp-build` interception. If the `usb` package's loader changes, the fix lands in the plugin and all consumers pick it up via a version bump.

### Runtime system dependencies

- **macOS:** the darwin prebuild is self-contained — no additional system libraries required.
- **Linux (glibc):** the prebuilt `.node` statically links libusb but dynamically links `libudev.so.1`, `libstdc++`, and `libgcc`. `libudev` is present on all standard glibc distributions; no extra install needed.
- **Linux (musl / Alpine):** same native binary, but `libudev` is not part of Alpine's base image. Install `eudev-libs` (`apk add eudev-libs`). The podkit Docker image (Alpine-based) does this automatically.
