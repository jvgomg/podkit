/**
 * Unit tests for the ep0 event loop's I/O ordering, against a scripted ep0.
 *
 * FunctionFS reads a `read()` on ep0 while an IN-direction SETUP is still
 * pending as a request to STALL it. So the reply to a SETUP must reach the
 * kernel before the loop reads again, and a read that the kernel answers with
 * EL2HLT is a stall it performed, not a dead endpoint.
 */

import { describe, it, expect } from 'bun:test';

import {
  FFS_EVENT_SETUP,
  FFS_EVENT_SIZE,
  FFS_EVENT_TYPE_OFFSET,
  serveEp0,
  type Ep0,
} from '../functionfs.js';
import { BM_REQUEST_TYPE, B_REQUEST, PAGE_SIZE, W_VALUE } from '../protocol.js';

const XML = 'x'.repeat(PAGE_SIZE + 10);

function setupEvent(page: number, bmRequestType = BM_REQUEST_TYPE): Buffer {
  const ev = Buffer.alloc(FFS_EVENT_SIZE);
  ev.writeUInt8(bmRequestType, 0);
  ev.writeUInt8(B_REQUEST, 1);
  ev.writeUInt16LE(W_VALUE, 2);
  ev.writeUInt16LE(page, 4);
  ev.writeUInt16LE(PAGE_SIZE, 6);
  ev.writeUInt8(FFS_EVENT_SETUP, FFS_EVENT_TYPE_OFFSET);
  return ev;
}

type ReadStep = Buffer | Error;

/**
 * An ep0 that answers reads from a script and records every call. Writes
 * settle on a later macrotask, so a loop that does not await them issues its
 * next read first — the ordering the kernel punishes.
 */
function scriptedEp0(reads: ReadStep[]): { ep0: Ep0; calls: string[] } {
  const calls: string[] = [];
  const ep0: Ep0 = {
    async read(buffer) {
      calls.push('read');
      const step = reads.shift();
      if (step === undefined) return { bytesRead: 0 };
      if (step instanceof Error) throw step;
      step.copy(buffer);
      return { bytesRead: step.byteLength };
    },
    write(data) {
      calls.push(`write:${data.byteLength}`);
      return new Promise((resolve) =>
        setTimeout(() => {
          calls.push('write-done');
          resolve(undefined);
        }, 5)
      );
    },
  };
  return { ep0, calls };
}

function errno(code: string): Error {
  return Object.assign(new Error(`${code}: unknown error, read`), { code });
}

const quiet = { sysInfoExtendedXml: XML, log: () => {}, onBind: () => {}, isRunning: () => true };

describe('serveEp0', () => {
  it('lands each SETUP reply before issuing the next read', async () => {
    const { ep0, calls } = scriptedEp0([setupEvent(0), setupEvent(1)]);

    await serveEp0(ep0, quiet);

    expect(calls).toEqual([
      'read',
      `write:${PAGE_SIZE}`,
      'write-done',
      'read',
      'write:10',
      'write-done',
      'read',
    ]);
  });

  it('keeps serving after the kernel stalls a pending request (EL2HLT)', async () => {
    const { ep0, calls } = scriptedEp0([errno('EL2HLT'), setupEvent(0)]);

    await serveEp0(ep0, quiet);

    expect(calls).toEqual(['read', 'read', `write:${PAGE_SIZE}`, 'write-done', 'read']);
  });

  it('stops on any other read error', async () => {
    const { ep0, calls } = scriptedEp0([errno('EBADF'), setupEvent(0)]);

    await serveEp0(ep0, quiet);

    expect(calls).toEqual(['read']);
  });

  it('writes nothing for an unrecognised request, so the next read stalls it', async () => {
    const { ep0, calls } = scriptedEp0([setupEvent(0, 0x80)]);

    await serveEp0(ep0, quiet);

    expect(calls).toEqual(['read', 'read']);
  });
});
