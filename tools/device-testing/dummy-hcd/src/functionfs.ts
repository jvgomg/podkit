/**
 * FunctionFS ep0 event loop — the actual SETUP-packet handler.
 *
 * # Implementation status
 *
 * **Scaffold.** This module mounts FunctionFS via the `mount` command-line
 * tool, opens ep0 with `fs.open`/`fs.read`, decodes each SETUP packet using
 * the pure logic in `protocol.ts`, and writes the response bytes back to
 * ep0. It does **NOT** yet write the initial FunctionFS USB descriptor /
 * strings tables (which require `FUNCTIONFS_DESCRIPTORS_MAGIC_V2` headers
 * plus the in-band `usb_functionfs_descs_head_v2` struct on first write).
 *
 * The descriptor handshake is the only piece left between "the daemon
 * starts and STALLs every transfer" and "the daemon actually answers
 * SETUP packets". The handshake is ~100 lines of byte-packing and is
 * straightforward to add once we can verify against a live `dummy_hcd` —
 * which means inside the test VM, not on this macOS dev host.
 *
 * # Why scaffold-now
 *
 * 1. **No kernel access on macOS.** macOS has no `configfs`, no
 *    `dummy_hcd`, and no FunctionFS — there is no way to validate the
 *    descriptor handshake locally. Adding speculative code that we cannot
 *    exercise would just be more surface for a typo. The agent guide
 *    in TASK-322.05 explicitly authorises a scaffold here.
 *
 * 2. **The protocol layer is fully testable.** All the wire-shape work
 *    (paging, SETUP decoding, short-read termination) lives in
 *    `protocol.ts` and has unit-test coverage. The descriptor handshake
 *    is opaque byte-packing — it can be unit-tested without a kernel, and
 *    will be in a follow-up task once we have a live test VM to verify
 *    against.
 *
 * 3. **Clean SIGINT path.** The scaffold runs an `ep0` read loop in the
 *    background; SIGINT/SIGTERM closes the fd and exits cleanly. This is
 *    necessary for AC #6 (systemd cleanly restarts the daemon between
 *    tests) and is end-to-end testable today via `--dry-run + signal`.
 *
 * @see protocol.ts
 * @see https://www.kernel.org/doc/html/latest/usb/functionfs.html
 * @module
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';

import { classifyRequest, getPagePayload, PAGE_SIZE, parseSetupPacket } from './protocol.js';

// ---------------------------------------------------------------------------
// FunctionFS event packet layout — `struct usb_functionfs_event`
//
//   union u { struct usb_ctrlrequest setup; } u;  // bytes 0..7
//   __u8 type;                                     // byte  8
//   __u8 _pad[3];                                  // bytes 9..11
//
// Type values (enum usb_functionfs_event_type in <linux/usb/functionfs.h>):
// ---------------------------------------------------------------------------

const FFS_EVENT_SIZE = 12;
const FFS_EVENT_TYPE_OFFSET = 8;
const FFS_EVENT_BIND = 0;
const FFS_EVENT_UNBIND = 1;
const FFS_EVENT_ENABLE = 2;
const FFS_EVENT_DISABLE = 3;
const FFS_EVENT_SETUP = 4;
const FFS_EVENT_SUSPEND = 5;
const FFS_EVENT_RESUME = 6;

/** Inputs to `runFunctionFs`. */
export interface FunctionFsOpts {
  /** Mountpoint to bind FunctionFS to. Created if absent. */
  ffsMount: string;
  /** configfs gadget function instance name (matches `ffs.<name>`). */
  ffsInstance: string;
  /** SysInfoExtended XML to serve over the vendor read. */
  sysInfoExtendedXml: string;
  /** Logger; defaults to console.log. */
  log?: (message: string) => void;
}

/** Outcome of the ep0 event loop. Resolves when the loop terminates. */
export interface FunctionFsHandle {
  /** Stop the event loop and close ep0. Idempotent. */
  shutdown(): Promise<void>;
  /** Wait for the event loop to terminate. */
  done(): Promise<void>;
}

/**
 * Mount FunctionFS at `ffsMount`, open ep0, run the SETUP-packet event
 * loop. Returns a handle whose `shutdown()` is wired into the daemon's
 * signal-handler chain.
 */
export async function runFunctionFs(opts: FunctionFsOpts): Promise<FunctionFsHandle> {
  const log = opts.log ?? ((m: string) => console.log(`[ffs] ${m}`));
  await fsp.mkdir(opts.ffsMount, { recursive: true });

  // Mount FunctionFS. The instance name (ffsInstance) is supplied as the
  // *source* — it must match the configfs `ffs.<name>` directory.
  log(`mounting functionfs (instance=${opts.ffsInstance}) at ${opts.ffsMount}`);
  const mount = spawnSync('mount', ['-t', 'functionfs', opts.ffsInstance, opts.ffsMount]);
  if (mount.status !== 0) {
    const stderr = mount.stderr?.toString() ?? '';
    throw new Error(
      `runFunctionFs: failed to mount functionfs (exit=${mount.status}): ${stderr.trim() || '(no stderr)'}`
    );
  }

  // TODO(TASK-322.05.01): write the descriptor handshake to ep0
  // before reading. The handshake is a plain `ep0.write(buffer)` whose first
  // 4 bytes are FUNCTIONFS_DESCRIPTORS_MAGIC_V2 (0x00000003 LE) followed by
  // struct usb_functionfs_descs_head_v2 + endpoint descriptor table, then a
  // second write for the strings table. NO ioctl is involved — the kernel
  // detects the magic inside the buffer. Deferred only because the byte
  // layout is opaque and we cannot verify it without a live `dummy_hcd`
  // kernel instance to observe the resulting USB enumeration.
  //
  // When the handshake lands, this function MUST NOT return until the
  // FUNCTIONFS_BIND event arrives on ep0 (or a timeout). Otherwise
  // `attachUdc()` in main.ts runs before the kernel accepts the descriptors
  // and enumeration fails. Signal readiness from the loop via an awaited
  // promise resolved on the first FUNCTIONFS_BIND event.

  const ep0 = await fsp.open(`${opts.ffsMount}/ep0`, 'r+');
  let running = true;
  let donePromise: Promise<void> | null = null;

  const loop = async (): Promise<void> => {
    const buf = Buffer.allocUnsafe(PAGE_SIZE + 32);
    while (running) {
      let read: fs.promises.FileReadResult<Buffer>;
      try {
        read = await ep0.read(buf, 0, buf.byteLength, null);
      } catch (err) {
        if (!running) return; // shutdown raced
        log(`ep0 read error: ${describe(err)}`);
        return;
      }
      if (read.bytesRead === 0) {
        // FunctionFS closed.
        return;
      }
      // ep0 emits one `struct usb_functionfs_event` per read once the
      // descriptor handshake completes — never raw 8-byte SETUP packets.
      // The struct is 12 bytes packed: bytes 0..7 are `union u` (which for
      // SETUP events contains the 8-byte SETUP packet), byte 8 is `type`,
      // bytes 9..11 are padding. Pre-handshake the kernel sends nothing,
      // so this branch only fires once the follow-up lands.
      if (read.bytesRead >= FFS_EVENT_SIZE) {
        const eventType = buf[FFS_EVENT_TYPE_OFFSET]!;
        handleEvent(eventType, buf, opts, log, ep0);
      } else {
        log(`ignoring ${read.bytesRead}-byte short ep0 read (expected ${FFS_EVENT_SIZE})`);
      }
    }
  };

  donePromise = loop();

  return {
    async shutdown(): Promise<void> {
      if (!running) return;
      running = false;
      try {
        await ep0.close();
      } catch {
        // already closed
      }
      try {
        spawnSync('umount', [opts.ffsMount]);
      } catch {
        // best-effort
      }
    },
    async done(): Promise<void> {
      if (donePromise) await donePromise;
    },
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function handleEvent(
  eventType: number,
  buf: Buffer,
  opts: FunctionFsOpts,
  log: (m: string) => void,
  ep0: fsp.FileHandle
): void {
  switch (eventType) {
    case FFS_EVENT_BIND:
      log('event: BIND (descriptors accepted)');
      return;
    case FFS_EVENT_UNBIND:
      log('event: UNBIND');
      return;
    case FFS_EVENT_ENABLE:
      log('event: ENABLE');
      return;
    case FFS_EVENT_DISABLE:
      log('event: DISABLE');
      return;
    case FFS_EVENT_SUSPEND:
      log('event: SUSPEND');
      return;
    case FFS_EVENT_RESUME:
      log('event: RESUME');
      return;
    case FFS_EVENT_SETUP:
      handleSetup(buf, opts, log, ep0);
      return;
    default:
      log(`event: unknown type=${eventType}`);
  }
}

function handleSetup(
  buf: Buffer,
  opts: FunctionFsOpts,
  log: (m: string) => void,
  ep0: fsp.FileHandle
): void {
  // SETUP packet lives in bytes 0..7 of the event struct (`union u.setup`).
  const setup = parseSetupPacket(new Uint8Array(buf.buffer, buf.byteOffset, 8));
  const classified = classifyRequest(setup);
  if (classified.kind !== 'sysinfo-extended') {
    log(`unhandled request: ${classified.reason}`);
    // Writing zero bytes on a vendor read is interpreted by the host as a
    // short read / stall depending on the kernel version. The proper
    // response is FUNCTIONFS_IOCTL_STALL via ioctl, which Bun cannot issue
    // directly — TODO follow-up.
    return;
  }
  const { bytes } = getPagePayload(opts.sysInfoExtendedXml, classified.page, classified.maxLength);
  // Fire-and-await with error swallow; the loop must not abort on a write
  // failure (kernel may have already torn down the transfer).
  void ep0.write(bytes).catch((err) => {
    log(`ep0 write failed for page ${classified.page}: ${describe(err)}`);
  });
}
