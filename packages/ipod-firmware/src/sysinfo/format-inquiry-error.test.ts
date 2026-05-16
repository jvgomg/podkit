/**
 * Unit tests for the pure inquiry-error formatter.
 *
 * The formatter is the user-facing surface that turns the orchestrator's
 * per-attempt records into the multi-line "Could not read device identity
 * from USB or SCSI: …" message. These tests cover every transport-result
 * combination the orchestrator can produce on the failure path, plus the
 * verbose-level switches that control footer + per-line detail.
 */

import { describe, expect, it } from 'bun:test';
import type { UsbFingerprint } from '@podkit/device-types';
import type { InquiryAttempt } from '../inquiry/orchestrator.js';
import { ScsiError } from '../inquiry/scsi/errors.js';
import { UsbInquiryError } from '../inquiry/usb.js';
import { formatInquiryError } from './format-inquiry-error.js';

const FP: UsbFingerprint = {
  vendorId: '05ac',
  productId: '1262', // nano 3G
  bus: 1,
  devnum: 16,
};

function usbAttempt(error: Error): InquiryAttempt {
  return { transport: 'usb', outcome: 'transport-error', error };
}
function scsiAttempt(error: Error): InquiryAttempt {
  return { transport: 'scsi', outcome: 'transport-error', error };
}

describe('formatInquiryError', () => {
  it('returns the "no transport available" line when there are zero attempts', () => {
    expect(formatInquiryError([])).toBe(
      'Could not read device identity: no firmware inquiry transport is available on this system'
    );
  });

  describe('USB-only plan', () => {
    it('USB EACCES on /dev/bus/usb/... renders permission-denied + udev hint + footer', () => {
      const err = new UsbInquiryError({
        kind: 'open-failed',
        message: 'device.open failed: LIBUSB_ERROR_ACCESS',
        libusbStatus: -3,
      });
      const msg = formatInquiryError([usbAttempt(err)], { fingerprint: FP });
      expect(msg).toContain('Could not read device identity from USB:');
      expect(msg).toContain('USB: Permission denied accessing /dev/bus/usb/001/016');
      expect(msg).toContain('podkit doctor --repair udev-rule');
      expect(msg).toContain('(then unplug and replug your iPod)');
      expect(msg).toContain('(re-run with -vv for more detail)');
    });

    it('USB STALL with no fingerprint renders the libusb message and omits the hint', () => {
      const err = new UsbInquiryError({
        kind: 'control-transfer-failed',
        message: 'controlTransfer failed on page 0: LIBUSB_ERROR_PIPE',
        libusbStatus: -9,
      });
      const msg = formatInquiryError([usbAttempt(err)]);
      expect(msg).toContain('Could not read device identity from USB:');
      expect(msg).toContain('USB: controlTransfer failed on page 0: LIBUSB_ERROR_PIPE');
      expect(msg).not.toContain('podkit doctor --repair udev-rule');
      expect(msg).toContain('(re-run with -vv for more detail)');
    });
  });

  describe('USB + SCSI both failing', () => {
    it('matches the linka EACCES repro exactly', () => {
      const usbErr = new UsbInquiryError({
        kind: 'open-failed',
        message: 'device.open failed: LIBUSB_ERROR_ACCESS',
        libusbStatus: -3,
      });
      const scsiErr = new ScsiError({
        kind: 'eacces',
        devicePath: '/dev/sg3',
        errno: 13,
        syscall: 'open',
      });
      const msg = formatInquiryError([usbAttempt(usbErr), scsiAttempt(scsiErr)], {
        fingerprint: FP,
      });
      // Header
      expect(msg).toContain('Could not read device identity from USB or SCSI:');
      // Per-transport lines (column-aligned: USB has trailing space because
      // SCSI is one char wider)
      expect(msg).toContain('USB:  Permission denied accessing /dev/bus/usb/001/016');
      expect(msg).toContain('SCSI: Permission denied accessing /dev/sg3');
      // Remediation
      expect(msg).toContain('To grant access without sudo, run: podkit doctor --repair udev-rule');
      expect(msg).toContain('(then unplug and replug your iPod)');
      // Footer
      expect(msg).toContain('(re-run with -vv for more detail)');
    });

    it('USB STALL + SCSI EACCES still surfaces the udev hint (anyEacces triggers it)', () => {
      const usbErr = new UsbInquiryError({
        kind: 'control-transfer-failed',
        message: 'controlTransfer failed on page 0: LIBUSB_ERROR_PIPE',
        libusbStatus: -9,
      });
      const scsiErr = new ScsiError({
        kind: 'eacces',
        devicePath: '/dev/sg3',
        errno: 13,
        syscall: 'open',
      });
      const msg = formatInquiryError([usbAttempt(usbErr), scsiAttempt(scsiErr)], {
        fingerprint: FP,
      });
      expect(msg).toContain('USB:  controlTransfer failed on page 0: LIBUSB_ERROR_PIPE');
      expect(msg).toContain('SCSI: Permission denied accessing /dev/sg3');
      expect(msg).toContain('podkit doctor --repair udev-rule');
    });

    it('USB plain error + SCSI plain error renders one-line messages without the udev hint', () => {
      const msg = formatInquiryError(
        [usbAttempt(new Error('usb dead')), scsiAttempt(new Error('scsi dead'))],
        { fingerprint: FP }
      );
      expect(msg).toContain('Could not read device identity from USB or SCSI:');
      expect(msg).toContain('USB:  usb dead');
      expect(msg).toContain('SCSI: scsi dead');
      expect(msg).not.toContain('podkit doctor --repair udev-rule');
      expect(msg).toContain('(re-run with -vv for more detail)');
    });
  });

  describe('verbose plumbing', () => {
    it('verbose 0 includes the footer', () => {
      const err = new ScsiError({ kind: 'eacces', devicePath: '/dev/sg3', errno: 13 });
      const msg = formatInquiryError([scsiAttempt(err)], { verbose: 0, fingerprint: FP });
      expect(msg).toContain('(re-run with -vv for more detail)');
    });

    it('verbose 1 still includes the footer (the next actionable level is -vv)', () => {
      const err = new ScsiError({ kind: 'eacces', devicePath: '/dev/sg3', errno: 13 });
      const msg = formatInquiryError([scsiAttempt(err)], { verbose: 1, fingerprint: FP });
      expect(msg).toContain('(re-run with -vv for more detail)');
    });

    it('verbose 2 drops the footer and adds the SCSI syscall site to each line', () => {
      const err = new ScsiError({
        kind: 'eacces',
        devicePath: '/dev/sg3',
        errno: 13,
        syscall: 'open',
      });
      const msg = formatInquiryError([scsiAttempt(err)], { verbose: 2, fingerprint: FP });
      expect(msg).not.toContain('(re-run with -vv for more detail)');
      expect(msg).toContain('SCSI: Permission denied accessing /dev/sg3 (open)');
    });

    it('verbose 2 surfaces libusb status on a USB EACCES line', () => {
      const err = new UsbInquiryError({
        kind: 'open-failed',
        message: 'device.open failed: LIBUSB_ERROR_ACCESS',
        libusbStatus: -3,
      });
      const msg = formatInquiryError([usbAttempt(err)], { verbose: 2, fingerprint: FP });
      expect(msg).toContain(
        'USB: Permission denied accessing /dev/bus/usb/001/016 (libusb status -3)'
      );
      expect(msg).not.toContain('(re-run with -vv for more detail)');
    });

    it('verbose 3 behaves the same as verbose 2 today', () => {
      const err = new ScsiError({
        kind: 'eacces',
        devicePath: '/dev/sg3',
        errno: 13,
        syscall: 'open',
      });
      const msg = formatInquiryError([scsiAttempt(err)], { verbose: 3, fingerprint: FP });
      expect(msg).not.toContain('(re-run with -vv for more detail)');
      expect(msg).toContain('SCSI: Permission denied accessing /dev/sg3 (open)');
    });
  });

  describe('EACCES detection edge cases', () => {
    it('ScsiError with kind=eacces but no devicePath falls back to /dev/sgN placeholder', () => {
      const err = new ScsiError({ kind: 'eacces', errno: 13 });
      const msg = formatInquiryError([scsiAttempt(err)]);
      expect(msg).toContain('SCSI: Permission denied accessing /dev/sgN');
      expect(msg).toContain('podkit doctor --repair udev-rule');
    });

    it('UsbInquiryError with libusbStatus=-3 but no fingerprint still flags as permission denied', () => {
      const err = new UsbInquiryError({
        kind: 'open-failed',
        message: 'device.open failed: LIBUSB_ERROR_ACCESS',
        libusbStatus: -3,
      });
      const msg = formatInquiryError([usbAttempt(err)]);
      expect(msg).toContain('USB: Permission denied accessing /dev/bus/usb/...');
      expect(msg).toContain('podkit doctor --repair udev-rule');
    });

    it('UsbInquiryError whose message contains LIBUSB_ERROR_ACCESS but lacks libusbStatus still detects', () => {
      const err = new UsbInquiryError({
        kind: 'open-failed',
        message: 'device.open failed: LIBUSB_ERROR_ACCESS',
      });
      const msg = formatInquiryError([usbAttempt(err)], { fingerprint: FP });
      expect(msg).toContain('USB: Permission denied accessing /dev/bus/usb/001/016');
      expect(msg).toContain('podkit doctor --repair udev-rule');
    });

    it('Non-EACCES ScsiError (e.g. ENOENT) keeps its own message and omits the hint', () => {
      const err = new ScsiError({ kind: 'enoent', devicePath: '/dev/sg9' });
      const msg = formatInquiryError([scsiAttempt(err)]);
      expect(msg).toContain('SCSI: /dev/sg9 does not exist');
      expect(msg).not.toContain('podkit doctor --repair udev-rule');
    });
  });

  describe('SCSI-only plan', () => {
    it('SCSI EACCES alone produces a single-transport header', () => {
      const err = new ScsiError({ kind: 'eacces', devicePath: '/dev/sg3', errno: 13 });
      const msg = formatInquiryError([scsiAttempt(err)]);
      expect(msg).toContain('Could not read device identity from SCSI:');
      expect(msg).toContain('SCSI: Permission denied accessing /dev/sg3');
      expect(msg).toContain('podkit doctor --repair udev-rule');
    });
  });
});
