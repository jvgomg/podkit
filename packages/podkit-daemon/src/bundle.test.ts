/**
 * Reachability guard for the `@podkit/daemon` compile.
 *
 * The daemon compiles with a plain `bun build --compile` — NO
 * `usbNativeBundlerPlugin` (unlike the CLI, see
 * `packages/podkit-cli/scripts/compile-build.ts`). That plugin exists to
 * make the `usb` package's `require('node-gyp-build')(__dirname)` native
 * loader work inside a single-file binary; without it, a compiled binary
 * that actually *calls* `loadUsb` throws at runtime because the
 * `usb/prebuilds/` directory does not exist inside the binary.
 *
 * The daemon gets away without the plugin because it never reaches
 * `loadUsb`: it delegates ALL device I/O to the `podkit` CLI subprocess
 * (`cli-runner.ts` — `podkit --json …`) and detects devices via `lsblk`
 * + sysfs. The only in-process `@podkit/core` import is the pure string
 * helper `stripPartitionSuffix`. The full koffi/usb/firmware graph is
 * still *inlined* into the compiled binary — `@podkit/core`'s barrel
 * statically imports `@podkit/ipod-firmware`, and the standalone binary
 * must satisfy that static import at load time, so it cannot be
 * externalised (doing so crashes startup with "Cannot find module
 * @podkit/ipod-firmware"). But it is dead code: `loadUsb` /
 * `node-gyp-build` are present in the binary yet never invoked.
 *
 * This test pins that reachability contract at the source level (a bundle
 * content-scan can't tell live code from dead code). If a future refactor
 * makes the daemon call firmware inquiry / `loadUsb` in-process, these
 * assertions fail — a loud signal that the daemon now needs the
 * `usbNativeBundlerPlugin` in its `compile` script (or must keep shelling
 * out to the CLI). See TASK-461.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = __dirname;

/** Read every non-test daemon source file as { file, contents }. */
function readDaemonSources(): Array<{ file: string; contents: string }> {
  return readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ file: f, contents: readFileSync(resolve(SRC_DIR, f), 'utf8') }));
}

describe('daemon USB-inquiry reachability guard', () => {
  it('no daemon source imports @podkit/ipod-firmware', () => {
    const offenders = readDaemonSources()
      .filter(({ contents }) => contents.includes('@podkit/ipod-firmware'))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('no daemon source references loadUsb or firmware inquiry APIs', () => {
    // These are the entry points into the `usb` / node-gyp-build native
    // path. The daemon must reach none of them in-process — device
    // inquiry belongs to the `podkit` CLI subprocess.
    const forbidden = [
      'loadUsb',
      'readUsbInquiry',
      'inquireFirmware',
      'inquireFirmwareDetailed',
      'probeInquiryMethods',
    ];
    const offenders = readDaemonSources().flatMap(({ file, contents }) =>
      forbidden.filter((sym) => contents.includes(sym)).map((sym) => `${file}: ${sym}`)
    );
    expect(offenders).toEqual([]);
  });

  it('the only @podkit/core import is the pure stripPartitionSuffix helper', () => {
    // Narrowing the core surface the daemon depends on keeps the
    // firmware graph dead: anything that pulls a heavier core export
    // could add a live edge into inquiry. If the daemon legitimately
    // needs more of core, widen this list deliberately — and re-check
    // reachability into loadUsb.
    const coreImportLines = readDaemonSources().flatMap(({ file, contents }) =>
      contents
        .split('\n')
        .filter((line) => line.includes("from '@podkit/core'"))
        .map((line) => ({ file, line: line.trim() }))
    );

    expect(coreImportLines).toEqual([
      { file: 'device-poller.ts', line: "import { stripPartitionSuffix } from '@podkit/core';" },
    ]);
  });
});
