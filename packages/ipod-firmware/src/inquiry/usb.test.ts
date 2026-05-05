/**
 * Unit tests for the libusb FFI USB inquiry implementation (TASK-293.01).
 *
 * Tests inject a fake `LibusbBinding` so they exercise the protocol logic
 * (page iteration, short-read termination, control-transfer parameters,
 * cleanup discipline, error propagation) without loading real libusb.
 */

import { describe, expect, it } from 'bun:test';
import { readUsbInquiry, UsbInquiryError } from './usb';
import type { LibusbBinding, LibusbPtr } from './usb';
import type { UsbFingerprint } from '@podkit/device-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 0x1000;

function makeFingerprint(bus = 1, devnum = 4): UsbFingerprint {
  return { vendorId: '05ac', productId: '1261', bus, devnum };
}

interface CallLog {
  init: number;
  exit: number;
  open: number;
  close: number;
  ref: number;
  unref: number;
  freeList: number;
  controlTransfers: Array<{
    bmRequestType: number;
    bRequest: number;
    wValue: number;
    wIndex: number;
    wLength: number;
    timeout: number;
  }>;
}

interface FakeOptions {
  /** Devices on the bus, by index. */
  devices?: Array<{ bus: number; devnum: number }>;
  /** Per-page response: undefined means call returns 0 bytes. */
  pageResponses?: Map<number, Uint8Array | { error: number }>;
  /** Force `init` to fail with this code (non-zero). */
  initFails?: number;
  /** Force `open` to fail with this code (non-zero). */
  openFails?: number;
  /** Force `get_device_list` to fail (negative code). */
  getListFails?: number;
}

function makeFake(opts: FakeOptions): { binding: LibusbBinding; calls: CallLog } {
  const calls: CallLog = {
    init: 0,
    exit: 0,
    open: 0,
    close: 0,
    ref: 0,
    unref: 0,
    freeList: 0,
    controlTransfers: [],
  };

  // Distinct sentinel "pointers" — koffi-typed as `unknown`, so any value works.
  const ctxPtr: LibusbPtr = { tag: 'ctx' };
  const listPtr: LibusbPtr = { tag: 'list', devices: opts.devices ?? [] };
  const handlePtr: LibusbPtr = { tag: 'handle' };

  const binding: LibusbBinding = {
    init(ctxOut) {
      calls.init++;
      if (opts.initFails) return opts.initFails;
      // Mark the buffer so decodePointer can recognise it (purely for debug).
      ctxOut.writeUInt8(1, 0);
      return 0;
    },
    exit(_ctx) {
      calls.exit++;
    },
    get_device_list(_ctx, listOut) {
      if (opts.getListFails !== undefined) return opts.getListFails;
      listOut.writeUInt8(2, 0);
      return (opts.devices ?? []).length;
    },
    free_device_list(_list, _unref) {
      calls.freeList++;
    },
    get_bus_number(dev) {
      return (dev as { bus: number }).bus;
    },
    get_device_address(dev) {
      return (dev as { devnum: number }).devnum;
    },
    ref_device(dev) {
      calls.ref++;
      return dev;
    },
    unref_device(_dev) {
      calls.unref++;
    },
    open(_dev, handleOut) {
      calls.open++;
      if (opts.openFails) return opts.openFails;
      handleOut.writeUInt8(3, 0);
      return 0;
    },
    close(_handle) {
      calls.close++;
    },
    control_transfer(_handle, bmRequestType, bRequest, wValue, wIndex, data, wLength, timeout) {
      calls.controlTransfers.push({ bmRequestType, bRequest, wValue, wIndex, wLength, timeout });
      const resp = opts.pageResponses?.get(wIndex);
      if (!resp) return 0; // empty
      if ('error' in resp) return resp.error;
      // Write the response bytes into the supplied buffer.
      for (let i = 0; i < resp.length; i++) {
        data.writeUInt8(resp[i] ?? 0, i);
      }
      return resp.length;
    },
    decodeDeviceAt(list, index) {
      const devs = (list as { devices: Array<{ bus: number; devnum: number }> }).devices;
      return devs[index] as LibusbPtr;
    },
    decodePointer(buf) {
      // Distinguish ctx vs list vs handle by the byte we wrote above.
      const sentinel = buf.readUInt8(0);
      if (sentinel === 1) return ctxPtr;
      if (sentinel === 2) return listPtr;
      if (sentinel === 3) return handlePtr;
      return null;
    },
  };
  return { binding, calls };
}

function bytes(n: number, fillByte = 0xaa): Uint8Array {
  const a = new Uint8Array(n);
  a.fill(fillByte);
  return a;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('readUsbInquiry — happy path', () => {
  it('concatenates pages until short-read terminates the stream', async () => {
    const page0 = bytes(PAGE_SIZE, 0x01);
    const page1 = bytes(PAGE_SIZE, 0x02);
    const page2 = bytes(123, 0x03); // short read → end
    const responses = new Map<number, Uint8Array>([
      [0, page0],
      [1, page1],
      [2, page2],
    ]);
    const { binding, calls } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: responses,
    });

    const result = await readUsbInquiry(makeFingerprint(1, 4), undefined, binding);

    expect(result.length).toBe(PAGE_SIZE * 2 + 123);
    expect(result[0]).toBe(0x01);
    expect(result[PAGE_SIZE]).toBe(0x02);
    expect(result[PAGE_SIZE * 2]).toBe(0x03);
    // Iteration stops at the short-read page — no extra calls.
    expect(calls.controlTransfers).toHaveLength(3);
  });

  it('issues control transfers with the documented Apple SysInfoExtended params', async () => {
    const responses = new Map<number, Uint8Array>([[0, bytes(10, 0xff)]]);
    const { binding, calls } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: responses,
    });

    await readUsbInquiry(makeFingerprint(1, 4), { timeoutMs: 5000 }, binding);

    expect(calls.controlTransfers).toHaveLength(1);
    const t = calls.controlTransfers[0]!;
    expect(t.bmRequestType).toBe(0xc0); // IN | VENDOR | DEVICE
    expect(t.bRequest).toBe(0x40);
    expect(t.wValue).toBe(0x02);
    expect(t.wIndex).toBe(0); // page counter starts at 0
    expect(t.wLength).toBe(PAGE_SIZE);
    expect(t.timeout).toBe(5000);
  });

  it('iterates wIndex = 0, 1, 2 across pages', async () => {
    const responses = new Map<number, Uint8Array>([
      [0, bytes(PAGE_SIZE, 1)],
      [1, bytes(PAGE_SIZE, 2)],
      [2, bytes(50, 3)],
    ]);
    const { binding, calls } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: responses,
    });
    await readUsbInquiry(makeFingerprint(1, 4), undefined, binding);
    expect(calls.controlTransfers.map((t) => t.wIndex)).toEqual([0, 1, 2]);
  });

  it('uses default timeout 0 when none supplied', async () => {
    const responses = new Map<number, Uint8Array>([[0, bytes(10, 0xff)]]);
    const { binding, calls } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: responses,
    });
    await readUsbInquiry(makeFingerprint(1, 4), undefined, binding);
    expect(calls.controlTransfers[0]?.timeout).toBe(0);
  });
});

describe('readUsbInquiry — cleanup', () => {
  it('balances init/exit, open/close, ref/unref on success', async () => {
    const responses = new Map<number, Uint8Array>([[0, bytes(10, 0xff)]]);
    const { binding, calls } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: responses,
    });
    await readUsbInquiry(makeFingerprint(1, 4), undefined, binding);
    expect(calls.init).toBe(1);
    expect(calls.exit).toBe(1);
    expect(calls.open).toBe(1);
    expect(calls.close).toBe(1);
    expect(calls.ref).toBe(1);
    expect(calls.unref).toBe(1);
    expect(calls.freeList).toBe(1);
  });

  it('exits context even when control_transfer throws', async () => {
    const responses = new Map<number, Uint8Array | { error: number }>([
      [0, { error: -7 }], // LIBUSB_ERROR_TIMEOUT
    ]);
    const { binding, calls } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: responses,
    });
    await expect(readUsbInquiry(makeFingerprint(1, 4), undefined, binding)).rejects.toThrow();
    // Even though the transfer errored, lifecycle is balanced.
    expect(calls.init).toBe(1);
    expect(calls.exit).toBe(1);
    expect(calls.open).toBe(1);
    expect(calls.close).toBe(1);
    expect(calls.ref).toBe(1);
    expect(calls.unref).toBe(1);
  });

  it('frees device list even when no device matches', async () => {
    const { binding, calls } = makeFake({
      devices: [{ bus: 9, devnum: 9 }], // does not match
    });
    await expect(readUsbInquiry(makeFingerprint(1, 4), undefined, binding)).rejects.toThrow(
      /no USB device matched/
    );
    expect(calls.freeList).toBe(1);
    // Never opened anything, so close/unref stay 0.
    expect(calls.open).toBe(0);
    expect(calls.close).toBe(0);
    expect(calls.ref).toBe(0);
    expect(calls.unref).toBe(0);
    // But init/exit are still balanced.
    expect(calls.init).toBe(1);
    expect(calls.exit).toBe(1);
  });

  it('exits context when libusb_open fails', async () => {
    const { binding, calls } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      openFails: -3, // LIBUSB_ERROR_ACCESS
    });
    await expect(readUsbInquiry(makeFingerprint(1, 4), undefined, binding)).rejects.toMatchObject({
      kind: 'open-failed',
    });
    expect(calls.init).toBe(1);
    expect(calls.exit).toBe(1);
    // Device was ref'd but open failed → must unref so refcount stays balanced.
    expect(calls.ref).toBe(1);
    expect(calls.unref).toBe(1);
    expect(calls.close).toBe(0);
  });
});

describe('readUsbInquiry — error paths', () => {
  it('throws init-failed when libusb_init returns non-zero', async () => {
    const { binding } = makeFake({ initFails: -1 });
    await expect(readUsbInquiry(makeFingerprint(), undefined, binding)).rejects.toMatchObject({
      kind: 'init-failed',
      libusbCode: -1,
    });
  });

  it('throws device-not-found when bus/devnum mismatch', async () => {
    const { binding } = makeFake({
      devices: [{ bus: 5, devnum: 6 }],
      pageResponses: new Map(),
    });
    await expect(readUsbInquiry(makeFingerprint(1, 2), undefined, binding)).rejects.toMatchObject({
      kind: 'device-not-found',
    });
  });

  it('throws device-not-found when get_device_list returns negative', async () => {
    const { binding } = makeFake({ getListFails: -99 });
    await expect(readUsbInquiry(makeFingerprint(), undefined, binding)).rejects.toMatchObject({
      kind: 'device-not-found',
      libusbCode: -99,
    });
  });

  it('throws control-transfer-failed and surfaces libusb error code', async () => {
    const { binding } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: new Map<number, { error: number }>([[0, { error: -4 }]]),
    });
    const err = await readUsbInquiry(makeFingerprint(1, 4), undefined, binding).catch((e) => e);
    expect(err).toBeInstanceOf(UsbInquiryError);
    expect((err as UsbInquiryError).kind).toBe('control-transfer-failed');
    expect((err as UsbInquiryError).libusbCode).toBe(-4);
  });

  it('throws empty-response when device returns zero bytes on page 0', async () => {
    const { binding } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: new Map<number, Uint8Array>([[0, new Uint8Array(0)]]),
    });
    await expect(readUsbInquiry(makeFingerprint(1, 4), undefined, binding)).rejects.toMatchObject({
      kind: 'empty-response',
    });
  });

  it('UsbInquiryError exposes kind for libusb-not-loadable case', () => {
    const e = new UsbInquiryError({ kind: 'libusb-not-loadable', message: 'no libusb' });
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('libusb-not-loadable');
  });
});

describe('readUsbInquiry — bus/devnum forwarding', () => {
  it('matches device by exact (bus, devnum) pair from fingerprint', async () => {
    const responses = new Map<number, Uint8Array>([[0, bytes(10, 0xff)]]);
    const { binding } = makeFake({
      devices: [
        { bus: 1, devnum: 1 },
        { bus: 2, devnum: 5 },
        { bus: 1, devnum: 7 },
      ],
      pageResponses: responses,
    });
    const result = await readUsbInquiry(makeFingerprint(2, 5), undefined, binding);
    expect(result.length).toBe(10);
  });
});
