// Compile entry point for `bun build --compile`.
//
// Bun's compiler only detects .node files for embedding when they appear in
// a CJS require() in a .js file. ESM imports and createRequire() are not
// detected. This shim ensures both native bindings are embedded in the
// binary, then delegates to the actual CLI entry point.
//
// The .node files are staged by scripts/compile.sh before compilation:
//   ../gpod_binding.node — libgpod-node
//   ../usb_native.node   — node-usb's prebuilt binding (statically links libusb)
try {
  globalThis.__podkit_native_binding = require('../gpod_binding.node');
} catch (err) {
  // dlopen may fail if runtime deps are missing — that's fine for commands
  // that don't touch the iPod database (--version, --help, completions).
  // Store the error so the binding loader can report it accurately.
  globalThis.__podkit_native_binding_error = err;
}

// Embed the `usb` npm prebuild and hand it to ipod-firmware's bundle
// helper, which patches node-gyp-build resolution so the package's loader
// finds our pre-loaded module instead of looking for a prebuild path.
try {
  const { bundleUsbNative } = require('@podkit/ipod-firmware/bundle');
  bundleUsbNative(require('../usb_native.node'));
} catch (err) {
  globalThis.__podkit_usb_native_binding_error = err;
}

import('./main.ts');
