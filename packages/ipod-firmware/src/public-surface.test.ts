import { test, expect } from 'bun:test';
import {
  inquireFirmware,
  probeInquiryMethods,
  parsePlist,
  type InquireOptions,
  type InquiryMethodsAvailability,
  type PlistValue,
} from './index.js';

test('public surface imports cleanly', () => {
  expect(typeof inquireFirmware).toBe('function');
  expect(typeof probeInquiryMethods).toBe('function');
  expect(typeof parsePlist).toBe('function');

  const _opts: InquireOptions = {};
  void _opts;
  const _avail: InquiryMethodsAvailability = {
    scsi: { available: false },
    usb: { available: false },
  };
  void _avail;
  const _plist: PlistValue = { type: 'string', value: 'ok' };
  void _plist;
});
