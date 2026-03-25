/**
 * Device poller — detects iPod devices by polling lsblk.
 *
 * Emits events when USB mass-storage iPods appear or disappear.
 * Detection heuristics:
 *   1. FAT32 (vfat) filesystem type
 *   2. USB vendor ID 0x05ac (Apple) read from /sys
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { stripPartitionSuffix } from '@podkit/core';
import { log } from './logger.js';
import { touchHealthFile } from './health-check.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedDevice {
  /** Partition name, e.g. "sdb1" */
  name: string;
  /** Full device path, e.g. "/dev/sdb1" */
  disk: string;
  uuid?: string;
  label?: string;
  mountPoint?: string;
  /** Size in bytes */
  size: number;
}

interface LsblkDevice {
  name: string;
  uuid: string | null;
  label: string | null;
  mountpoint: string | null;
  mountpoints?: (string | null)[];
  fstype: string | null;
  size: number | null;
  type: string;
  children?: LsblkDevice[];
}

interface LsblkOutput {
  blockdevices: LsblkDevice[];
}

export interface DevicePollerOptions {
  /** Poll interval in seconds (default: 5) */
  interval?: number;
  /** Path to the health check file (default: /tmp/podkit-daemon-health) */
  healthFile?: string;
  /**
   * Override the device scanning function. Used for testing.
   * Should return an array of detected devices for the current poll cycle.
   */
  scan?: () => Promise<DetectedDevice[]>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface DevicePollerEvents {
  'device-appeared': [device: DetectedDevice];
  'device-disappeared': [device: DetectedDevice];
}

// ---------------------------------------------------------------------------
// lsblk helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect partitions from lsblk output.
 */
export function collectPartitions(devices: LsblkDevice[]): LsblkDevice[] {
  const partitions: LsblkDevice[] = [];
  for (const device of devices) {
    if (device.type === 'part') {
      partitions.push(device);
    }
    if (device.children) {
      partitions.push(...collectPartitions(device.children));
    }
  }
  return partitions;
}

/**
 * Parse lsblk --json output into an array of partition descriptors.
 */
export function parseLsblkJson(jsonString: string): LsblkDevice[] {
  let parsed: LsblkOutput;
  try {
    parsed = JSON.parse(jsonString) as LsblkOutput;
  } catch {
    return [];
  }
  if (!parsed.blockdevices) return [];
  return collectPartitions(parsed.blockdevices);
}

// ---------------------------------------------------------------------------
// USB vendor ID detection
// ---------------------------------------------------------------------------

const APPLE_VENDOR_ID = '05ac';

/**
 * Read USB vendor ID from /sys for a given block device name.
 *
 * Walks up the sysfs tree from /sys/block/<baseDisk>/device to find
 * idVendor. Returns the raw hex string (e.g. "05ac") or undefined.
 */
export function readUsbVendorId(partitionName: string): string | undefined {
  // Strip partition suffix to get base disk: sdb1 -> sdb, nvme0n1p2 -> nvme0n1
  const baseName = stripPartitionSuffix(partitionName);

  try {
    const deviceLink = `/sys/block/${baseName}/device`;
    if (!existsSync(deviceLink)) return undefined;

    let sysPath = realpathSync(deviceLink);

    for (let i = 0; i < 10; i++) {
      const vendorPath = join(sysPath, 'idVendor');
      if (existsSync(vendorPath)) {
        return readFileSync(vendorPath, 'utf-8').trim();
      }
      const parent = resolve(sysPath, '..');
      if (parent === sysPath) break;
      sysPath = parent;
    }
  } catch {
    // /sys may not be available (e.g. in containers without --privileged)
  }

  return undefined;
}

/**
 * Determine whether a partition looks like an iPod.
 *
 * Checks: FAT32 filesystem AND Apple USB vendor ID.
 */
export function isIpodDevice(partition: LsblkDevice): boolean {
  if (partition.fstype !== 'vfat') return false;
  const vendorId = readUsbVendorId(partition.name);
  return vendorId === APPLE_VENDOR_ID;
}

// ---------------------------------------------------------------------------
// Mass-storage path scanning
// ---------------------------------------------------------------------------

/**
 * Scan configured mass-storage paths and return detected devices.
 *
 * For each path, checks that it exists and is a directory. Returns a
 * {@link DetectedDevice} for each valid path, using the path as both
 * `name` and `disk` (mass-storage devices are already mounted).
 */
export function scanMassStoragePaths(paths: string[]): DetectedDevice[] {
  const devices: DetectedDevice[] = [];
  for (const path of paths) {
    try {
      if (existsSync(path) && statSync(path).isDirectory()) {
        devices.push({ name: path, disk: path, size: 0 });
      }
    } catch {
      // Path inaccessible — skip it
    }
  }
  return devices;
}

// ---------------------------------------------------------------------------
// Exec helper
// ---------------------------------------------------------------------------

function execLsblk(): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('lsblk', [
      '--json',
      '-b',
      '-f',
      '-o',
      'NAME,UUID,LABEL,MOUNTPOINT,FSTYPE,SIZE,TYPE',
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`lsblk exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// DevicePoller
// ---------------------------------------------------------------------------

function toDetectedDevice(part: LsblkDevice): DetectedDevice {
  const mountPoint =
    part.mountpoint ??
    part.mountpoints?.find((m) => m !== null && m !== undefined && m !== '') ??
    undefined;

  return {
    name: part.name,
    disk: `/dev/${part.name}`,
    uuid: part.uuid ?? undefined,
    label: part.label ?? undefined,
    mountPoint: mountPoint ?? undefined,
    size: part.size ?? 0,
  };
}

export class DevicePoller extends EventEmitter<DevicePollerEvents> {
  private intervalMs: number;
  private healthFile?: string;
  private scanFn: () => Promise<DetectedDevice[]>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private knownDevices = new Map<string, DetectedDevice>();
  /** Devices seen once but not yet confirmed (debounce). */
  private pendingDevices = new Map<string, DetectedDevice>();
  private polling = false;

  constructor(options?: DevicePollerOptions) {
    super();
    this.intervalMs = (options?.interval ?? 5) * 1000;
    this.healthFile = options?.healthFile;
    this.scanFn = options?.scan ?? DevicePoller.defaultScan;
  }

  /**
   * Start polling for devices.
   */
  start(): void {
    if (this.timer) return;
    log('info', `Device poller started`, { intervalMs: this.intervalMs });

    // Run immediately, then on interval
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  /**
   * Stop polling.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log('info', 'Device poller stopped');
    }
  }

  /**
   * Run a single poll cycle. Exported for testing.
   *
   * Debounce: a device must appear in 2 consecutive polls before
   * `device-appeared` is emitted. This prevents rapid plug/unplug
   * cycles from triggering spurious events.
   */
  /**
   * Default scan function: run lsblk, parse output, filter for iPods.
   */
  private static async defaultScan(): Promise<DetectedDevice[]> {
    const output = await execLsblk();
    const partitions = parseLsblkJson(output);
    return partitions.filter(isIpodDevice).map(toDetectedDevice);
  }

  async poll(): Promise<void> {
    // Guard against concurrent polls (if lsblk takes longer than the interval)
    if (this.polling) return;
    this.polling = true;

    let devices: DetectedDevice[];
    try {
      devices = await this.scanFn();
    } catch (err) {
      log('error', 'Failed to poll devices', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.polling = false;
      return;
    }

    const currentDevices = new Map<string, DetectedDevice>();

    for (const device of devices) {
      currentDevices.set(device.name, device);
    }

    // Debounced appearance detection:
    // - New device not in known or pending → add to pending
    // - Device in pending and still present → promote to known, emit event
    // - Device in pending but gone → remove from pending (ghost)
    const newPending = new Map<string, DetectedDevice>();

    for (const [name, device] of currentDevices) {
      if (this.knownDevices.has(name)) {
        // Already known — nothing to do
        continue;
      }

      if (this.pendingDevices.has(name)) {
        // Seen in previous poll too — confirmed, promote to known
        log('info', `iPod detected: ${name}`, {
          disk: device.disk,
          label: device.label,
          uuid: device.uuid,
        });
        this.emit('device-appeared', device);
      } else {
        // First sighting — add to pending, wait for confirmation
        log('info', `iPod candidate detected, awaiting confirmation: ${name}`, {
          disk: device.disk,
        });
        newPending.set(name, device);
      }
    }

    // Detect disappearances (only for confirmed/known devices)
    for (const [name, device] of this.knownDevices) {
      if (!currentDevices.has(name)) {
        log('info', `iPod removed: ${name}`);
        this.emit('device-disappeared', device);
      }
    }

    // Update state: known = previously known (still present) + newly promoted
    const updatedKnown = new Map<string, DetectedDevice>();
    for (const [name, device] of currentDevices) {
      if (this.knownDevices.has(name) || this.pendingDevices.has(name)) {
        updatedKnown.set(name, device);
      }
    }
    this.knownDevices = updatedKnown;
    this.pendingDevices = newPending;

    // Touch health file on successful poll
    touchHealthFile(this.healthFile);

    this.polling = false;
  }
}
