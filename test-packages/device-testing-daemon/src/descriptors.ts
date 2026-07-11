/**
 * FunctionFS descriptor + strings table byte-packing.
 *
 * The kernel hand-off for FunctionFS is two consecutive writes to ep0:
 *
 *   1. Descriptor table — magic `FUNCTIONFS_DESCRIPTORS_MAGIC_V2 = 0x3`,
 *      `usb_functionfs_descs_head_v2`, then per-speed descriptor lists.
 *   2. Strings table — magic `FUNCTIONFS_STRINGS_MAGIC = 0x2`,
 *      `usb_functionfs_strings_head`, then per-language strings.
 *
 * The daemon only needs ep0 to serve the iPod SysInfoExtended vendor
 * read. The kernel however refuses a FunctionFS instance with zero
 * endpoints, so we declare a single bulk-IN endpoint that the daemon
 * never opens. Hosts that hit it will see a stall — fine for a test
 * harness whose only protocol is the ep0 vendor read.
 *
 * Layout is little-endian throughout. Field offsets match the structs
 * in `<linux/usb/functionfs.h>` and `<linux/usb/ch9.h>`. Pure module —
 * no I/O — so the layout is verified by `__tests__/descriptors.test.ts`
 * on macOS without any kernel.
 *
 * @see Documentation/usb/functionfs.rst (kernel)
 * @see protocol.ts for the SETUP-packet shape the daemon answers
 * @module
 */

// ---------------------------------------------------------------------------
// Magic + flags
// ---------------------------------------------------------------------------

export const FUNCTIONFS_DESCRIPTORS_MAGIC_V2 = 0x00000003;
export const FUNCTIONFS_STRINGS_MAGIC = 0x00000002;

/** `enum functionfs_flags`. We declare FS + HS speed tables. */
export const FUNCTIONFS_HAS_FS_DESC = 1 << 0;
export const FUNCTIONFS_HAS_HS_DESC = 1 << 1;
/**
 * `FUNCTIONFS_ALL_CTRL_RECIP` (`enum functionfs_flags`, bit 6).
 *
 * Without this flag the kernel's `ffs_func_req_match()` only forwards
 * control requests whose recipient is this function's INTERFACE (or one of
 * its endpoints) to ep0 — DEVICE-recipient vendor requests are STALLed by
 * the composite core before userspace ever sees a SETUP event.
 *
 * The real iPod SysInfoExtended vendor read uses `bmRequestType=0xC0`
 * (direction IN, type VENDOR, recipient **DEVICE**). To route that to ep0 so
 * `protocol.ts` can answer it, the function must set this flag; then
 * `ffs_func_req_match()`'s recipient=DEVICE path returns
 * `user_flags & FUNCTIONFS_ALL_CTRL_RECIP`, claiming the request.
 */
export const FUNCTIONFS_ALL_CTRL_RECIP = 1 << 6;

// ---------------------------------------------------------------------------
// USB descriptor types (`<linux/usb/ch9.h>` — USB_DT_*)
// ---------------------------------------------------------------------------

const USB_DT_INTERFACE = 0x04;
const USB_DT_ENDPOINT = 0x05;

const INTERFACE_DESC_LEN = 9;
const ENDPOINT_DESC_LEN = 7;
const HEAD_V2_LEN = 20; // magic + length + flags + fs_count + hs_count
const STRINGS_HEAD_LEN = 16;

/** Full-speed bulk endpoint max packet size (USB 2.0 spec ceiling). */
const FS_BULK_MAX_PACKET = 0x40;
/** High-speed bulk endpoint max packet size (USB 2.0 spec ceiling). */
const HS_BULK_MAX_PACKET = 0x200;

/** Vendor-specific interface class — matches what real iPods advertise. */
const VENDOR_INTERFACE_CLASS = 0xff;

/** Single bulk-IN endpoint at ep1. The daemon never opens it; hosts get a stall. */
const EP1_IN = 0x81;
/** Bulk-transfer endpoint attribute. */
const ENDPOINT_BULK = 0x02;

// ---------------------------------------------------------------------------
// Descriptor table
// ---------------------------------------------------------------------------

/**
 * Build the FunctionFS descriptor table buffer (one ep0 write).
 *
 * Layout:
 *
 * ```
 *   offset  size  field
 *   0       4     magic                                = MAGIC_V2 (0x3)
 *   4       4     length                               = total bytes
 *   8       4     flags                                = HAS_FS | HAS_HS | ALL_CTRL_RECIP (0x43)
 *   12      4     fs_count                             = 2 (interface + ep)
 *   16      4     hs_count                             = 2 (interface + ep)
 *   20      9     FS interface descriptor              (bLength=9, USB_DT_INTERFACE)
 *   29      7     FS endpoint descriptor               (bLength=7, USB_DT_ENDPOINT, IN, bulk)
 *   36      9     HS interface descriptor              (same shape as FS)
 *   45      7     HS endpoint descriptor               (wMaxPacketSize=0x200)
 *   ────
 *   52 bytes total
 * ```
 *
 * The two endpoints are the *same logical endpoint* described at FS and HS
 * speeds — that's how `usb_functionfs_descs_head_v2` works, with one
 * descriptor table per speed.
 */
export function buildDescriptorsBuffer(): Uint8Array {
  const totalLength = HEAD_V2_LEN + 2 * (INTERFACE_DESC_LEN + ENDPOINT_DESC_LEN); // 20 + 32 = 52
  const buf = new Uint8Array(totalLength);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Head
  view.setUint32(0, FUNCTIONFS_DESCRIPTORS_MAGIC_V2, true);
  view.setUint32(4, totalLength, true);
  view.setUint32(
    8,
    FUNCTIONFS_HAS_FS_DESC | FUNCTIONFS_HAS_HS_DESC | FUNCTIONFS_ALL_CTRL_RECIP,
    true
  );
  // fs_count + hs_count = number of descriptors per speed, NOT byte counts
  view.setUint32(12, 2, true);
  view.setUint32(16, 2, true);

  let cursor = HEAD_V2_LEN;
  cursor = writeInterfaceDescriptor(view, cursor);
  cursor = writeEndpointDescriptor(view, cursor, FS_BULK_MAX_PACKET);
  cursor = writeInterfaceDescriptor(view, cursor);
  cursor = writeEndpointDescriptor(view, cursor, HS_BULK_MAX_PACKET);

  if (cursor !== totalLength) {
    throw new Error(
      `buildDescriptorsBuffer: layout error — wrote ${cursor} bytes, expected ${totalLength}`
    );
  }

  return buf;
}

/**
 * Build the FunctionFS strings table buffer (one ep0 write).
 *
 * We declare zero strings (`iInterface = 0` in the descriptors above), so
 * the table is just the 16-byte head with `str_count=0` and `lang_count=0`
 * — the kernel's documented "empty strings table" path
 * (`drivers/usb/gadget/function/f_fs.c` `__ffs_data_got_strings`).
 *
 * Layout:
 *
 * ```
 *   offset  size  field
 *   0       4     magic       = STRINGS_MAGIC (0x2)
 *   4       4     length      = 16
 *   8       4     str_count   = 0
 *   12      4     lang_count  = 0
 * ```
 */
export function buildStringsBuffer(): Uint8Array {
  const buf = new Uint8Array(STRINGS_HEAD_LEN);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(0, FUNCTIONFS_STRINGS_MAGIC, true);
  view.setUint32(4, STRINGS_HEAD_LEN, true);
  view.setUint32(8, 0, true); // str_count
  view.setUint32(12, 0, true); // lang_count
  return buf;
}

// ---------------------------------------------------------------------------
// Private writers
// ---------------------------------------------------------------------------

function writeInterfaceDescriptor(view: DataView, offset: number): number {
  view.setUint8(offset + 0, INTERFACE_DESC_LEN); // bLength
  view.setUint8(offset + 1, USB_DT_INTERFACE); // bDescriptorType
  view.setUint8(offset + 2, 0); // bInterfaceNumber
  view.setUint8(offset + 3, 0); // bAlternateSetting
  view.setUint8(offset + 4, 1); // bNumEndpoints
  view.setUint8(offset + 5, VENDOR_INTERFACE_CLASS); // bInterfaceClass
  view.setUint8(offset + 6, 0); // bInterfaceSubClass
  view.setUint8(offset + 7, 0); // bInterfaceProtocol
  view.setUint8(offset + 8, 0); // iInterface (no string)
  return offset + INTERFACE_DESC_LEN;
}

function writeEndpointDescriptor(view: DataView, offset: number, maxPacketSize: number): number {
  view.setUint8(offset + 0, ENDPOINT_DESC_LEN); // bLength
  view.setUint8(offset + 1, USB_DT_ENDPOINT); // bDescriptorType
  view.setUint8(offset + 2, EP1_IN); // bEndpointAddress (IN, ep1)
  view.setUint8(offset + 3, ENDPOINT_BULK); // bmAttributes
  view.setUint16(offset + 4, maxPacketSize, true); // wMaxPacketSize (LE)
  view.setUint8(offset + 6, 0); // bInterval
  return offset + ENDPOINT_DESC_LEN;
}

// ---------------------------------------------------------------------------
// Layout constants (re-exported for tests)
// ---------------------------------------------------------------------------

export const DESCRIPTOR_LAYOUT = {
  HEAD_V2_LEN,
  STRINGS_HEAD_LEN,
  INTERFACE_DESC_LEN,
  ENDPOINT_DESC_LEN,
  FS_BULK_MAX_PACKET,
  HS_BULK_MAX_PACKET,
  TOTAL_DESCRIPTORS_LEN: HEAD_V2_LEN + 2 * (INTERFACE_DESC_LEN + ENDPOINT_DESC_LEN),
} as const;
