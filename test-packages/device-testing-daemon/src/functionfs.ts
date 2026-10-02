/**
 * FunctionFS ep0 event loop — descriptor handshake + SETUP-packet handler.
 *
 * # Flow
 *
 *   1. Mount FunctionFS at `ffsMount` against the `ffsInstance` source.
 *   2. Open ep0 read+write.
 *   3. Write the descriptor table (one `write(ep0_fd, …)` — magic detected
 *      by the kernel inside the buffer; no ioctl). See `descriptors.ts`.
 *   4. Write the strings table (second `write(ep0_fd, …)`).
 *   5. Start the ep0 read loop, then call the caller-supplied `attachUdc`
 *      hook. The UDC write is what causes the kernel to emit
 *      `FUNCTIONFS_BIND` — so the read loop must already be live to
 *      observe it.
 *   6. Resolve the returned `FunctionFsHandle` only after BIND is observed
 *      (or a watchdog timeout fires). Callers therefore know the gadget
 *      enumerated successfully before they continue.
 *
 * The handshake bytes are built in `descriptors.ts` and verified by
 * `__tests__/descriptors.test.ts` on the macOS dev host; this module owns
 * only the I/O sequencing.
 *
 * # SIGINT path
 *
 * The ep0 read loop runs in the background; SIGINT/SIGTERM calls
 * `shutdown()` which closes the fd and unmounts FunctionFS. The systemd
 * unit relies on this for clean restart between tests.
 *
 * @see protocol.ts — SETUP-packet decoding + page payloads
 * @see descriptors.ts — descriptor + strings table byte-packing
 * @see https://www.kernel.org/doc/html/latest/usb/functionfs.html
 * @module
 */

import { spawnSync } from 'node:child_process';
import * as fsp from 'node:fs/promises';

import { buildDescriptorsBuffer, buildStringsBuffer } from './descriptors.js';
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

export const FFS_EVENT_SIZE = 12;
export const FFS_EVENT_TYPE_OFFSET = 8;
const FFS_EVENT_BIND = 0;
const FFS_EVENT_UNBIND = 1;
const FFS_EVENT_ENABLE = 2;
const FFS_EVENT_DISABLE = 3;
export const FFS_EVENT_SETUP = 4;
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
  /**
   * Called after the descriptor handshake completes and the ep0 read loop
   * is running, but before `runFunctionFs` returns. The kernel only emits
   * `FUNCTIONFS_BIND` once the gadget is enabled, so this hook MUST bind
   * the parent gadget to a UDC. Returns the UDC name for logging.
   */
  attachUdc: () => string;
  /**
   * Milliseconds to wait for the kernel to emit `FUNCTIONFS_BIND` after
   * `attachUdc()`. Bind fires immediately on the UDC write under
   * `dummy_hcd`; the watchdog only catches a kernel/driver wedge. Default
   * 10s — generous enough that an overloaded test VM doesn't flake.
   */
  bindTimeoutMs?: number;
}

/** Outcome of the ep0 event loop. Resolves when the loop terminates. */
export interface FunctionFsHandle {
  /** Stop the event loop and close ep0. Idempotent. */
  shutdown(): Promise<void>;
  /** Wait for the event loop to terminate. */
  done(): Promise<void>;
}

/**
 * Mount FunctionFS at `ffsMount`, open ep0, write the descriptor + strings
 * tables, start the ep0 read loop, and bind the parent gadget to a UDC via
 * `opts.attachUdc()`. Returns the handle ONLY after the kernel emits
 * `FUNCTIONFS_BIND` on ep0 (or a watchdog timeout fires).
 *
 * The order matters:
 *
 *   1. Descriptors must be on ep0 before UDC binding — binding earlier
 *      causes the kernel to STALL enumeration.
 *   2. UDC binding must happen before we await BIND — the BIND event is
 *      what the kernel emits in response to UDC binding.
 *
 * Owning both phases inside `runFunctionFs` keeps the cross-step coupling
 * (descriptors → UDC bind → BIND event) inside one function, where it can
 * be reasoned about without consulting the daemon entry point.
 */
export async function runFunctionFs(opts: FunctionFsOpts): Promise<FunctionFsHandle> {
  const log = opts.log ?? ((m: string) => console.log(`[ffs] ${m}`));
  const bindTimeoutMs = opts.bindTimeoutMs ?? 10_000;
  await fsp.mkdir(opts.ffsMount, { recursive: true });

  // Drain any leftover FunctionFS mount at this mountpoint before mounting
  // fresh. A prior daemon shutdown calls `umount -l` (lazy), which detaches
  // the mount but defers cleanup until the last fd closes — if the bun
  // runtime is SIGKILLed before that happens, the mount survives. Re-running
  // `mount` on top of it stacks instead of replacing, leading to a kernel
  // mount-stack of identical entries (visible in `mount | grep ffs-podkit`).
  // Looping the umount drains the stack idempotently; the loop bails when
  // umount fails (mountpoint no longer mounted), so a clean mountpoint costs
  // exactly one cheap umount call.
  while (true) {
    const drain = spawnSync('umount', ['-l', opts.ffsMount]);
    if (drain.status !== 0) break;
  }

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

  const ep0 = await fsp.open(`${opts.ffsMount}/ep0`, 'r+');

  // FunctionFS descriptor handshake — plain writes to ep0. The kernel
  // detects FUNCTIONFS_DESCRIPTORS_MAGIC_V2 inside the buffer and parses
  // the in-band `usb_functionfs_descs_head_v2`. See descriptors.ts for the
  // exact layout (verified by descriptors.test.ts on macOS).
  try {
    const descriptors = buildDescriptorsBuffer();
    await ep0.write(descriptors);
    log(`wrote descriptor table (${descriptors.byteLength} bytes)`);
    const strings = buildStringsBuffer();
    await ep0.write(strings);
    log(`wrote strings table (${strings.byteLength} bytes)`);
  } catch (err) {
    await ep0.close().catch(() => {});
    spawnSync('umount', [opts.ffsMount]);
    throw new Error(`runFunctionFs: descriptor handshake failed: ${describe(err)}`);
  }

  // BIND-readiness signal. Resolved by the event loop on the first
  // FUNCTIONFS_BIND event; rejected by the watchdog on timeout.
  let resolveBind: () => void;
  let rejectBind: (err: Error) => void;
  const bindReady = new Promise<void>((resolve, reject) => {
    resolveBind = resolve;
    rejectBind = reject;
  });
  let bound = false;
  const onBind = (): void => {
    if (bound) return;
    bound = true;
    resolveBind();
  };

  let running = true;
  const donePromise = serveEp0(ep0, {
    sysInfoExtendedXml: opts.sysInfoExtendedXml,
    log,
    onBind,
    isRunning: () => running,
  });

  // Bind the gadget AFTER the read loop is live but BEFORE we wait for
  // BIND. The kernel sends the BIND event the moment the UDC write
  // completes — if we attached before starting the read loop we'd race
  // the event into a buffer we weren't yet polling.
  let udcName: string;
  try {
    udcName = opts.attachUdc();
    log(`attached to UDC ${udcName}`);
  } catch (err) {
    running = false;
    await ep0.close().catch(() => {});
    spawnSync('umount', [opts.ffsMount]);
    throw new Error(`runFunctionFs: attachUdc failed: ${describe(err)}`);
  }

  // Watchdog: if BIND doesn't arrive promptly something is wrong on the
  // kernel side (dummy_hcd misconfigured, gadget already in use, etc).
  const timer = setTimeout(() => {
    rejectBind(
      new Error(
        `runFunctionFs: FUNCTIONFS_BIND not observed within ${bindTimeoutMs}ms after UDC bind`
      )
    );
  }, bindTimeoutMs);

  try {
    await bindReady;
  } catch (err) {
    clearTimeout(timer);
    running = false;
    await ep0.close().catch(() => {});
    spawnSync('umount', [opts.ffsMount]);
    throw err;
  }
  clearTimeout(timer);

  return {
    async shutdown(): Promise<void> {
      if (!running) return;
      running = false;
      // `umount -l` (lazy) frees the FunctionFS mount even when ep0 is
      // still held by our pending read. Without it the read awaits an
      // event that the kernel won't emit until the gadget is unbound,
      // which the caller is about to do — but the caller's UDC write
      // can block on FunctionFS state, so we break the cycle here by
      // lazily detaching the mount. The process exits shortly anyway;
      // the deferred close happens when the OS reclaims our FDs.
      try {
        spawnSync('umount', ['-l', opts.ffsMount]);
      } catch {
        // best-effort
      }
      // Best-effort close; do NOT await — pending reads can keep this
      // promise unresolved indefinitely and the lazy umount above has
      // already detached the kernel-side mount.
      ep0.close().catch(() => {});
    },
    async done(): Promise<void> {
      await donePromise;
    },
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The two ep0 operations the event loop needs; an open `FileHandle` satisfies it. */
export interface Ep0 {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: null
  ): Promise<{ bytesRead: number }>;
  write(data: Uint8Array): Promise<unknown>;
}

export interface ServeEp0Opts {
  /** SysInfoExtended XML to serve over the vendor read. */
  sysInfoExtendedXml: string;
  log: (message: string) => void;
  /** Called on every `FUNCTIONFS_BIND` event. */
  onBind: () => void;
  /** Polled before each read; the loop ends once it returns false. */
  isRunning: () => boolean;
}

/**
 * Read and answer ep0 events until FunctionFS closes, `isRunning` turns false,
 * or a read fails for any reason other than a stall.
 *
 * Strictly one operation at a time. FunctionFS treats a `read()` on ep0 while
 * an IN-direction SETUP is pending as userspace asking to STALL it, so a
 * reply that has not reached the kernel before the next read turns a served
 * page into a host-side `LIBUSB_TRANSFER_STALL`. The same rule is how an
 * unrecognised request gets refused: write nothing, and the next read stalls it.
 */
export async function serveEp0(ep0: Ep0, opts: ServeEp0Opts): Promise<void> {
  const { log } = opts;
  const buf = Buffer.allocUnsafe(PAGE_SIZE + 32);
  while (opts.isRunning()) {
    let read: { bytesRead: number };
    try {
      read = await ep0.read(buf, 0, buf.byteLength, null);
    } catch (err) {
      if (!opts.isRunning()) return; // shutdown raced
      if ((err as NodeJS.ErrnoException).code === 'EL2HLT') {
        log('ep0 stalled the pending request');
        continue;
      }
      log(`ep0 read error: ${describe(err)}`);
      return;
    }
    if (read.bytesRead === 0) {
      // FunctionFS closed.
      return;
    }
    // ep0 emits one `struct usb_functionfs_event` per read. The struct
    // is 12 bytes packed: bytes 0..7 are `union u` (SETUP packet for
    // SETUP events), byte 8 is `type`, bytes 9..11 are padding.
    if (read.bytesRead >= FFS_EVENT_SIZE) {
      const eventType = buf[FFS_EVENT_TYPE_OFFSET]!;
      await handleEvent(eventType, buf, opts, ep0);
    } else {
      log(`ignoring ${read.bytesRead}-byte short ep0 read (expected ${FFS_EVENT_SIZE})`);
    }
  }
}

async function handleEvent(
  eventType: number,
  buf: Buffer,
  opts: ServeEp0Opts,
  ep0: Ep0
): Promise<void> {
  const { log } = opts;
  switch (eventType) {
    case FFS_EVENT_BIND:
      log('event: BIND (descriptors accepted)');
      opts.onBind();
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
      await handleSetup(buf, opts, ep0);
      return;
    default:
      log(`event: unknown type=${eventType}`);
  }
}

async function handleSetup(buf: Buffer, opts: ServeEp0Opts, ep0: Ep0): Promise<void> {
  const { log } = opts;
  // SETUP packet lives in bytes 0..7 of the event struct (`union u.setup`).
  const setup = parseSetupPacket(new Uint8Array(buf.buffer, buf.byteOffset, 8));
  const classified = classifyRequest(setup);
  if (classified.kind !== 'sysinfo-extended') {
    // No reply: the loop's next read is what stalls it (see serveEp0).
    log(`unhandled request: ${classified.reason}`);
    return;
  }
  const { bytes } = getPagePayload(opts.sysInfoExtendedXml, classified.page, classified.maxLength);
  // A failed write is logged, not thrown: the host may already have abandoned
  // the transfer, and the loop must keep serving the next one.
  try {
    await ep0.write(bytes);
    log(`served page ${classified.page} (${bytes.byteLength} bytes)`);
  } catch (err) {
    log(`ep0 write failed for page ${classified.page}: ${describe(err)}`);
  }
}
