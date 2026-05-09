---
"podkit": patch
"@podkit/ipod-firmware": patch
---

Externalize `koffi` and `usb` from the published `bun build` bundles. Koffi loads its native binding via `eval('require')(filename)`; bun's bundler shims top-level `require` as `__require` (via `createRequire(import.meta.url)`) but does not inject `require` into eval'd literals, so the bundled CLI hit `ReferenceError: require is not defined` whenever the SCSI inquiry path was actually reached. The native loaders are now resolved at runtime via `node_modules`, which is also more correct for `usb` (whose `bun build`-time prebuild only matched the build host's platform).

The standalone-binary path (`bun --compile` via `compile.sh`) is unchanged — it stages platform-specific `.node` files and uses static `require()` in `compile-entry.js`, which works correctly. A bug in `compile.sh`'s linux-arm64 branch is also fixed: the script previously constructed `linux-arm64/node.napi.${USB_VARIANT}.node` (where `USB_VARIANT` is `glibc` or `musl`) but the `usb` package only ships `linux-arm64/node.napi.armv8.node` — no glibc/musl split exists for arm64. The script now selects the armv8 prebuild unconditionally on arm64.

`@podkit/ipod-firmware` is also externalized from the `@podkit/core` and `@podkit/devices-ipod` builds, so neither package's `dist/index.js` re-inlines firmware (and therefore koffi/usb imports). Bundle content-check tests under `packages/*/src/bundle.test.ts` assert that no `eval("require")` slips into any published bundle.
