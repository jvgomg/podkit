---
"podkit": minor
"@podkit/core": minor
"@podkit/ipod-firmware": minor
---

Replace koffi-based libusb FFI with the `usb` npm package for USB firmware inquiry, eliminating the runtime libusb system dependency.

The `@podkit/ipod-firmware` USB transport now uses the `usb` npm package, whose prebuilt N-API bindings statically link libusb. End-user binaries embed that prebuild via Bun `--compile`; no system `libusb-1.0` is required at runtime. The Linux prebuilds do dynamically link `libudev.so.1` — this is present on standard glibc distributions, and the Docker image installs `eudev-libs` for Alpine/musl.

Public-surface changes in `@podkit/ipod-firmware`:

- **Removed:** `loadLibusb`, `LibusbBinding`, `LibusbPtr`, `LibusbLoadResult`, `_resetLibusbCacheForTests`. The koffi-shaped binding interface is gone.
- **Added:** `loadUsb`, `UsbBinding`, `UsbDeviceHandle`, `UsbLoadResult`, `_resetUsbCacheForTests`. Higher-level `withOpenDevice(bus, devnum, fn)` seam — implementations handle enumeration, open, and cleanup internally.
- **Added:** `setLogger(fn | null)`, `FirmwareLogger`, `FirmwareLogEvent`. Library no longer writes to stderr/stdout; consumers install a receiver and decide format/destination. The CLI installs one when `-v` is passed.
- **Added:** `@podkit/ipod-firmware/bundler-plugin` subpath export with `usbNativeBundlerPlugin(stagedNodePath)` for single-file binary builds. This is a build-time `Bun.build` plugin — it intercepts the `node-gyp-build` specifier at bundle time so Bun can statically embed the `.node` binary; a runtime require-hook approach cannot work in Bun-compiled binaries. See `agents/ipod-firmware.md` for the staging recipe.
- **Renamed:** `UsbInquiryError.libusbCode` → `UsbInquiryError.libusbStatus`. The new field carries `LIBUSB_TRANSFER_*` status codes (positive enum) from the `usb` npm package, not the negative `LIBUSB_ERROR_*` codes the koffi path returned.

Doctor's `inquiry-methods` check no longer reports libusb availability — the USB transport is bundled and always present in shipped binaries. The check now reports SCSI transport availability only, which remains user-actionable on Linux (udev permissions) and macOS (iPodDriver.kext).
