'use strict';

// Runtime helper for single-file binaries that bundle @podkit/ipod-firmware.
//
// The `usb` npm package loads its native binding via `node-gyp-build`, which
// resolves a platform-specific .node file from `node_modules/usb/prebuilds/`
// at runtime. That path doesn't exist inside a Bun-compiled binary's virtual
// filesystem, so we intercept the resolution and hand back a pre-loaded
// native module instead.
//
// Usage from a CJS entry shim (e.g. Bun --compile entry):
//
//     const { bundleUsbNative } = require('@podkit/ipod-firmware/bundle');
//     bundleUsbNative(require('./path/to/your-staged-usb.node'));
//
// The caller is responsible for staging the platform-correct usb prebuild
// at build time. See agents/ipod-firmware.md for the staging recipe.

const Module = require('module');

const NGB_STUB_ID = '__podkit_ipod_firmware_node_gyp_build_stub';

let installed = false;

/**
 * Patch the module loader so the `usb` package's internal
 * `require('node-gyp-build')(__dirname)` returns the supplied pre-loaded
 * native module. The intercept is scoped — only triggers when the
 * requesting module lives inside `usb/dist/`, so other packages that
 * depend on node-gyp-build keep their normal resolution.
 *
 * Idempotent: subsequent calls update the bound native module but don't
 * re-install the resolver hook.
 */
function bundleUsbNative(usbNative) {
  Module._cache[NGB_STUB_ID] = {
    id: NGB_STUB_ID,
    filename: NGB_STUB_ID,
    loaded: true,
    exports: () => usbNative,
    children: [],
    paths: [],
  };

  if (installed) return;
  installed = true;

  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (
      request === 'node-gyp-build' &&
      parent &&
      typeof parent.filename === 'string' &&
      parent.filename.includes('/usb/dist/')
    ) {
      return NGB_STUB_ID;
    }
    return origResolve.call(this, request, parent, ...rest);
  };
}

module.exports = { bundleUsbNative };
