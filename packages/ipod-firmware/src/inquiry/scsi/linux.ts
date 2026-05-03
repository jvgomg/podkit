/**
 * SCSI transport — Linux SG_IO ioctl via koffi.
 *
 * Opens the `/dev/sgN` node corresponding to the supplied USB fingerprint
 * (bus + devnum) and issues SG_IO ioctls to perform VPD INQUIRY reads.
 *
 * The transport-shared loop in {@link './index.js'} drives this layer
 * through a {@link ScsiSyscall} function — keeping the syscall isolated
 * makes the loop unit-testable with a mocked `ScsiSyscall` and no FFI.
 *
 * Closes risk 1 (sense), 2 (page-length re-read — handled by the loop),
 * and 3 (errno → ScsiErrorKind translation in {@link errnoToKind}).
 *
 * @module
 */

import * as fs from 'node:fs';
import type { UsbFingerprint } from '@podkit/device-types';
import { ScsiError, errnoToKind } from './errors.js';
import {
  SCSI_STATUS_CHECK_CONDITION,
  SCSI_STATUS_GOOD,
  buildVpdCdb,
  type ScsiSyscall,
  type ScsiSyscallResult,
} from './types.js';

// =============================================================================
// koffi binding (loaded lazily — keeps `bun test` from loading libc on darwin)
// =============================================================================

/**
 * Subset of libc that the SG_IO transport needs. Exported so test
 * harnesses can supply stubs.
 *
 * Note `argp` is typed as `unknown` rather than `SgIoHdr` because koffi
 * marshals the struct from a plain object at the FFI boundary; tests
 * pass `Record<string, unknown>` to assert kernel writeback behaviour.
 */
export interface LinuxBinding {
  ioctl: (fd: number, request: number, argp: unknown) => number;
  errno: () => number;
}

let cachedBinding: LinuxBinding | null = null;

/**
 * Load and cache the koffi-backed libc binding. Lazy so test suites that
 * never touch the real device do not pay the koffi.load cost, and so the
 * import graph stays clean on platforms that don't have `libc.so.6`.
 *
 * Exported for tests that want to short-circuit the binding.
 */
export async function loadLinuxBinding(): Promise<LinuxBinding> {
  if (cachedBinding) return cachedBinding;
  const koffiMod = (await import('koffi')) as unknown as {
    default?: typeof import('koffi');
  } & typeof import('koffi');
  const koffi = koffiMod.default ?? koffiMod;

  // koffi.struct registration is a side effect — `'sg_io_hdr'` is referenced
  // by name in the ioctl prototype below.
  // FINDINGS gotcha #1: pointer-to-data fields must be `uint8 *`, NOT `void *`.
  koffi.struct('sg_io_hdr', {
    interface_id: 'int',
    dxfer_direction: 'int',
    cmd_len: 'uint8',
    mx_sb_len: 'uint8',
    iovec_count: 'uint16',
    dxfer_len: 'uint32',
    dxferp: 'uint8 *',
    cmdp: 'uint8 *',
    sbp: 'uint8 *',
    timeout: 'uint32',
    flags: 'uint32',
    pack_id: 'int32',
    usr_ptr: 'uint8 *',
    status: 'uint8',
    masked_status: 'uint8',
    msg_status: 'uint8',
    sb_len_wr: 'uint8',
    host_status: 'uint16',
    driver_status: 'uint16',
    resid: 'int32',
    duration: 'uint32',
    info: 'uint32',
  });

  const libc = koffi.load('libc.so.6');
  // FINDINGS gotcha #4: use `_Inout_ sg_io_hdr *`, not `_Out_` and not `void *`.
  const ioctl = libc.func('int ioctl(int fd, unsigned long request, _Inout_ sg_io_hdr *argp)');
  const __errno_location = libc.func('int *__errno_location()');

  cachedBinding = {
    ioctl: (fd, request, argp) => ioctl(fd, request, argp),
    errno: () => {
      const ptr = __errno_location();
      // FINDINGS gotcha #5: 2-arg decode reads at offset 0, which is what we want.
      return koffi.decode(ptr, 'int32');
    },
  };
  return cachedBinding;
}

// =============================================================================
// SG_IO ioctl + sg_io_hdr field shape
// =============================================================================

/** SG_IO = _IOWR('S', 0x85, struct sg_io_hdr) = 0x2285 on Linux. */
const SG_IO = 0x2285;
const SG_DXFER_FROM_DEV = -3;
const SG_INTERFACE_ID = 0x53; // 'S'

/** TypeScript shape of the koffi-registered `sg_io_hdr` struct. */
interface SgIoHdr {
  interface_id: number;
  dxfer_direction: number;
  cmd_len: number;
  mx_sb_len: number;
  iovec_count: number;
  dxfer_len: number;
  dxferp: Buffer;
  cmdp: Buffer;
  sbp: Buffer;
  timeout: number;
  flags: number;
  pack_id: number;
  usr_ptr: Buffer | null;
  status: number;
  masked_status: number;
  msg_status: number;
  sb_len_wr: number;
  host_status: number;
  driver_status: number;
  resid: number;
  duration: number;
  info: number;
}

// =============================================================================
// /dev/sgN resolution from a USB fingerprint
// =============================================================================

/**
 * Find the `/dev/sgN` device path corresponding to the given USB
 * (bus, devnum) pair by walking sysfs. Returns the first match.
 *
 * Strategy: for each `/sys/class/scsi_generic/sgN`, follow the `device`
 * symlink and walk up parent directories looking for `busnum` + `devnum`
 * files (which only exist on USB-backed SCSI devices). Match against the
 * fingerprint's bus/devnum.
 *
 * Exported for tests and for the macOS code path to avoid duplication.
 */
export function resolveSgPathFromFingerprint(fp: UsbFingerprint): string {
  const sgRoot = '/sys/class/scsi_generic';
  let entries: string[];
  try {
    entries = fs.readdirSync(sgRoot);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    throw new ScsiError({
      kind: 'enoent',
      devicePath: sgRoot,
      message: `cannot enumerate ${sgRoot}: ${e.code ?? e.message}`,
      cause: err,
    });
  }

  for (const name of entries) {
    if (!name.startsWith('sg')) continue;
    const deviceLink = `${sgRoot}/${name}/device`;
    let resolved: string;
    try {
      resolved = fs.realpathSync(deviceLink);
    } catch {
      continue;
    }
    // Walk up the parent chain until we find busnum + devnum (USB device).
    let cur = resolved;
    for (let i = 0; i < 16; i++) {
      const busnumPath = `${cur}/busnum`;
      const devnumPath = `${cur}/devnum`;
      if (fs.existsSync(busnumPath) && fs.existsSync(devnumPath)) {
        const bus = parseInt(fs.readFileSync(busnumPath, 'utf8').trim(), 10);
        const devnum = parseInt(fs.readFileSync(devnumPath, 'utf8').trim(), 10);
        if (bus === fp.bus && devnum === fp.devnum) {
          return `/dev/${name}`;
        }
        break;
      }
      const parent = cur.replace(/\/[^/]+$/, '');
      if (parent === cur || parent === '' || parent === '/') break;
      cur = parent;
    }
  }
  throw new ScsiError({
    kind: 'enoent',
    message:
      `no /dev/sgN device matched USB fingerprint bus=${fp.bus} devnum=${fp.devnum} ` +
      `(is the iPod connected and recognised as a SCSI device?)`,
  });
}

// =============================================================================
// Public session API consumed by the dispatcher
// =============================================================================

/** Options accepted by {@link openLinuxScsiSyscall}. */
export interface LinuxSessionOptions {
  /** Per-VPD-read timeout in milliseconds. */
  timeoutMs: number;
  /**
   * Override the resolved device path. Skips sysfs lookup. Primarily for
   * tests and for callers that already know the `/dev/sgN` path.
   */
  devicePath?: string;
}

/** Handle to an open SCSI session. Caller must invoke `close()`. */
export interface LinuxScsiSession {
  /** Issue a single VPD INQUIRY against the open device. */
  syscall: ScsiSyscall;
  /** Close the underlying file descriptor. */
  close: () => void;
}

/**
 * Open a SCSI session against the device matching `fp` and return a
 * {@link ScsiSyscall} bound to the open file descriptor. The caller (the
 * dispatcher in `index.ts`) drives the syscall through the shared
 * VPD-pages loop and then invokes `close()`.
 */
export async function openLinuxScsiSyscall(
  fp: UsbFingerprint,
  opts: LinuxSessionOptions
): Promise<LinuxScsiSession> {
  const devicePath = opts.devicePath ?? resolveSgPathFromFingerprint(fp);

  let fd: number;
  try {
    fd = fs.openSync(devicePath, fs.constants.O_RDONLY);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const errno = typeof e.errno === 'number' ? Math.abs(e.errno) : 0;
    const kind =
      e.code === 'EACCES'
        ? 'eacces'
        : e.code === 'EPERM'
          ? 'eperm'
          : e.code === 'ENOENT'
            ? 'enoent'
            : e.code === 'EBUSY'
              ? 'ebusy'
              : 'errno';
    throw new ScsiError({
      kind,
      devicePath,
      errno,
      syscall: 'open',
      cause: err,
    });
  }

  const binding = await loadLinuxBinding();
  const syscall = makeSgIoSyscall({
    devicePath,
    fd,
    timeoutMs: opts.timeoutMs,
    binding,
  });

  return {
    syscall,
    close: () => {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    },
  };
}

// =============================================================================
// SG_IO syscall factory — the only place that touches koffi at runtime.
// =============================================================================

/** Inputs for {@link makeSgIoSyscall}. Exported for tests. */
export interface SgIoSyscallParams {
  devicePath: string;
  fd: number;
  timeoutMs: number;
  binding: LinuxBinding;
}

/**
 * Build a {@link ScsiSyscall} closure that issues SG_IO over the given fd.
 * Tests inject a stub `binding` (and an arbitrary fd) to exercise the
 * sense-data, errno, and timeout branches without touching the kernel.
 */
export function makeSgIoSyscall(params: SgIoSyscallParams): ScsiSyscall {
  const { devicePath, fd, timeoutMs, binding } = params;
  return (page: number, allocLen: number): ScsiSyscallResult => {
    const cdb = Buffer.from(buildVpdCdb(page, allocLen));
    const data = Buffer.alloc(allocLen);
    const sense = Buffer.alloc(32);

    const hdr: SgIoHdr = {
      interface_id: SG_INTERFACE_ID,
      dxfer_direction: SG_DXFER_FROM_DEV,
      cmd_len: cdb.length,
      mx_sb_len: sense.length,
      iovec_count: 0,
      dxfer_len: data.length,
      dxferp: data,
      cmdp: cdb,
      sbp: sense,
      timeout: timeoutMs,
      flags: 0,
      pack_id: 0,
      usr_ptr: null,
      status: 0,
      masked_status: 0,
      msg_status: 0,
      sb_len_wr: 0,
      host_status: 0,
      driver_status: 0,
      resid: 0,
      duration: 0,
      info: 0,
    };

    const rc = binding.ioctl(fd, SG_IO, hdr);
    if (rc !== 0) {
      const errno = binding.errno();
      return { ok: false, kind: 'errno', errno, syscall: `ioctl(SG_IO) on ${devicePath}` };
    }
    // sg driver: driver_status == 0x06 = SG_ERR_DRIVER_TIMEOUT.
    if (hdr.driver_status === 0x06) {
      return { ok: false, kind: 'timeout' };
    }
    if (hdr.status === SCSI_STATUS_CHECK_CONDITION || hdr.sb_len_wr > 0) {
      return {
        ok: false,
        kind: 'check-condition',
        sense: new Uint8Array(sense.buffer, sense.byteOffset, hdr.sb_len_wr || sense.length),
        status: hdr.status,
      };
    }
    if (hdr.status !== SCSI_STATUS_GOOD || hdr.host_status !== 0 || hdr.driver_status !== 0) {
      return {
        ok: false,
        kind: 'other',
        message: `SG_IO non-success: status=${hdr.status} host=${hdr.host_status} driver=${hdr.driver_status}`,
      };
    }
    return { ok: true, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
  };
}

// Re-export for diagnostics and tests; keeps the public surface explicit.
export { errnoToKind };
