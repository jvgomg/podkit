/**
 * USB inquiry — TypeScript-native libusb-1.0 FFI implementation (P2).
 *
 * Replaces the P1 transitional shim that delegated to `@podkit/libgpod-node`.
 * After P2 the binding's USB code is removed entirely (TASK-293.04).
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
 * ## Loader
 *
 * Tries the following library names in order until `koffi.load` succeeds:
 * - macOS: `libusb-1.0.0.dylib`, `libusb-1.0.dylib`,
 *          `/opt/homebrew/lib/libusb-1.0.0.dylib`,
 *          `/usr/local/lib/libusb-1.0.0.dylib`
 * - Linux: `libusb-1.0.so.0`, `libusb-1.0.so`
 *
 * If none load, throws an error with `kind: 'libusb-not-loadable'` to
 * mirror the SCSI EACCES UX surface.
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

/** Candidate dynamic library names tried in order by the loader. */
const LIBUSB_CANDIDATES_DARWIN: readonly string[] = [
  'libusb-1.0.0.dylib',
  'libusb-1.0.dylib',
  '/opt/homebrew/lib/libusb-1.0.0.dylib',
  '/usr/local/lib/libusb-1.0.0.dylib',
];
const LIBUSB_CANDIDATES_LINUX: readonly string[] = ['libusb-1.0.so.0', 'libusb-1.0.so'];

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
  /** Negative libusb error code, when sourced from a libusb call. */
  readonly libusbCode?: number;

  constructor(opts: {
    kind: UsbInquiryErrorKind;
    message: string;
    libusbCode?: number;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = 'UsbInquiryError';
    this.kind = opts.kind;
    if (opts.libusbCode !== undefined) this.libusbCode = opts.libusbCode;
    if (opts.cause !== undefined) (this as unknown as { cause?: unknown }).cause = opts.cause;
  }
}

// ---------------------------------------------------------------------------
// Dependency-injection interface for libusb-1.0
// ---------------------------------------------------------------------------

/**
 * Pointer-like opaque value returned by koffi (Buffer at runtime, but
 * conceptually opaque). Tests treat these as nominal handles.
 */
export type LibusbPtr = unknown;

/**
 * Subset of libusb-1.0 used by this module. Exposed as an interface so
 * tests can inject fakes without loading real libusb.
 */
export interface LibusbBinding {
  /** Allocates a context. Returns 0 on success, negative on error. */
  init(ctxOut: Buffer): number;
  /** Releases a context. */
  exit(ctx: LibusbPtr): void;

  /**
   * Populates `listOut` with a pointer to an allocated device list and
   * returns the device count (>= 0) or a negative libusb error.
   */
  get_device_list(ctx: LibusbPtr, listOut: Buffer): number;
  /** Frees the device list. `unrefDevices` non-zero unrefs each device. */
  free_device_list(list: LibusbPtr, unrefDevices: number): void;

  /** Returns the bus number for a device. */
  get_bus_number(dev: LibusbPtr): number;
  /** Returns the device address on its bus. */
  get_device_address(dev: LibusbPtr): number;

  /** Increments a device refcount so it survives `free_device_list`. */
  ref_device(dev: LibusbPtr): LibusbPtr;
  /** Decrements a device refcount. */
  unref_device(dev: LibusbPtr): void;

  /**
   * Opens a device, populating `handleOut`. Returns 0 on success or a
   * negative libusb error.
   */
  open(dev: LibusbPtr, handleOut: Buffer): number;
  /** Closes a device handle. */
  close(handle: LibusbPtr): void;

  /**
   * Issues a synchronous control transfer.
   * Returns the number of bytes transferred (>= 0) or a negative libusb
   * error.
   */
  control_transfer(
    handle: LibusbPtr,
    bmRequestType: number,
    bRequest: number,
    wValue: number,
    wIndex: number,
    data: Buffer,
    wLength: number,
    timeoutMs: number
  ): number;

  /**
   * Read a pointer's bytes into a Uint8Array. Used to extract a single
   * `libusb_device *` from the head of the device list. Implementations
   * delegate to `koffi.decode`.
   */
  decodeDeviceAt(list: LibusbPtr, index: number): LibusbPtr;
  /** Read the populated context pointer back from the `init` out-buffer. */
  decodePointer(buf: Buffer): LibusbPtr;
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
// koffi loader (lazy)
// ---------------------------------------------------------------------------

let cachedBinding: LibusbBinding | null = null;
let cachedLibName: string | null = null;

/**
 * Result of a successful libusb load — the binding plus the resolved
 * library file (handy for diagnostics).
 */
export interface LibusbLoadResult {
  binding: LibusbBinding;
  libName: string;
}

/**
 * Attempt to load libusb-1.0 via koffi. Tries platform-appropriate
 * candidate names in order. Throws `UsbInquiryError` with kind
 * `'libusb-not-loadable'` if all candidates fail.
 *
 * Successful loads are cached process-wide so repeated calls don't pay
 * the koffi.load cost or the candidate sweep.
 */
export async function loadLibusb(): Promise<LibusbLoadResult> {
  if (cachedBinding && cachedLibName) {
    return { binding: cachedBinding, libName: cachedLibName };
  }

  const koffiMod = (await import('koffi')) as unknown as {
    default?: typeof import('koffi');
  } & typeof import('koffi');
  const koffi = koffiMod.default ?? koffiMod;

  const candidates =
    process.platform === 'darwin'
      ? LIBUSB_CANDIDATES_DARWIN
      : process.platform === 'linux'
        ? LIBUSB_CANDIDATES_LINUX
        : [];

  let lib: ReturnType<typeof koffi.load> | null = null;
  let resolved: string | null = null;
  const errors: string[] = [];
  for (const name of candidates) {
    try {
      lib = koffi.load(name);
      resolved = name;
      break;
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!lib || !resolved) {
    throw new UsbInquiryError({
      kind: 'libusb-not-loadable',
      message:
        `libusb-1.0 could not be loaded — tried ${candidates.length} candidate(s): ` +
        errors.join('; '),
    });
  }

  // libusb-1.0 ABI declarations.
  // libusb_context, libusb_device, libusb_device_handle are all opaque pointers.
  const init = lib.func('int libusb_init(_Out_ void **ctx)');
  const exitFn = lib.func('void libusb_exit(void *ctx)');
  const get_device_list = lib.func('intptr_t libusb_get_device_list(void *ctx, _Out_ void **list)');
  const free_device_list = lib.func('void libusb_free_device_list(void *list, int unref_devices)');
  const get_bus_number = lib.func('uint8 libusb_get_bus_number(void *dev)');
  const get_device_address = lib.func('uint8 libusb_get_device_address(void *dev)');
  const ref_device = lib.func('void *libusb_ref_device(void *dev)');
  const unref_device = lib.func('void libusb_unref_device(void *dev)');
  const open = lib.func('int libusb_open(void *dev, _Out_ void **handle)');
  const closeFn = lib.func('void libusb_close(void *handle)');
  // libusb_control_transfer returns the number of bytes transferred (or negative error).
  // Signature per <libusb.h>:
  //   int libusb_control_transfer(libusb_device_handle *dev_handle,
  //     uint8_t bmRequestType, uint8_t bRequest, uint16_t wValue, uint16_t wIndex,
  //     unsigned char *data, uint16_t wLength, unsigned int timeout)
  const control_transfer = lib.func(
    'int libusb_control_transfer(void *handle, uint8 bmRequestType, uint8 bRequest, ' +
      'uint16 wValue, uint16 wIndex, _Inout_ uint8 *data, uint16 wLength, uint32 timeout)'
  );

  cachedBinding = {
    init: (ctxOut) => init(ctxOut),
    exit: (ctx) => exitFn(ctx),
    get_device_list: (ctx, listOut) => Number(get_device_list(ctx, listOut)),
    free_device_list: (list, unref) => free_device_list(list, unref),
    get_bus_number: (dev) => get_bus_number(dev),
    get_device_address: (dev) => get_device_address(dev),
    ref_device: (dev) => ref_device(dev),
    unref_device: (dev) => unref_device(dev),
    open: (dev, handleOut) => open(dev, handleOut),
    close: (handle) => closeFn(handle),
    control_transfer: (handle, brt, br, wv, wi, data, wl, t) =>
      control_transfer(handle, brt, br, wv, wi, data, wl, t),
    decodeDeviceAt: (list, index) => {
      // The list is a NULL-terminated array of `libusb_device *`. Decode the
      // pointer at `list + index * sizeof(void*)` as a void pointer.
      const ptrSize = 8; // koffi runs on 64-bit Bun — keep it simple.
      // koffi.decode supports (pointer, offset, type) for offset reads.
      return koffi.decode(list as Buffer, index * ptrSize, 'void *');
    },
    decodePointer: (buf) => koffi.decode(buf, 0, 'void *'),
  };
  cachedLibName = resolved;
  return { binding: cachedBinding, libName: cachedLibName };
}

/** Reset the loader cache. Test-only. */
export function _resetLibusbCacheForTests(): void {
  cachedBinding = null;
  cachedLibName = null;
}

// ---------------------------------------------------------------------------
// Lifecycle helpers — every acquire is paired with a release in finally
// ---------------------------------------------------------------------------

/**
 * Run `fn` inside a `libusb_init` / `libusb_exit` envelope. Always
 * exits the context, even on throw.
 */
async function withLibusbContext<T>(
  binding: LibusbBinding,
  fn: (ctx: LibusbPtr) => Promise<T>
): Promise<T> {
  const ctxOut = Buffer.alloc(8);
  const rc = binding.init(ctxOut);
  if (rc !== 0) {
    throw new UsbInquiryError({
      kind: 'init-failed',
      message: `libusb_init failed with code ${rc}`,
      libusbCode: rc,
    });
  }
  const ctx = binding.decodePointer(ctxOut);
  try {
    return await fn(ctx);
  } finally {
    binding.exit(ctx);
  }
}

/**
 * Resolve a `libusb_device *` matching `(bus, devnum)`. The returned
 * device is ref'd before the list is freed; caller must `unref_device`
 * when done.
 */
function findDeviceByBusDev(
  binding: LibusbBinding,
  ctx: LibusbPtr,
  bus: number,
  devnum: number
): LibusbPtr {
  const listOut = Buffer.alloc(8);
  const count = binding.get_device_list(ctx, listOut);
  if (count < 0) {
    throw new UsbInquiryError({
      kind: 'device-not-found',
      message: `libusb_get_device_list failed with code ${count}`,
      libusbCode: count,
    });
  }
  const list = binding.decodePointer(listOut);
  let matched: LibusbPtr | null = null;
  try {
    for (let i = 0; i < count; i++) {
      const dev = binding.decodeDeviceAt(list, i);
      if (binding.get_bus_number(dev) === bus && binding.get_device_address(dev) === devnum) {
        matched = binding.ref_device(dev);
        break;
      }
    }
  } finally {
    binding.free_device_list(list, 1);
  }
  if (matched === null) {
    throw new UsbInquiryError({
      kind: 'device-not-found',
      message: `no USB device matched bus=${bus} devnum=${devnum}`,
    });
  }
  return matched;
}

/**
 * Run `fn` with an open device handle, releasing both the handle and the
 * device ref on the way out (even on throw).
 */
async function withDeviceHandle<T>(
  binding: LibusbBinding,
  dev: LibusbPtr,
  fn: (handle: LibusbPtr) => Promise<T>
): Promise<T> {
  const handleOut = Buffer.alloc(8);
  const rc = binding.open(dev, handleOut);
  if (rc !== 0) {
    binding.unref_device(dev);
    throw new UsbInquiryError({
      kind: 'open-failed',
      message: `libusb_open failed with code ${rc}`,
      libusbCode: rc,
    });
  }
  const handle = binding.decodePointer(handleOut);
  try {
    return await fn(handle);
  } finally {
    binding.close(handle);
    binding.unref_device(dev);
  }
}

/**
 * Issue a single SysInfoExtended page request. Returns the bytes that
 * came back (length 0..PAGE_SIZE).
 */
function readVendorPage(
  binding: LibusbBinding,
  handle: LibusbPtr,
  page: number,
  timeoutMs: number
): Uint8Array {
  const data = Buffer.alloc(PAGE_SIZE);
  const transferred = binding.control_transfer(
    handle,
    BM_REQUEST_TYPE,
    B_REQUEST,
    W_VALUE,
    page,
    data,
    PAGE_SIZE,
    timeoutMs
  );
  if (transferred < 0) {
    throw new UsbInquiryError({
      kind: 'control-transfer-failed',
      message: `libusb_control_transfer failed on page ${page} with code ${transferred}`,
      libusbCode: transferred,
    });
  }
  return new Uint8Array(data.buffer, data.byteOffset, transferred);
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
 * @param _binding - Injectable {@link LibusbBinding} for tests. When
 *   omitted, libusb is loaded via koffi.
 * @returns Concatenated raw bytes of the SysInfoExtended XML payload.
 */
export async function readUsbInquiry(
  fp: UsbFingerprint,
  opts?: UsbReadOptions,
  _binding?: LibusbBinding
): Promise<Uint8Array> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const binding = _binding ?? (await loadLibusb()).binding;

  if (fp.bus === undefined || fp.devnum === undefined) {
    throw new UsbInquiryError({
      kind: 'device-not-found',
      message: 'USB bus/devnum not available in fingerprint — cannot perform USB inquiry',
    });
  }

  return withLibusbContext(binding, async (ctx) => {
    const dev = findDeviceByBusDev(binding, ctx, fp.bus!, fp.devnum!);
    return withDeviceHandle(binding, dev, async (handle) => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (let i = 0; i < MAX_PAGES; i++) {
        const chunk = readVendorPage(binding, handle, i, timeoutMs);
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
  });
}
