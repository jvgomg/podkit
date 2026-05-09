/**
 * USB inquiry — TypeScript-native libusb-1.0 implementation via the
 * `usb` npm package (which bundles its own prebuilt libusb).
 *
 * ## Protocol
 *
 * The Apple iPod SysInfoExtended payload is delivered via a vendor-specific
 * USB control transfer, iterated as fixed-size pages until a short read
 * terminates the stream. Verified against libgpod 0.8.3 source
 * (`tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_usb.c`):
 *
 * ```c
 * libusb_control_transfer(handle,
 *   LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE,
 *   0x40, value, index, data, len, 0)
 * ```
 *
 * Decoded:
 * - `bmRequestType = 0xC0` (IN | VENDOR | DEVICE: 0x80 | 0x40 | 0x00)
 * - `bRequest      = 0x40`
 * - `wValue        = 0x02` (SysInfoExtended page-iteration command)
 * - `wIndex        = page` (0, 1, 2, … iterating)
 * - `wLength       = 0x1000` (4096-byte buffer)
 * - `timeout       = 0` (libusb infinite — we expose `timeoutMs` instead)
 *
 * No interface claim is required — vendor control transfers on the default
 * control endpoint do not need an active interface, and libgpod's reference
 * implementation does not claim one either.
 *
 * @module
 */

import type { UsbFingerprint } from '@podkit/device-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IN | VENDOR | DEVICE — the bmRequestType byte for SysInfoExtended reads. */
const BM_REQUEST_TYPE = 0xc0;
/** Apple vendor request opcode for the SysInfoExtended sequence. */
const B_REQUEST = 0x40;
/** Vendor-defined "fetch SysInfoExtended page" command for wValue. */
const W_VALUE = 0x02;
/** Per-page allocation length. Matches libgpod (0x1000 = 4096 bytes). */
const PAGE_SIZE = 0x1000;
/** Hard cap on page iteration to match libgpod's 0xffff loop bound. */
const MAX_PAGES = 0xffff;
/** Default per-control-transfer timeout. 0 = libusb infinite. */
const DEFAULT_TIMEOUT_MS = 0;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type UsbInquiryErrorKind =
  | 'libusb-not-loadable'
  | 'init-failed'
  | 'device-not-found'
  | 'open-failed'
  | 'control-transfer-failed'
  | 'empty-response';

export class UsbInquiryError extends Error {
  readonly kind: UsbInquiryErrorKind;
  /**
   * libusb transfer status code (positive `LIBUSB_TRANSFER_*` enum value),
   * when sourced from a control-transfer error from the `usb` npm package.
   */
  readonly libusbStatus?: number;

  constructor(opts: {
    kind: UsbInquiryErrorKind;
    message: string;
    libusbStatus?: number;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = 'UsbInquiryError';
    this.kind = opts.kind;
    if (opts.libusbStatus !== undefined) this.libusbStatus = opts.libusbStatus;
    if (opts.cause !== undefined) (this as unknown as { cause?: unknown }).cause = opts.cause;
  }
}

// ---------------------------------------------------------------------------
// Dependency-injection interface
// ---------------------------------------------------------------------------

/**
 * Opened-device handle. Returned by {@link UsbBinding.withOpenDevice} for the
 * lifetime of the supplied callback. Implementations guarantee the device is
 * closed before `withOpenDevice` resolves, regardless of how the callback
 * exits (normal return or throw).
 */
export interface UsbDeviceHandle {
  /**
   * Issue a control transfer. Returns the bytes received (length 0..wLength
   * for IN transfers).
   *
   * Implementations throw {@link UsbInquiryError} with
   * `kind: 'control-transfer-failed'` (and `libusbStatus` set) on libusb error.
   */
  controlTransfer(
    bmRequestType: number,
    bRequest: number,
    wValue: number,
    wIndex: number,
    wLength: number,
    timeoutMs: number
  ): Promise<Uint8Array>;
}

/**
 * USB transport used by {@link readUsbInquiry}. Exposed as an interface so
 * tests can inject a fake without loading a real libusb.
 */
export interface UsbBinding {
  /**
   * Locate the device matching `(bus, devnum)`, open it, run `fn`, then
   * close it — even if `fn` throws.
   *
   * Throws {@link UsbInquiryError} with:
   * - `kind: 'device-not-found'` if no device matches
   * - `kind: 'open-failed'` if libusb_open fails
   * - `kind: 'init-failed'` if the underlying USB stack fails to initialise
   */
  withOpenDevice<T>(
    bus: number,
    devnum: number,
    fn: (handle: UsbDeviceHandle) => Promise<T>
  ): Promise<T>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UsbReadOptions {
  /**
   * Per-control-transfer timeout in milliseconds. Forwarded to libusb's
   * `libusb_control_transfer` `timeout` parameter. Defaults to 0
   * (infinite — matches libgpod).
   */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// usb npm loader (lazy)
// ---------------------------------------------------------------------------

let cachedBinding: UsbBinding | null = null;

/**
 * Result of a successful USB binding load. `libName` identifies the
 * underlying provider for diagnostics (e.g. `"usb npm 2.x"`).
 */
export interface UsbLoadResult {
  binding: UsbBinding;
  libName: string;
}

/**
 * Minimal subset of the `usb` npm package surface we use. Declared locally so
 * we don't take a hard type dep on the package — the actual import is
 * dynamic and tolerant of load failures (Bun --compile path, dev machines
 * without a prebuilt binary, etc.).
 */
interface UsbDevice {
  busNumber: number;
  deviceAddress: number;
  open(defaultConfig?: boolean): void;
  close(): void;
  controlTransfer(
    bmRequestType: number,
    bRequest: number,
    wValue: number,
    wIndex: number,
    dataOrLength: Buffer | number,
    cb: (err: (Error & { errno?: number }) | undefined, data?: Buffer) => void
  ): void;
  timeout?: number;
}

interface UsbModule {
  getDeviceList(): UsbDevice[];
}

/**
 * Attempt to load the `usb` npm package. Successful loads are cached
 * process-wide so repeated calls don't pay the dynamic import cost.
 *
 * Throws {@link UsbInquiryError} with `kind: 'libusb-not-loadable'` if the
 * package can't be imported (missing prebuild, unsupported platform, etc.).
 */
export async function loadUsb(): Promise<UsbLoadResult> {
  if (cachedBinding) {
    return { binding: cachedBinding, libName: 'usb npm' };
  }

  let usb: UsbModule;
  try {
    const mod = (await import('usb')) as unknown as UsbModule & { default?: UsbModule };
    usb = mod.default ?? mod;
  } catch (err) {
    throw new UsbInquiryError({
      kind: 'libusb-not-loadable',
      message: `usb npm package could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
      cause: err,
    });
  }

  cachedBinding = makeUsbBinding(usb);
  return { binding: cachedBinding, libName: 'usb npm' };
}

function makeUsbBinding(usb: UsbModule): UsbBinding {
  return {
    async withOpenDevice<T>(
      bus: number,
      devnum: number,
      fn: (handle: UsbDeviceHandle) => Promise<T>
    ): Promise<T> {
      let devices: UsbDevice[];
      try {
        devices = usb.getDeviceList();
      } catch (err) {
        throw new UsbInquiryError({
          kind: 'init-failed',
          message: `usb.getDeviceList failed: ${err instanceof Error ? err.message : String(err)}`,
          cause: err,
        });
      }

      const device = devices.find((d) => d.busNumber === bus && d.deviceAddress === devnum);
      if (!device) {
        throw new UsbInquiryError({
          kind: 'device-not-found',
          message: `no USB device matched bus=${bus} devnum=${devnum}`,
        });
      }

      try {
        device.open();
      } catch (err) {
        throw new UsbInquiryError({
          kind: 'open-failed',
          message: `device.open failed: ${err instanceof Error ? err.message : String(err)}`,
          libusbStatus: extractLibusbStatus(err),
          cause: err,
        });
      }

      try {
        const handle: UsbDeviceHandle = {
          controlTransfer: (bmRequestType, bRequest, wValue, wIndex, wLength, timeoutMs) =>
            promisifyControlTransfer(
              device,
              bmRequestType,
              bRequest,
              wValue,
              wIndex,
              wLength,
              timeoutMs
            ),
        };
        return await fn(handle);
      } finally {
        try {
          device.close();
        } catch {
          // Best-effort close; don't mask the original outcome.
        }
      }
    },
  };
}

function promisifyControlTransfer(
  device: UsbDevice,
  bmRequestType: number,
  bRequest: number,
  wValue: number,
  wIndex: number,
  wLength: number,
  timeoutMs: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // The `usb` npm legacy controlTransfer signature does not accept a
    // per-call timeout — it uses the device's `timeout` property. Set it
    // directly each call so callers can vary it without coupling.
    device.timeout = timeoutMs;
    device.controlTransfer(bmRequestType, bRequest, wValue, wIndex, wLength, (err, data) => {
      if (err) {
        reject(
          new UsbInquiryError({
            kind: 'control-transfer-failed',
            message: `controlTransfer failed on page ${wIndex}: ${err.message}`,
            libusbStatus: extractLibusbStatus(err),
            cause: err,
          })
        );
        return;
      }
      // For IN transfers (bmRequestType MSB set), `data` is a Buffer of the
      // bytes read. Normalise to Uint8Array for callers that don't want a
      // Node Buffer leaking out of this module.
      if (!data) {
        resolve(new Uint8Array(0));
        return;
      }
      resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    });
  });
}

/**
 * Extract a `LIBUSB_TRANSFER_*` status code from an Error thrown by the
 * `usb` npm package. Returns `undefined` when the error doesn't carry one.
 */
function extractLibusbStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'errno' in err) {
    const errno = (err as { errno?: unknown }).errno;
    if (typeof errno === 'number') return errno;
  }
  return undefined;
}

/** Reset the loader cache. Test-only. */
export function _resetUsbCacheForTests(): void {
  cachedBinding = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read SysInfoExtended XML from an iPod via USB vendor control transfer.
 *
 * Iterates pages 0..N until a short read terminates the stream, mirroring
 * libgpod 0.8.3's `itdb_read_sysinfo_extended_from_usb`.
 *
 * @param fp - USB fingerprint of the target device (bus + devnum).
 * @param opts - Optional read options (see {@link UsbReadOptions}).
 * @param _binding - Injectable {@link UsbBinding} for tests. When omitted,
 *   the `usb` npm package is loaded.
 * @returns Concatenated raw bytes of the SysInfoExtended XML payload.
 */
export async function readUsbInquiry(
  fp: UsbFingerprint,
  opts?: UsbReadOptions,
  _binding?: UsbBinding
): Promise<Uint8Array> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const binding = _binding ?? (await loadUsb()).binding;

  if (fp.bus === undefined || fp.devnum === undefined) {
    throw new UsbInquiryError({
      kind: 'device-not-found',
      message: 'USB bus/devnum not available in fingerprint — cannot perform USB inquiry',
    });
  }

  return binding.withOpenDevice(fp.bus, fp.devnum, async (handle) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i < MAX_PAGES; i++) {
      const chunk = await handle.controlTransfer(
        BM_REQUEST_TYPE,
        B_REQUEST,
        W_VALUE,
        i,
        PAGE_SIZE,
        timeoutMs
      );
      chunks.push(chunk);
      total += chunk.length;
      if (chunk.length !== PAGE_SIZE) {
        // Short read = end of stream (matches libgpod semantics).
        break;
      }
    }

    if (total === 0) {
      throw new UsbInquiryError({
        kind: 'empty-response',
        message: `USB inquiry returned no data for bus=${fp.bus} devnum=${fp.devnum}`,
      });
    }

    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  });
}
