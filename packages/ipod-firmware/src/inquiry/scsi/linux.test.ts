/**
 * Unit tests for the Linux SCSI transport.
 *
 * Mocks the koffi `LinuxBinding` boundary so we can exercise the SG_IO
 * syscall factory without touching libc or `/dev/sg*`. Real-device
 * validation requires a connected iPod.
 */

import { describe, expect, test } from 'bun:test';
import { errnoToKind } from './errors.js';
import { makeSgIoSyscall } from './linux.js';
import { VPD_HEADER_BYTES, VPD_PAGE_INDEX } from './types.js';

/**
 * Build a stub binding that hands back canned outputs to the SG_IO call.
 * The binding receives the koffi-decoded `sg_io_hdr` object — we mutate
 * it to simulate the kernel's writeback (status / sense / data).
 */
function stubBinding(
  configure: (hdr: Record<string, unknown>) => number,
  errnoValue = 0
): {
  ioctl: (fd: number, request: number, hdr: unknown) => number;
  errno: () => number;
} {
  return {
    ioctl: (_fd, _request, hdr) => configure(hdr as Record<string, unknown>),
    errno: () => errnoValue,
  };
}

describe('errnoToKind', () => {
  test.each([
    [13, 'eacces'],
    [16, 'ebusy'],
    [2, 'enoent'],
    [1, 'eperm'],
    [5, 'io-error'],
    [22, 'errno'],
  ] as const)('errno=%i → %s', (errno, kind) => {
    expect(errnoToKind(errno)).toBe(kind);
  });
});

describe('makeSgIoSyscall', () => {
  test('successful call returns the data buffer as Uint8Array', () => {
    const binding = stubBinding((hdr) => {
      // Simulate kernel writing the VPD header into the data buffer.
      const data = hdr.dxferp as Buffer;
      data[0] = 0x00;
      data[1] = VPD_PAGE_INDEX;
      data[2] = 0x00;
      data[3] = 0x02;
      data[4] = 0xc1;
      data[5] = 0xc2;
      // GOOD status; no sense.
      hdr.status = 0;
      hdr.host_status = 0;
      hdr.driver_status = 0;
      return 0;
    });

    const syscall = makeSgIoSyscall({
      devicePath: '/dev/sg-stub',
      fd: 42,
      timeoutMs: 5000,
      binding,
    });

    const result = syscall(VPD_PAGE_INDEX, 252);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0]).toBe(0x00);
      expect(result.data[1]).toBe(VPD_PAGE_INDEX);
      expect(result.data[VPD_HEADER_BYTES]).toBe(0xc1);
    }
  });

  test('non-zero ioctl rc surfaces errno result', () => {
    const binding = stubBinding(() => -1, 13);
    const syscall = makeSgIoSyscall({
      devicePath: '/dev/sg-stub',
      fd: 42,
      timeoutMs: 5000,
      binding,
    });
    const result = syscall(VPD_PAGE_INDEX, 252);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('errno');
      if (result.kind === 'errno') {
        expect(result.errno).toBe(13);
        expect(result.syscall).toContain('/dev/sg-stub');
      }
    }
  });

  test('SG driver_status=0x06 surfaces as timeout', () => {
    const binding = stubBinding((hdr) => {
      hdr.status = 0;
      hdr.host_status = 0;
      hdr.driver_status = 0x06;
      hdr.sb_len_wr = 0;
      return 0;
    });
    const syscall = makeSgIoSyscall({
      devicePath: '/dev/sg-stub',
      fd: 42,
      timeoutMs: 5000,
      binding,
    });
    const result = syscall(0xc1, 252);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('timeout');
  });

  test('SCSI status CHECK CONDITION surfaces with sense buffer', () => {
    const binding = stubBinding((hdr) => {
      const sense = hdr.sbp as Buffer;
      sense[0] = 0x70;
      sense[2] = 0x06; // unit attention
      sense[12] = 0x29;
      sense[13] = 0x00;
      hdr.status = 0x02;
      hdr.host_status = 0;
      hdr.driver_status = 0;
      hdr.sb_len_wr = 18;
      return 0;
    });
    const syscall = makeSgIoSyscall({
      devicePath: '/dev/sg-stub',
      fd: 42,
      timeoutMs: 5000,
      binding,
    });
    const result = syscall(0xc1, 252);
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'check-condition') {
      expect(result.status).toBe(0x02);
      expect(result.sense[0]).toBe(0x70);
      expect(result.sense[2]).toBe(0x06);
    }
  });
});
