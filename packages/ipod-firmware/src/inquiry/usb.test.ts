/**
 * Unit tests for the USB inquiry implementation.
 *
 * Tests inject a fake `UsbBinding` so they exercise the protocol logic
 * (page iteration, short-read termination, control-transfer parameters,
 * cleanup discipline, error propagation) without loading a real USB stack.
 */

import { describe, expect, it } from 'bun:test';
import { readUsbInquiry, UsbInquiryError } from './usb';
import type { UsbBinding, UsbDeviceHandle } from './usb';
import type { UsbFingerprint } from '@podkit/device-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 0x1000;

function makeFingerprint(bus = 1, devnum = 4): UsbFingerprint {
  return { vendorId: '05ac', productId: '1261', bus, devnum };
}

interface CallLog {
  /** Number of times `withOpenDevice` was entered. */
  opens: number;
  /** Number of times the cleanup `finally` block ran (i.e. close occurred). */
  closes: number;
  /** Recorded control transfer parameters in the order they were issued. */
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
  /** Devices reachable by the binding. Match by exact (bus, devnum) pair. */
  devices?: Array<{ bus: number; devnum: number }>;
  /** Per-page response: undefined means call returns 0 bytes. */
  pageResponses?: Map<number, Uint8Array | { error: number }>;
  /** Force `getDeviceList`/init to fail with a given Error. */
  initFails?: Error;
  /** Force `device.open` to fail with a given libusb-style code. */
  openFails?: number;
}

function makeFake(opts: FakeOptions): { binding: UsbBinding; calls: CallLog } {
  const calls: CallLog = { opens: 0, closes: 0, controlTransfers: [] };

  const binding: UsbBinding = {
    async withOpenDevice<T>(
      bus: number,
      devnum: number,
      fn: (handle: UsbDeviceHandle) => Promise<T>
    ): Promise<T> {
      if (opts.initFails) {
        throw new UsbInquiryError({
          kind: 'init-failed',
          message: opts.initFails.message,
          cause: opts.initFails,
        });
      }

      const match = (opts.devices ?? []).find((d) => d.bus === bus && d.devnum === devnum);
      if (!match) {
        throw new UsbInquiryError({
          kind: 'device-not-found',
          message: `no USB device matched bus=${bus} devnum=${devnum}`,
        });
      }

      if (opts.openFails !== undefined) {
        throw new UsbInquiryError({
          kind: 'open-failed',
          message: `device.open failed with code ${opts.openFails}`,
          libusbStatus: opts.openFails,
        });
      }

      calls.opens++;

      const handle: UsbDeviceHandle = {
        async controlTransfer(bmRequestType, bRequest, wValue, wIndex, wLength, timeout) {
          calls.controlTransfers.push({
            bmRequestType,
            bRequest,
            wValue,
            wIndex,
            wLength,
            timeout,
          });
          const resp = opts.pageResponses?.get(wIndex);
          if (!resp) return new Uint8Array(0);
          if ('error' in resp) {
            throw new UsbInquiryError({
              kind: 'control-transfer-failed',
              message: `controlTransfer failed on page ${wIndex}`,
              libusbStatus: resp.error,
            });
          }
          return resp;
        },
      };

      try {
        return await fn(handle);
      } finally {
        calls.closes++;
      }
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
  it('closes device on success', async () => {
    const responses = new Map<number, Uint8Array>([[0, bytes(10, 0xff)]]);
    const { binding, calls } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: responses,
    });
    await readUsbInquiry(makeFingerprint(1, 4), undefined, binding);
    expect(calls.opens).toBe(1);
    expect(calls.closes).toBe(1);
  });

  it('closes device even when controlTransfer throws', async () => {
    const responses = new Map<number, Uint8Array | { error: number }>([
      [0, { error: -7 }], // LIBUSB_ERROR_TIMEOUT
    ]);
    const { binding, calls } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: responses,
    });
    await expect(readUsbInquiry(makeFingerprint(1, 4), undefined, binding)).rejects.toThrow();
    expect(calls.opens).toBe(1);
    expect(calls.closes).toBe(1);
  });

  it('does not open when no device matches', async () => {
    const { binding, calls } = makeFake({
      devices: [{ bus: 9, devnum: 9 }], // does not match
    });
    await expect(readUsbInquiry(makeFingerprint(1, 4), undefined, binding)).rejects.toThrow(
      /no USB device matched/
    );
    expect(calls.opens).toBe(0);
    expect(calls.closes).toBe(0);
  });

  it('does not open when libusb_open fails', async () => {
    const { binding, calls } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      openFails: -3, // LIBUSB_ERROR_ACCESS
    });
    await expect(readUsbInquiry(makeFingerprint(1, 4), undefined, binding)).rejects.toMatchObject({
      kind: 'open-failed',
    });
    expect(calls.opens).toBe(0);
    expect(calls.closes).toBe(0);
  });
});

describe('readUsbInquiry — error paths', () => {
  it('throws init-failed when the USB stack fails to initialise', async () => {
    const { binding } = makeFake({ initFails: new Error('boom') });
    await expect(readUsbInquiry(makeFingerprint(), undefined, binding)).rejects.toMatchObject({
      kind: 'init-failed',
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

  it('throws control-transfer-failed and surfaces libusb error code', async () => {
    const { binding } = makeFake({
      devices: [{ bus: 1, devnum: 4 }],
      pageResponses: new Map<number, { error: number }>([[0, { error: -4 }]]),
    });
    const err = await readUsbInquiry(makeFingerprint(1, 4), undefined, binding).catch((e) => e);
    expect(err).toBeInstanceOf(UsbInquiryError);
    expect((err as UsbInquiryError).kind).toBe('control-transfer-failed');
    expect((err as UsbInquiryError).libusbStatus).toBe(-4);
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
    const e = new UsbInquiryError({ kind: 'libusb-not-loadable', message: 'no usb' });
    expect(e).toBeInstanceOf(Error);
    expect(e.kind).toBe('libusb-not-loadable');
  });

  it('throws device-not-found when fingerprint lacks bus/devnum', async () => {
    const { binding } = makeFake({ devices: [{ bus: 1, devnum: 4 }] });
    const fp: UsbFingerprint = { vendorId: '05ac', productId: '1261' };
    await expect(readUsbInquiry(fp, undefined, binding)).rejects.toMatchObject({
      kind: 'device-not-found',
    });
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
