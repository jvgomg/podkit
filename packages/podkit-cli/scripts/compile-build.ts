// Bun.build driver for compiling the CLI into a single-file binary.
//
// This exists as a separate script (rather than a `bun build --compile` CLI
// invocation in compile.sh) because the CLI cannot take build plugins, and
// the `usb` prebuild must be embedded via a plugin — see
// @podkit/ipod-firmware/bundler-plugin. compile.sh stages the .node files
// and sets the env vars this script reads.

import path from 'node:path';
import { usbNativeBundlerPlugin } from '@podkit/ipod-firmware/bundler-plugin';

const outfile = process.env.PODKIT_COMPILE_OUTFILE;
const version = process.env.PODKIT_COMPILE_VERSION;
const devHooks = process.env.PODKIT_COMPILE_DEV_HOOKS;

if (!outfile) {
  console.error('compile-build: PODKIT_COMPILE_OUTFILE is required');
  process.exit(1);
}
if (!version) {
  console.error('compile-build: PODKIT_COMPILE_VERSION is required');
  process.exit(1);
}

const cliDir = path.resolve(import.meta.dir, '..');

const result = await Bun.build({
  entrypoints: [path.join(cliDir, 'src/compile-entry.js')],
  target: 'bun',
  compile: { outfile: path.resolve(cliDir, outfile) },
  define: {
    // Single-quoted string literal in the old shell command; JSON.stringify
    // is the equivalent for embedding a version string.
    PODKIT_VERSION: JSON.stringify(version),
    // Anything other than the exact string 'true' means production: dev hooks
    // must never be compiled in by accident, so the default direction is off.
    __PODKIT_DEV_HOOKS__: devHooks === 'true' ? 'true' : 'false',
  },
  plugins: [usbNativeBundlerPlugin(path.join(cliDir, 'usb_native.node'))],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
