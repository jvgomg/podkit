// Compile entry point for `bun build --compile`.
//
// Bun's compiler only detects .node files for embedding when they appear in
// a CJS require() in a .js file. ESM imports and createRequire() are not
// detected. This shim embeds the gpod_binding.node addon, then delegates to
// the actual CLI entry point.
//
// The `usb` npm prebuild is embedded separately, at build time, by the
// bundler plugin in scripts/compile-build.ts — the `usb` package's static
// require of node-gyp-build cannot be intercepted at runtime under Bun
// --compile, so it must be swapped during the build.
//
// The .node file is staged by scripts/compile.sh before compilation:
//   ../gpod_binding.node — libgpod-node
try {
  globalThis.__podkit_native_binding = require('../gpod_binding.node');
} catch (err) {
  // dlopen may fail if runtime deps are missing — that's fine for commands
  // that don't touch the iPod database (--version, --help, completions).
  // Store the error so the binding loader can report it accurately.
  globalThis.__podkit_native_binding_error = err;
}

import('./main.ts');
