/**
 * Unit tests for the platform-shared SCSI VPD inquiry loop.
 *
 * These tests use a fake `ScsiSyscall` injected directly into
 * {@link readAllVpdSubpages} so they exercise the full loop semantics
 * (page-0xC0 index, subpage iteration, byte concatenation, short-read
 * re-read, sense parsing, errno-to-kind translation, timeout) without
 * touching koffi or any kernel.
 *
 * Hardware end-to-end validation lives outside the test suite —
 * see TASK-292.10.
 */

import { describe, expect, test } from 'bun:test';
import { readAllVpdSubpages } from './index.js';
import { ScsiError } from './errors.js';
import {
  VPD_HEADER_BYTES,
  VPD_PAGE_INDEX,
  buildVpdCdb,
  parseSenseData,
  readVpdPageLength,
  type ScsiSyscall,
  type ScsiSyscallResult,
} from './types.js';

/** Build a faux VPD response: header + payload bytes. */
function fakeResponse(page: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(VPD_HEADER_BYTES + payload.length);
  out[0] = 0x00; // device type (irrelevant for this test)
  out[1] = page;
  out[2] = (payload.length >> 8) & 0xff;
  out[3] = payload.length & 0xff;
  out.set(payload, VPD_HEADER_BYTES);
  return out;
}

describe('helpers', () => {
  test('buildVpdCdb has the correct shape', () => {
    const cdb = buildVpdCdb(0xc0, 252);
    expect(Array.from(cdb)).toEqual([0x12, 0x01, 0xc0, 0x00, 0xfc, 0x00]);
  });

  test('buildVpdCdb encodes 16-bit allocation length big-endian', () => {
    const cdb = buildVpdCdb(0xc1, 1024);
    expect(cdb[3]).toBe(0x04);
    expect(cdb[4]).toBe(0x00);
  });

  test('readVpdPageLength reads 16-bit length from offsets 2-3', () => {
    const buf = new Uint8Array([0, 0xc0, 0x01, 0x23, 0xaa]);
    expect(readVpdPageLength(buf)).toBe(0x0123);
  });

  test('readVpdPageLength returns 0 for too-short buffers', () => {
    expect(readVpdPageLength(new Uint8Array([0, 1]))).toBe(0);
  });
});

describe('parseSenseData', () => {
  test('fixed format (0x70)', () => {
    const sense = new Uint8Array(18);
    sense[0] = 0x70;
    sense[2] = 0x06; // unit attention
    sense[12] = 0x29;
    sense[13] = 0x00;
    const parsed = parseSenseData(sense);
    expect(parsed).toEqual({ senseKey: 0x06, asc: 0x29, ascq: 0x00, format: 'fixed' });
  });

  test('descriptor format (0x72)', () => {
    const sense = new Uint8Array(8);
    sense[0] = 0x72;
    sense[1] = 0x02; // not ready
    sense[2] = 0x04;
    sense[3] = 0x01;
    const parsed = parseSenseData(sense);
    expect(parsed).toEqual({ senseKey: 0x02, asc: 0x04, ascq: 0x01, format: 'descriptor' });
  });

  test('returns null for unknown response codes', () => {
    expect(parseSenseData(new Uint8Array([0x00, 0, 0, 0]))).toBeNull();
  });

  test('returns null for too-short buffers', () => {
    expect(parseSenseData(new Uint8Array([]))).toBeNull();
  });
});

describe('readAllVpdSubpages', () => {
  test('successful 0xC0 index + 3 subpages, byte-concatenation correct', () => {
    const subpageA = new Uint8Array([0x41, 0x42, 0x43]); // 'ABC'
    const subpageB = new Uint8Array([0x44, 0x45]); // 'DE'
    const subpageC = new Uint8Array([0x46]); // 'F'
    const indexPayload = new Uint8Array([0xc1, 0xc2, 0xc3]);

    const responses = new Map<number, Uint8Array>([
      [VPD_PAGE_INDEX, fakeResponse(VPD_PAGE_INDEX, indexPayload)],
      [0xc1, fakeResponse(0xc1, subpageA)],
      [0xc2, fakeResponse(0xc2, subpageB)],
      [0xc3, fakeResponse(0xc3, subpageC)],
    ]);

    const calls: { page: number; allocLen: number }[] = [];
    const syscall: ScsiSyscall = (page, allocLen) => {
      calls.push({ page, allocLen });
      const data = responses.get(page);
      if (!data)
        return { ok: false, kind: 'other', message: `no response for 0x${page.toString(16)}` };
      return { ok: true, data };
    };

    const out = readAllVpdSubpages(syscall);
    expect(Array.from(out)).toEqual([0x41, 0x42, 0x43, 0x44, 0x45, 0x46]);
    expect(calls.map((c) => c.page)).toEqual([VPD_PAGE_INDEX, 0xc1, 0xc2, 0xc3]);
  });

  test('short-read triggers re-read with correct page-length', () => {
    // First call: declared length 1000, but only 252 bytes returned (truncated).
    // Second call must use allocLen ≥ 1004 (header + declared).
    const truncatedSubpage = new Uint8Array(252);
    truncatedSubpage[0] = 0x00;
    truncatedSubpage[1] = 0xc1;
    truncatedSubpage[2] = 0x03; // length MSB = 0x03
    truncatedSubpage[3] = 0xe8; // length LSB = 0xe8 → 1000 bytes declared
    // Body of 248 garbage bytes — never used because we re-read.

    const fullPayload = new Uint8Array(1000);
    for (let i = 0; i < fullPayload.length; i++) fullPayload[i] = i & 0xff;
    const fullSubpage = fakeResponse(0xc1, fullPayload);

    const indexResponse = fakeResponse(VPD_PAGE_INDEX, new Uint8Array([0xc1]));

    const calls: { page: number; allocLen: number }[] = [];
    let subpageCallCount = 0;
    const syscall: ScsiSyscall = (page, allocLen) => {
      calls.push({ page, allocLen });
      if (page === VPD_PAGE_INDEX) return { ok: true, data: indexResponse };
      // First subpage call returns truncated; re-read returns full.
      subpageCallCount += 1;
      if (subpageCallCount === 1) return { ok: true, data: truncatedSubpage };
      return { ok: true, data: fullSubpage };
    };

    const out = readAllVpdSubpages(syscall);
    // Output is the full payload bytes (header stripped) of the re-read.
    expect(out.length).toBe(1000);
    expect(out[0]).toBe(0);
    expect(out[999]).toBe(999 & 0xff);
    // Three calls: index, truncated subpage, re-read subpage with bigger allocLen.
    expect(calls).toHaveLength(3);
    expect(calls[1]).toEqual({ page: 0xc1, allocLen: 252 });
    expect(calls[2]!.page).toBe(0xc1);
    expect(calls[2]!.allocLen).toBeGreaterThanOrEqual(1004);
  });

  test('CHECK CONDITION → ScsiError with parsed sense fields', () => {
    const sense = new Uint8Array(18);
    sense[0] = 0x70;
    sense[2] = 0x02; // NOT READY
    sense[12] = 0x04;
    sense[13] = 0x02;

    const syscall: ScsiSyscall = (): ScsiSyscallResult => ({
      ok: false,
      kind: 'check-condition',
      sense,
      status: 0x02,
    });

    expect(() => readAllVpdSubpages(syscall)).toThrow(ScsiError);
    try {
      readAllVpdSubpages(syscall);
    } catch (err) {
      const e = err as ScsiError;
      expect(e.kind).toBe('sense-check-condition');
      expect(e.page).toBe(VPD_PAGE_INDEX);
      expect(e.status).toBe(0x02);
      expect(e.sense).toEqual({ senseKey: 0x02, asc: 0x04, ascq: 0x02, format: 'fixed' });
    }
  });

  test('timeout → ScsiError({ kind: "timeout" })', () => {
    const syscall: ScsiSyscall = () => ({ ok: false, kind: 'timeout' });
    try {
      readAllVpdSubpages(syscall);
      throw new Error('expected throw');
    } catch (err) {
      const e = err as ScsiError;
      expect(e.kind).toBe('timeout');
      expect(e.page).toBe(VPD_PAGE_INDEX);
    }
  });

  test('Linux EACCES errno → ScsiError({ kind: "eacces" })', () => {
    const syscall: ScsiSyscall = () => ({
      ok: false,
      kind: 'errno',
      errno: 13,
      syscall: 'ioctl(SG_IO) on /dev/sg3',
    });
    try {
      readAllVpdSubpages(syscall);
      throw new Error('expected throw');
    } catch (err) {
      const e = err as ScsiError;
      expect(e.kind).toBe('eacces');
      expect(e.errno).toBe(13);
      expect(e.syscall).toContain('ioctl');
    }
  });

  test('Linux EBUSY errno → ScsiError({ kind: "ebusy" })', () => {
    const syscall: ScsiSyscall = () => ({
      ok: false,
      kind: 'errno',
      errno: 16,
      syscall: 'ioctl(SG_IO)',
    });
    try {
      readAllVpdSubpages(syscall);
      throw new Error('expected throw');
    } catch (err) {
      const e = err as ScsiError;
      expect(e.kind).toBe('ebusy');
    }
  });

  test('Linux ENOENT errno → ScsiError({ kind: "enoent" })', () => {
    const syscall: ScsiSyscall = () => ({
      ok: false,
      kind: 'errno',
      errno: 2,
      syscall: 'ioctl(SG_IO)',
    });
    try {
      readAllVpdSubpages(syscall);
      throw new Error('expected throw');
    } catch (err) {
      const e = err as ScsiError;
      expect(e.kind).toBe('enoent');
    }
  });

  test('IOKit error → ScsiError({ kind: "iokit", rc, where })', () => {
    const syscall: ScsiSyscall = () => ({
      ok: false,
      kind: 'iokit',
      rc: 0xe00002bd,
      where: 'ExecuteTaskSync',
    });
    try {
      readAllVpdSubpages(syscall);
      throw new Error('expected throw');
    } catch (err) {
      const e = err as ScsiError;
      expect(e.kind).toBe('iokit');
      expect(e.rc).toBe(0xe00002bd);
      expect(e.where).toBe('ExecuteTaskSync');
    }
  });

  test('empty 0xC0 index → ScsiError({ kind: "short-read" })', () => {
    const syscall: ScsiSyscall = (page) => ({
      ok: true,
      data: fakeResponse(page, new Uint8Array(0)),
    });
    expect(() => readAllVpdSubpages(syscall)).toThrow(ScsiError);
    try {
      readAllVpdSubpages(syscall);
    } catch (err) {
      const e = err as ScsiError;
      expect(e.kind).toBe('short-read');
      expect(e.page).toBe(VPD_PAGE_INDEX);
    }
  });
});
