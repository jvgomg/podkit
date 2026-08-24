#!/usr/bin/env bun
/**
 * dummy-hcd daemon entry point.
 *
 * Boots the FunctionFS userspace daemon that synthesises an iPod-shaped USB
 * device on Linux `dummy_hcd` for the named persona. Runs inside the
 * `podkit-device` Lima VM (see `test-packages/lima/vms/podkit-device.yaml`)
 * after being delivered as a `bun build --compile` binary at
 * `/usr/local/bin/dummy-hcd-daemon`.
 *
 * Lifecycle:
 *
 *   1. Parse `--persona <id>` and other flags.
 *   2. Load + validate the JSON sidecar produced by the lima-test-vm runner.
 *   3. Look up the named persona; fail clearly if missing.
 *   4. (--dry-run only) Print a summary and exit 0.
 *   5. Reap any configfs tree left at our gadget name by a previous daemon
 *      that was killed before it could tear down.
 *   6. Build the configfs gadget tree from the persona descriptor.
 *   7. Mount FunctionFS, open ep0, start the event loop.
 *   8. Bind the gadget to the first UDC.
 *   9. On SIGINT/SIGTERM: tear everything down in reverse order, exit 0.
 *
 * Step 5 is what makes the lifecycle crash-safe. Teardown (step 9) only runs
 * when the process survives to run it; a SIGKILL from the unit's stop timeout,
 * an OOM kill, or a host power loss skips it entirely and strands a bound UDC
 * plus a FunctionFS instance that the *next* start cannot re-mount. Reaping on
 * the way in covers every one of those, where fixing teardown covers none.
 *
 * Failure modes:
 *
 *   - Missing sidecar / persona       → exit 2 with a descriptive error
 *   - configfs not mounted / no UDC   → exit 3 (kernel not ready)
 *   - FunctionFS mount/open failed    → exit 4
 *   - Unhandled exception in loop     → exit 1
 *
 * @module
 */

import { readFileSync } from 'node:fs';

import { parseSidecar, type SidecarPersona } from '@podkit/device-testing';

import { parseArgs, type CliOptions } from './cli.js';
import {
  attachUdc,
  createGadget,
  CONFIGFS_ROOT,
  destroyGadget,
  reapStaleGadget,
  unbindGadget,
} from './gadget.js';
import { runFunctionFs, type FunctionFsHandle } from './functionfs.js';

const EXIT_OK = 0;
const EXIT_UNEXPECTED = 1;
const EXIT_BAD_INPUT = 2;
const EXIT_KERNEL_NOT_READY = 3;
const EXIT_FFS_FAILED = 4;

/** Daemon entry. Returns the process exit code; never throws to the caller. */
export async function runDaemon(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'help') {
    process.stdout.write(parsed.usage);
    return EXIT_OK;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`error: ${parsed.message}\n\n${parsed.usage}`);
    return EXIT_BAD_INPUT;
  }
  const opts = parsed.options;

  let sidecarJson: string;
  try {
    sidecarJson = readFileSync(opts.sidecar, 'utf8');
  } catch (err) {
    process.stderr.write(`error: cannot read sidecar at ${opts.sidecar}: ${describe(err)}\n`);
    return EXIT_BAD_INPUT;
  }

  let persona: SidecarPersona;
  try {
    const sidecar = parseSidecar(sidecarJson);
    const entry = sidecar.personas[opts.persona];
    if (!entry) {
      const available = Object.keys(sidecar.personas).join(', ') || '(none)';
      process.stderr.write(
        `error: persona "${opts.persona}" not in sidecar (${opts.sidecar}).\n` +
          `available: ${available}\n`
      );
      return EXIT_BAD_INPUT;
    }
    persona = entry;
  } catch (err) {
    process.stderr.write(`error: invalid sidecar: ${describe(err)}\n`);
    return EXIT_BAD_INPUT;
  }

  if (opts.dryRun) {
    printSummary(opts, persona);
    return EXIT_OK;
  }

  return runWithGadget(opts, persona);
}

function printSummary(opts: CliOptions, persona: SidecarPersona): void {
  console.log(`dummy-hcd daemon (dry-run)`);
  console.log(`  persona:       ${persona.id} — ${persona.description}`);
  console.log(`  sidecar:       ${opts.sidecar}`);
  console.log(`  gadget-name:   ${opts.gadgetName}`);
  console.log(`  ffs-mount:     ${opts.ffsMount}`);
  console.log(
    `  vendor/product: ${persona.usbDescriptor.vendorId}/${persona.usbDescriptor.productId}`
  );
  console.log(
    `  sys-info-xml:  ${persona.sysInfoExtendedXml ? `${persona.sysInfoExtendedXml.length} bytes` : '(none)'}`
  );
  console.log(
    `  mass-storage:  ${persona.massStorageBackingFile ? persona.massStorageBackingFile.vmPath : '(none)'}`
  );
}

async function runWithGadget(opts: CliOptions, persona: SidecarPersona): Promise<number> {
  const bindFfs = persona.sysInfoExtendedXml !== undefined;
  const bindMassStorage = persona.massStorageBackingFile !== undefined;
  if (!bindFfs && !bindMassStorage) {
    process.stderr.write(
      `error: persona "${persona.id}" has neither sysInfoExtendedXml nor ` +
        `massStorageBackingFile — nothing for the daemon to do.\n`
    );
    return EXIT_BAD_INPUT;
  }

  let gadgetPath: string | null = null;
  let ffsInstance: string | null = null;
  let ffs: FunctionFsHandle | null = null;

  let teardownStarted = false;
  const teardown = async (signal: string): Promise<number> => {
    if (teardownStarted) {
      // Both SIGINT and SIGTERM can fire on the same process exit; the
      // second one would re-write `UDC=''` and try to rmdir an already-
      // empty tree. All steps are idempotent but this guard keeps the
      // log clean and saves a couple of kernel round-trips.
      return EXIT_OK;
    }
    teardownStarted = true;
    console.log(`[shutdown] received ${signal}, tearing down...`);
    // Order matters:
    //   1. Unbind UDC — kernel emits FUNCTIONFS_UNBIND on ep0, which is what
    //      lets the FFS read loop drain. Without this, ep0.close() can
    //      block on a pending read and the gadget stays bound.
    //   2. Shut down FFS — close ep0, umount the mountpoint. After UDC is
    //      unbound the FFS function is no longer in use, so umount succeeds.
    //   3. destroyGadget — rmdir the configfs tree. Skipping step 1 means
    //      rmdir `functions/ffs.*` fails with EBUSY.
    if (gadgetPath) {
      unbindGadget(gadgetPath, (m) => console.error(`[shutdown] ${m}`));
    }
    try {
      if (ffs) await ffs.shutdown();
    } catch (err) {
      console.error(`[shutdown] ffs.shutdown failed: ${describe(err)}`);
    }
    if (gadgetPath && ffsInstance) {
      destroyGadget(gadgetPath, ffsInstance, (m) => console.error(`[shutdown] ${m}`));
    }
    return EXIT_OK;
  };

  let resolveDone: (code: number) => void;
  const donePromise = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  const installSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    process.on(signal, () => {
      teardown(signal)
        .then((code) => resolveDone(code))
        .catch((err) => {
          console.error(`[shutdown] unexpected: ${describe(err)}`);
          resolveDone(EXIT_UNEXPECTED);
        });
    });
  };
  installSignal('SIGINT');
  installSignal('SIGTERM');

  try {
    // Release anything a previous daemon left behind under our gadget name
    // before touching the kernel. A daemon that was killed rather than
    // signalled never ran the teardown below, so its configfs tree is still
    // there holding a UDC — and while it holds one, this persona's FunctionFS
    // instance cannot be re-mounted and the slot cannot be re-used. Teardown
    // is not a safe place to fix that: the failure mode is precisely a
    // process that did not live long enough to tear down.
    reapStaleGadget(`${CONFIGFS_ROOT}/${opts.gadgetName}`, opts.gadgetName, (m) =>
      console.error(`[reap] ${m}`)
    );

    const gadget = createGadget({
      name: opts.gadgetName,
      persona,
      bindFfs,
      bindMassStorage,
    });
    gadgetPath = gadget.gadgetPath;
    ffsInstance = gadget.ffsInstance;

    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    if (bindFfs) {
      // `runFunctionFs` owns the descriptor handshake → UDC bind → BIND
      // event sequence. It calls our `attachUdc` callback at the correct
      // point and only returns after the kernel confirms enumeration.
      ffs = await runFunctionFs({
        ffsMount: opts.ffsMount,
        ffsInstance: gadget.ffsInstance,
        sysInfoExtendedXml: persona.sysInfoExtendedXml!,
        attachUdc: () => attachUdc(gadget.gadgetPath),
      });
      console.log(`[ready] gadget ${persona.id} bound (FunctionFS + UDC)`);
    } else {
      // Mass-storage-only personas have no FunctionFS endpoint; the kernel
      // still enumerates them from the configfs tree alone, so a direct
      // UDC bind is sufficient.
      const udc = attachUdc(gadget.gadgetPath);
      console.log(`[ready] gadget ${persona.id} bound to UDC ${udc} (mass-storage only)`);
      // Bun (unlike Node) does not consider `process.on('SIGTERM', …)` a
      // pending handle that keeps the event loop alive. Without an open
      // file descriptor (the FunctionFS ep0 in the bindFfs branch above),
      // the loop drains and the runtime exits ~16ms after attachUdc,
      // leaving the gadget bound but the daemon process gone — and
      // systemctl reports the unit as `inactive` even though /dev/sg* +
      // /dev/sd* are live. A 1-hour interval timer is the smallest fix
      // that keeps the loop alive without polling; the signal handler
      // clears it during teardown. 1h is arbitrary — short enough to
      // be visibly distinct in a heap dump, long enough that it should
      // never actually fire in practice.
      keepAliveTimer = setInterval(() => {}, 60 * 60 * 1000);
    }

    // Wait until a signal arrives.
    const code = await donePromise;
    if (keepAliveTimer !== null) clearInterval(keepAliveTimer);
    return code;
  } catch (err) {
    const message = describe(err);
    process.stderr.write(`error: ${message}\n`);
    if (gadgetPath && ffsInstance) {
      destroyGadget(gadgetPath, ffsInstance, (m) => console.error(`[shutdown] ${m}`));
    }
    if (/no UDC|configfs|ENOENT.*usb_gadget/.test(message)) {
      return EXIT_KERNEL_NOT_READY;
    }
    if (/functionfs/i.test(message)) {
      return EXIT_FFS_FAILED;
    }
    return EXIT_UNEXPECTED;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

// When compiled with `bun build --compile`, this file is the entry. We
// guard the call so unit tests can import `runDaemon` without booting it.
const isEntry =
  // Bun-compiled binaries set this property.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Bun?.main === import.meta.path ||
  process.argv[1]?.endsWith('main.ts') ||
  process.argv[1]?.endsWith('dummy-hcd-daemon');

if (isEntry) {
  runDaemon(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`fatal: ${describe(err)}`);
      process.exit(EXIT_UNEXPECTED);
    });
}
