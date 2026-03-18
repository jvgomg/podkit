// Compile entry point for `bun build --compile`.
//
// Bun's compiler only detects .node files for embedding when they appear in
// a CJS require() in a .js file. ESM imports and createRequire() are not
// detected. This shim ensures the native binding is embedded in the binary,
// then delegates to the actual CLI entry point.
//
// The gpod_binding.node file is staged by scripts/compile.sh before compilation.
// We store it on globalThis so the binding loader can retrieve it without
// needing to require() the .node file again (which fails from /$bunfs).
try {
  globalThis.__podkit_native_binding = require('../gpod_binding.node');
} catch (err) {
  // dlopen may fail if runtime deps are missing — that's fine for commands
  // that don't touch the iPod database (--version, --help, completions).
  // Store the error so the binding loader can report it accurately.
  globalThis.__podkit_native_binding_error = err;
}
import('./main.ts');
