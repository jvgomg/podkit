import { describe, it, expect } from 'bun:test';
import { formatDeviceAccessReport, isMountPoint } from './container-probe.js';

describe('isMountPoint', () => {
  const procMounts = [
    'overlay / overlay rw,relatime 0 0',
    '/dev/sdb1 /ipod vfat rw,relatime 0 0',
    'tmpfs /dev tmpfs rw,nosuid 0 0',
    '/dev/sda1 /media/with\\040space ext4 rw 0 0',
  ].join('\n');

  it('finds a mounted path', () => {
    expect(isMountPoint(procMounts, '/ipod')).toBe(true);
  });

  it('does not match a non-mounted path', () => {
    expect(isMountPoint(procMounts, '/config')).toBe(false);
  });

  it('does not prefix-match (/ipod vs /ipod2)', () => {
    expect(isMountPoint(procMounts, '/ipod2')).toBe(false);
    expect(isMountPoint(procMounts, '/i')).toBe(false);
  });

  it('decodes octal-escaped spaces in mount points', () => {
    expect(isMountPoint(procMounts, '/media/with space')).toBe(true);
  });

  it('handles empty input', () => {
    expect(isMountPoint('', '/ipod')).toBe(false);
  });
});

describe('formatDeviceAccessReport', () => {
  it('reports the all-access view', () => {
    const lines = formatDeviceAccessReport({
      ipodPath: '/ipod',
      ipodMounted: true,
      usbBusPresent: true,
      sgDeviceCount: 2,
    });
    const text = lines.join('\n');
    expect(text).toContain('/ipod');
    expect(text).toContain('path-based sync ready');
    expect(text).toContain('/dev/bus/usb');
    expect(text.toLowerCase()).toContain('device add');
    expect(text).toContain('/dev/sg');
  });

  it('gives bind-mount guidance when /ipod is not mounted', () => {
    const lines = formatDeviceAccessReport({
      ipodPath: '/ipod',
      ipodMounted: false,
      usbBusPresent: true,
      sgDeviceCount: 0,
    });
    const text = lines.join('\n');
    expect(text).toContain('not mounted');
    expect(text).toContain('-v /media/ipod:/ipod');
  });

  it('distinguishes the path baseline from the USB-setup case when USB is absent', () => {
    const lines = formatDeviceAccessReport({
      ipodPath: '/ipod',
      ipodMounted: true,
      usbBusPresent: false,
      sgDeviceCount: 0,
    });
    const text = lines.join('\n');
    // USB missing is explicitly non-fatal for the path lane: the one-time
    // setup is unavailable, but steady-state path sync does not need it.
    expect(text.toLowerCase()).toContain('device add');
    expect(text.toLowerCase()).toContain('unavailable');
    expect(text.toLowerCase()).toContain('not needed for path-based sync');
  });

  it('notes SCSI unavailability without alarming (older-iPod concern only)', () => {
    const lines = formatDeviceAccessReport({
      ipodPath: '/ipod',
      ipodMounted: true,
      usbBusPresent: true,
      sgDeviceCount: 0,
    });
    const text = lines.join('\n');
    expect(text.toLowerCase()).toContain('older ipods');
  });

  it('never leaks implementation wording', () => {
    for (const view of [
      { ipodPath: '/ipod', ipodMounted: true, usbBusPresent: true, sgDeviceCount: 1 },
      { ipodPath: '/ipod', ipodMounted: false, usbBusPresent: false, sgDeviceCount: 0 },
    ]) {
      const text = formatDeviceAccessReport(view).join('\n').toLowerCase();
      expect(text).not.toContain('libgpod');
    }
  });

  it('uses the given ipod path in the guidance', () => {
    const lines = formatDeviceAccessReport({
      ipodPath: '/mnt/pod',
      ipodMounted: false,
      usbBusPresent: false,
      sgDeviceCount: 0,
    });
    expect(lines.join('\n')).toContain('/mnt/pod');
  });
});
