# @podkit/ipod-firmware

## 0.1.0

### Minor Changes

- [`d1147e4`](https://github.com/jvgomg/podkit/commit/d1147e4a65ac103608da3730f530f6deab3cd0b6) Thanks [@jvgomg](https://github.com/jvgomg)! - P4 — device-capability architecture complete. All in-tree migration finished; deprecated shims removed.

  **Breaking changes in `@podkit/core`:** The following symbols have been removed from the public API: `createIpodCapabilities`, `LibgpodDeviceInfo`, `DEVICE_PRESETS`, `DevicePreset`, `getDevicePreset`, and `resolveDeviceCapabilities`. Callers must migrate before upgrading.

  Migration guide:
  - `createIpodCapabilities(libgpodInfo)` → `resolveCapabilities(identity)` (preferred, identity-driven) or `resolveIpodModelCapabilities(modelFromLibgpodInfo(libgpodInfo))` for callers that genuinely hold libgpod data.
  - `getDevicePreset(deviceType)` → `BUILT_IN_PRESETS[deviceType]` from `@podkit/devices-mass-storage`.
  - `DEVICE_PRESETS` → `BUILT_IN_PRESETS` from `@podkit/devices-mass-storage`.
  - `resolveDeviceCapabilities(type, overrides)` → `resolveCapabilities(identity, { overrides })` from `@podkit/core`.
  - The `core/device/sysinfo-extended` shim path is gone; import `readSysInfoExtended`, `writeSysInfoExtended`, and `ensureSysInfoExtended` from `@podkit/ipod-firmware` directly.

  See ADR-295.07 for the full architectural rationale.

  **New in `@podkit/ipod-firmware`:** SysInfoExtended file I/O is now owned by this package: `readSysInfoExtended`, `writeSysInfoExtended`, `ensureSysInfoExtended`, `SYSINFO_EXTENDED_PATH`, `SYSINFO_DEVICE_DIR`. Diagnostic helpers `compareSysInfoConsistency` and `normaliseFireWireGuid` are also exported. `ParsedFirmware` gains the optional `modelNumber` field (populated from the `ModelNumStr` plist key when present).

  **New in `@podkit/device-types`:** `IpodModel`, `IpodChecksumType`, `IpodGenerationId`, `IpodGenerationIdLike`, `IpodModelSource`, and `IPOD_GENERATION_IDS` are now exported from this package (canonical home). `UsbConnectionInfo` has been removed — use `UsbFingerprint` instead. `IpodIdentity.notSupportedReason` is added for devices identified as iPods that podkit cannot fully support (e.g. iOS-mode devices). `DeviceCapabilities.artworkMaxResolution` is now `number | null` (null when the generation has no known limit or artwork is unsupported).

  **In `@podkit/devices-ipod`:** `IpodGeneration.supported` and `IpodGeneration.artworkMaxResolution: number | null` are new fields on every generation entry. `lookupByFamilyId` and `FAMILY_ID_TO_GENERATION` are now exported. `unsupported.ts` is populated with comprehensive Apple iOS device PIDs to allow early rejection of phones and tablets at the USB identification stage.

  No user-facing CLI behaviour changes. `podkit device scan`, `podkit device info`, and all sync paths behave identically to P3.

- [`bddea04`](https://github.com/jvgomg/podkit/commit/bddea044342ca9027fc95593a35795fd8de1faf4) Thanks [@jvgomg](https://github.com/jvgomg)! - Add SCSI firmware inquiry for iPod identification (P1 — m-18 device-capability architecture).

  `@podkit/device-types` (first published release) provides the canonical shared type definitions — `DeviceCapabilities`, `DeviceIdentity`, `ParsedFirmware`, and `DeviceProvider` — used across the podkit monorepo without circular dependencies.

  `@podkit/ipod-firmware` (first published release) implements iPod firmware inquiry via SCSI (Linux SG_IO + macOS IOKit, using koffi FFI) with USB fallback through the existing libgpod-node binding. Devices that previously failed identification over USB — including iPod mini 2G, nano 2G, and some iPod 5G Video configurations — can now be identified via SCSI. The orchestrator probes available transports at startup, prefers USB when both are available, and falls back to SCSI transparently.

  `@podkit/core` now routes `ensureSysInfoExtended` through the new orchestrator with SCSI fallback, and registers two new `podkit doctor` checks: `inquiry-methods` (reports which transports are available on this host) and `sysinfo-consistency` (validates that the on-disk SysInfo file matches the live firmware read). EACCES errors from SCSI include step-by-step recovery instructions.

  `podkit` CLI gains `--repair udev-rule` in `podkit doctor` to install the Linux udev rule that grants non-root `/dev/sg*` access, and surfaces the new doctor checks in the readiness output.

- [`4598f8f`](https://github.com/jvgomg/podkit/commit/4598f8f3347cf40b94fdf1585215e5b0f54d9cf6) Thanks [@jvgomg](https://github.com/jvgomg)! - USB firmware inquiry consolidated into @podkit/ipod-firmware (P2 — m-18 device-capability architecture).

  **Breaking change in `@podkit/libgpod-node`:** The `readSysInfoExtendedFromUsb` function has been removed from the package's public exports. All in-tree callers were already routed through `@podkit/ipod-firmware` since P1 — only external consumers of `@podkit/libgpod-node` who called this function directly are affected.

  `@podkit/ipod-firmware` now owns the complete firmware inquiry surface: SCSI (Linux SG_IO + macOS IOKit) and USB (direct libusb-1.0 via koffi FFI). The P1 transitional shim that delegated USB reads to libgpod-node has been replaced by a native TypeScript implementation. No API change is visible to callers of `@podkit/ipod-firmware`.

  `@podkit/libgpod-node` no longer requires libusb at build or runtime. Distro packagers can now build the native binding without `libusb-1.0-0-dev` (Debian/Ubuntu), `libusb-devel` (Fedora/RHEL), or equivalent system packages. The `itdb_usb.c` patch, the `dlsym` shim, and the libusb pkg-config dependency have all been removed from the binding.

  No user-facing CLI behaviour changes. `podkit doctor` inquiry checks, `podkit device scan`, and all sync paths behave identically to P1.

- [`e825ee1`](https://github.com/jvgomg/podkit/commit/e825ee1dd4933ecbfd070dda27f96f43056f0baf) Thanks [@jvgomg](https://github.com/jvgomg)! - Replace koffi-based libusb FFI with the `usb` npm package for USB firmware inquiry, eliminating the runtime libusb system dependency.

  The `@podkit/ipod-firmware` USB transport now uses the `usb` npm package, whose prebuilt N-API bindings statically link libusb. End-user binaries embed that prebuild via Bun `--compile`; no system `libusb-1.0` is required at runtime. The Linux prebuilds do dynamically link `libudev.so.1` — this is present on standard glibc distributions, and the Docker image installs `eudev-libs` for Alpine/musl.

  Public-surface changes in `@podkit/ipod-firmware`:
  - **Removed:** `loadLibusb`, `LibusbBinding`, `LibusbPtr`, `LibusbLoadResult`, `_resetLibusbCacheForTests`. The koffi-shaped binding interface is gone.
  - **Added:** `loadUsb`, `UsbBinding`, `UsbDeviceHandle`, `UsbLoadResult`, `_resetUsbCacheForTests`. Higher-level `withOpenDevice(bus, devnum, fn)` seam — implementations handle enumeration, open, and cleanup internally.
  - **Added:** `setLogger(fn | null)`, `FirmwareLogger`, `FirmwareLogEvent`. Library no longer writes to stderr/stdout; consumers install a receiver and decide format/destination. The CLI installs one when `-v` is passed.
  - **Added:** `@podkit/ipod-firmware/bundler-plugin` subpath export with `usbNativeBundlerPlugin(stagedNodePath)` for single-file binary builds. This is a build-time `Bun.build` plugin — it intercepts the `node-gyp-build` specifier at bundle time so Bun can statically embed the `.node` binary; a runtime require-hook approach cannot work in Bun-compiled binaries. See `agents/ipod-firmware.md` for the staging recipe.
  - **Renamed:** `UsbInquiryError.libusbCode` → `UsbInquiryError.libusbStatus`. The new field carries `LIBUSB_TRANSFER_*` status codes (positive enum) from the `usb` npm package, not the negative `LIBUSB_ERROR_*` codes the koffi path returned.

  Doctor's `inquiry-methods` check no longer reports libusb availability — the USB transport is bundled and always present in shipped binaries. The check now reports SCSI transport availability only, which remains user-actionable on Linux (udev permissions) and macOS (iPodDriver.kext).

### Patch Changes

- [`bb2e637`](https://github.com/jvgomg/podkit/commit/bb2e6374151605d11baf052c452f10a842e5353e) Thanks [@jvgomg](https://github.com/jvgomg)! - Externalize `koffi` and `usb` from the published `bun build` bundles. Koffi loads its native binding via `eval('require')(filename)`; bun's bundler shims top-level `require` as `__require` (via `createRequire(import.meta.url)`) but does not inject `require` into eval'd literals, so the bundled CLI hit `ReferenceError: require is not defined` whenever the SCSI inquiry path was actually reached. The native loaders are now resolved at runtime via `node_modules`, which is also more correct for `usb` (whose `bun build`-time prebuild only matched the build host's platform).

  The standalone-binary path (`bun --compile` via `compile.sh`) is unchanged — it stages platform-specific `.node` files and uses static `require()` in `compile-entry.js`, which works correctly. A bug in `compile.sh`'s linux-arm64 branch is also fixed: the script previously constructed `linux-arm64/node.napi.${USB_VARIANT}.node` (where `USB_VARIANT` is `glibc` or `musl`) but the `usb` package only ships `linux-arm64/node.napi.armv8.node` — no glibc/musl split exists for arm64. The script now selects the armv8 prebuild unconditionally on arm64.

  `@podkit/ipod-firmware` is also externalized from the `@podkit/core` and `@podkit/devices-ipod` builds, so neither package's `dist/index.js` re-inlines firmware (and therefore koffi/usb imports). Bundle content-check tests under `packages/*/src/bundle.test.ts` assert that no `eval("require")` slips into any published bundle.

- [`a78e5fe`](https://github.com/jvgomg/podkit/commit/a78e5fee4e47293c1935395bb157cb6574782625) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix three `podkit doctor` repair correctness bugs:
  - `--repair sysinfo-consistency` now overwrites a stale on-disk SysInfoExtended (previously short-circuited on file existence, reporting success without rewriting).
  - `--repair sysinfo-extended` no longer requires an existing iTunesDB — repairs without a `database` requirement skip the DB open so identity-populating repairs work on freshly formatted iPods. New `'database'` value on `RepairRequirement`.
  - The readiness `SysInfoExtended:` status line distinguishes a missing file from a present-but-unparseable one.

- [`3e95baf`](https://github.com/jvgomg/podkit/commit/3e95baffc65b683b5e3f80906e9a342245a6e4ce) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix iPod model identification regressing to "Unknown iPod" after `doctor --repair sysinfo-extended` on pre-2006 devices (mini 2G), and tighten the package-boundary contract so consumers compose identity instead of injecting resolution policy.

  The bug: each consumer of `ensureSysInfoExtended` / `readSysInfoExtended` passed a serial-only `resolveModel` callback. When the 3-character serial suffix wasn't in `tables/serials.ts`, the resolver returned undefined and the device was displayed as "Unknown iPod" — even when a SysInfo file with a known `ModelNumStr` was sitting next to the SysInfoExtended on disk.

  The fix:
  - **Removed** `ModelResolver` type and the `resolveModel` callback from `@podkit/ipod-firmware`. `readSysInfoExtended` and `ensureSysInfoExtended` now return a flat `SysInfoIdentity` bag (`firewireGuid?, serialNumber?, modelNumStr?, familyId?`). When a SysInfo file is on disk alongside SysInfoExtended, its `ModelNumStr` is read opportunistically.
  - **Callers compose** with `resolveIpodModel(bag)` from `@podkit/devices-ipod`, which cascades modelNumStr → serial → productId → familyId → libgpodGeneration. The CLI no longer makes resolution decisions.
  - **Added** `SYSINFO_PATH`, `SYSINFO_EXTENDED_PATH`, `SYSINFO_DEVICE_DIR` exported from `@podkit/ipod-firmware` and re-exported from `@podkit/core`. Consumers use these constants instead of duplicating the literal `iPod_Control/Device/...` paths.
  - **Added** `S4G: '9804'` entry to `tables/serials.ts` (mini 2G 4GB Pink, sourced from real hardware, serial `JQ5141TFS4G`).
  - **Post-write enrichment.** After `ensureSysInfoExtended` writes the file via USB inquiry, it now re-reads via `readSysInfoExtended` so the post-write identity bag includes `modelNumStr` from the SysInfo neighbour. Eliminates the cosmetic regression where the repair-success message showed a less-specific name than the subsequent `doctor` run.

- [`eed4126`](https://github.com/jvgomg/podkit/commit/eed4126fe91ff64f00d74e8a2aaaae38ca6d786b) Thanks [@jvgomg](https://github.com/jvgomg)! - Improve the firmware-inquiry orchestrator's failure message so users can see what went wrong without `-vv`. The default error now names every transport attempted (USB, SCSI) with each one's failure reason on its own line and includes a remediation hint (e.g. `podkit doctor --repair udev-rule` for EACCES on `/dev/sg*` or `/dev/bus/usb/...`). The orchestrator also no longer short-circuits a planned SCSI fallback when USB hits a permission wall — both transports run if the plan calls for it.

- [`80fe65a`](https://github.com/jvgomg/podkit/commit/80fe65a022c65da512f571a8abf83f9385a649e6) Thanks [@jvgomg](https://github.com/jvgomg)! - Fix SysInfoExtended SCSI-fallback on macOS for SCSI-only iPods (mini 2G, nano 2G, iPod 5G/5.5G). `device add` and `doctor --repair sysinfo-extended` now correctly fall back from USB → SCSI when the device does not respond to vendor control transfers, instead of failing with a misleading "Could not read device identity from USB" error.

  Internal API changes in `@podkit/ipod-firmware`:
  - **Changed:** `ensureSysInfoExtended(mountPoint, fp, options?)` now takes a full `UsbFingerprint` instead of the previous `{ busNumber, deviceAddress }` shape. Required so the macOS SCSI transport can locate the IOService via vendorId/productId/serialNumber. `UsbDeviceAddress` is removed.
  - **Added:** `inquireFirmwareDetailed(fp, opts?)` — like `inquireFirmware` but returns `{ firmware, plan, attempts }` so callers can distinguish which transports were attempted. `inquireFirmware` is unchanged for existing consumers.
  - **Added:** `EnsureSysInfoExtendedOptions` type with `readFromUsb`, `resolveModel`, `inquireOptions` fields. Replaces the previous positional `(mountPoint, fp, readFromUsb, resolveModel)` signature.

  Internal API changes in `@podkit/core`:
  - **Added:** `hasCompleteUsbFingerprint(fp): fp is CompleteUsbDevice` type guard exported from `@podkit/core`.
  - **Added:** `CompleteUsbDevice` type — a `UsbFingerprint` with vendorId, productId, bus, devnum guaranteed present (serialNumber optional).
  - **Changed:** `resolveUsbDeviceFromPath(path)` now also returns `vendorId` and `productId`. Linux extracts from sysfs `idVendor`/`idProduct`; macOS extracts from `system_profiler` JSON.

  User-facing error messages now differentiate between transport failures: "Could not read device identity from USB and SCSI" / "...from USB" / "...from SCSI" / "...no firmware inquiry transport is available on this system" / "...returned data but it could not be parsed".

- Updated dependencies [[`0d4a4c2`](https://github.com/jvgomg/podkit/commit/0d4a4c2bd98667989b9631d981e609bc72e604af), [`248f5cc`](https://github.com/jvgomg/podkit/commit/248f5ccd45949a7ab9b773e81f0da537b57c85db), [`679bec8`](https://github.com/jvgomg/podkit/commit/679bec8b0c0e40fc8c6ae253ceaaba87f7ebfd2b), [`d1147e4`](https://github.com/jvgomg/podkit/commit/d1147e4a65ac103608da3730f530f6deab3cd0b6), [`bddea04`](https://github.com/jvgomg/podkit/commit/bddea044342ca9027fc95593a35795fd8de1faf4), [`fa3bb22`](https://github.com/jvgomg/podkit/commit/fa3bb2257b971e1696aa6caf469d9ec784e7e73f)]:
  - @podkit/device-types@0.1.0
