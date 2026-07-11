'use strict';

// Build-time Bun plugin for single-file binaries that bundle the `usb`
// package (via @podkit/ipod-firmware).
//
// The `usb` package loads its native binding through
// `require('node-gyp-build')(__dirname)`, which scans
// `node_modules/usb/prebuilds/` on the real filesystem at runtime. That
// directory does not exist inside a Bun --compile binary. Runtime
// interception cannot help: Bun links require() calls between bundled
// modules statically at build time, so a `Module._resolveFilename` hook is
// never consulted for the `usb → node-gyp-build` edge.
//
// The fix is a build-time swap. This plugin intercepts the `node-gyp-build`
// specifier — only for importers inside the `usb` package — and resolves it
// to a virtual module whose body is a static `require()` of the staged
// prebuild's absolute path. Bun's compiler detects that static require of a
// .node file and embeds it in the binary, so the prebuild travels with the
// executable instead of being read from disk.
//
// Usage from a Bun.build driver:
//
//     import { usbNativeBundlerPlugin } from '@podkit/ipod-firmware/bundler-plugin';
//
//     await Bun.build({
//       entrypoints: [entry],
//       target: 'bun',
//       compile: { outfile },
//       plugins: [usbNativeBundlerPlugin('/abs/path/to/usb_native.node')],
//     });
//
// The caller stages the platform-correct usb prebuild at the given absolute
// path before invoking the build. See agents/ipod-firmware.md for the
// staging recipe.

const NAMESPACE = 'podkit-usb-native';

function usbNativeBundlerPlugin(stagedNodePath) {
  if (typeof stagedNodePath !== 'string' || stagedNodePath.length === 0) {
    throw new Error('usbNativeBundlerPlugin: stagedNodePath must be a non-empty string');
  }
  const path = require('path');
  if (!path.isAbsolute(stagedNodePath)) {
    throw new Error(
      `usbNativeBundlerPlugin: stagedNodePath must be absolute, got "${stagedNodePath}"`
    );
  }

  return {
    name: 'podkit-usb-native-bundler',
    setup(build) {
      build.onResolve({ filter: /^node-gyp-build$/ }, (args) => {
        // Scope to the installed `usb` package only — other node-gyp-build
        // consumers, and project code that merely lives under a directory
        // named `usb/`, keep their normal resolution.
        if (!args.importer.includes('/node_modules/usb/')) return undefined;
        return { path: 'node-gyp-build-stub', namespace: NAMESPACE };
      });

      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, () => ({
        contents: `module.exports = () => require(${JSON.stringify(stagedNodePath)});`,
        loader: 'js',
      }));
    },
  };
}

module.exports = { usbNativeBundlerPlugin };
