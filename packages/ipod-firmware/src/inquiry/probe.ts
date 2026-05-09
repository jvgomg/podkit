/**
 * Inquiry method availability probe
 *
 * Detects which inquiry transports are available on the current system.
 * On macOS, checks for iPodDriver.kext and libusb. On Linux, checks for
 * `/dev/sg*` devices (SG_IO) and libusb.
 *
 * Results are cached after the first call — the availability of kernel
 * extensions and device nodes is stable within a single process lifetime.
 * Call `clearProbeCache()` in tests to reset between cases.
 *
 * USB availability is determined by attempting to import the `usb` npm
 * package (which bundles its own libusb prebuild). The probe shares the
 * loader with `usb.ts` so "probe says available" implies the inquiry path
 * can run without further setup.
 *
 * @module
 */

import * as nodefs from 'node:fs';
import * as nodeos from 'node:os';
import { loadUsb } from './usb.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Availability status for a single inquiry method. */
export interface InquiryMethodAvailability {
  /** Whether the method is available and usable. */
  available: boolean;
  /** Human-readable reason if unavailable, or additional context if available. */
  reason?: string;
}

/** Availability of all supported inquiry methods on this system. */
export interface InquiryMethodsAvailability {
  /** SCSI generic inquiry (IOKit on macOS, SG_IO on Linux). */
  scsi: InquiryMethodAvailability;
  /** USB control-transfer inquiry (via the `usb` npm package). */
  usb: InquiryMethodAvailability;
}

// ---------------------------------------------------------------------------
// Dependency-injection interfaces
// ---------------------------------------------------------------------------

/**
 * Filesystem helpers used by the probe.
 * Expressed as an interface so tests can inject fakes without touching real FS.
 */
export interface ProbeFs {
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  /**
   * Throws if the path is not accessible with the requested mode.
   * Use `R_OK` (= 4) for read access.
   */
  accessSync(path: string, mode: number): void;
}

/**
 * Platform helper used by the probe.
 */
export interface ProbePlatform {
  platform(): NodeJS.Platform;
}

/**
 * Loader for the USB native binding.
 * Returns `true` when the binding is present and functional.
 */
export interface ProbeUsbLoader {
  (): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

const defaultFs: ProbeFs = {
  existsSync: nodefs.existsSync,
  readdirSync: (p) => nodefs.readdirSync(p) as string[],
  accessSync: (p, mode) => nodefs.accessSync(p, mode),
};

const defaultPlatform: ProbePlatform = {
  platform: nodeos.platform,
};

/**
 * Default USB loader: tries to import the `usb` npm package (which bundles
 * its own prebuilt libusb). Returns `true` only when the package loads
 * cleanly — meaning the USB inquiry can actually proceed with no further
 * setup.
 */
const defaultUsbLoader: ProbeUsbLoader = async () => {
  try {
    await loadUsb();
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// macOS SCSI path
// ---------------------------------------------------------------------------

const IPOD_DRIVER_KEXT_PATH = '/System/Library/Extensions/iPodDriver.kext';

function probeMacosScsi(fs: ProbeFs): InquiryMethodAvailability {
  if (fs.existsSync(IPOD_DRIVER_KEXT_PATH)) {
    return { available: true };
  }
  return {
    available: false,
    reason: 'iPodDriver.kext not present — SCSI inquiry unavailable',
  };
}

// ---------------------------------------------------------------------------
// Linux SCSI path
// ---------------------------------------------------------------------------

const SG_DEVICE_RE = /^sg\d+$/;

function probeLinuxScsi(fs: ProbeFs): InquiryMethodAvailability {
  let devEntries: string[];
  try {
    devEntries = fs.readdirSync('/dev');
  } catch {
    return {
      available: false,
      reason:
        'no /dev/sg* nodes present — SCSI inquiry unavailable (no SCSI generic devices on this system)',
    };
  }

  const sgNodes = devEntries.filter((e) => SG_DEVICE_RE.test(e));

  if (sgNodes.length === 0) {
    return {
      available: false,
      reason:
        'no /dev/sg* nodes present — SCSI inquiry unavailable (no SCSI generic devices on this system)',
    };
  }

  // Best-effort readability check: stat the first sg node and inspect mode bits.
  // We don't open it — just check whether the process uid/gid has read access.
  const firstNode = `/dev/${sgNodes[0]}`;
  try {
    fs.accessSync(firstNode, nodefs.constants.R_OK);
    return { available: true };
  } catch {
    return {
      available: false,
      reason: '/dev/sg* present but not readable by current uid (gid plugdev or sudo required)',
    };
  }
}

// ---------------------------------------------------------------------------
// USB probe (shared across platforms)
// ---------------------------------------------------------------------------

async function probeUsb(loadUsb: ProbeUsbLoader): Promise<InquiryMethodAvailability> {
  let available: boolean;
  try {
    available = await loadUsb();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { available: false, reason: `libusb not loadable: ${msg}` };
  }

  if (!available) {
    return { available: false, reason: 'libusb not loadable' };
  }

  return { available: true };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cached: InquiryMethodsAvailability | undefined;

/**
 * Clear the cached probe result.
 *
 * Intended for use in tests only. In production the cache is never cleared —
 * method availability is stable within a process lifetime.
 */
export function clearProbeCache(): void {
  cached = undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Options for `probeInquiryMethods`. All fields are optional; defaults use
 * real filesystem, `os.platform()`, and a `usb` npm dynamic import.
 *
 * Pass fakes here in unit tests to avoid touching real FS or native bindings.
 */
export interface ProbeOptions {
  fs?: ProbeFs;
  platform?: ProbePlatform;
  loadUsb?: ProbeUsbLoader;
}

/**
 * Probe the current system to determine which firmware inquiry methods
 * are available.
 *
 * Results are cached after the first call (per `ProbeOptions` combination is
 * NOT separately cached — the cache is module-scoped). If you pass custom
 * injected helpers (e.g. in tests), call `clearProbeCache()` between cases.
 *
 * @param opts - Injectable helpers for FS, platform, and USB loader.
 * @returns Availability status for each inquiry method.
 */
export async function probeInquiryMethods(
  opts?: ProbeOptions
): Promise<InquiryMethodsAvailability> {
  // Return cached result when no overrides are given (production path).
  if (!opts && cached) {
    return cached;
  }

  const fs = opts?.fs ?? defaultFs;
  const platform = opts?.platform ?? defaultPlatform;
  const loadUsb = opts?.loadUsb ?? defaultUsbLoader;

  const plat = platform.platform();

  let scsi: InquiryMethodAvailability;

  if (plat === 'darwin') {
    scsi = probeMacosScsi(fs);
  } else if (plat === 'linux') {
    scsi = probeLinuxScsi(fs);
  } else {
    scsi = {
      available: false,
      reason: 'SCSI inquiry not implemented on this platform',
    };
  }

  const usb = await probeUsb(loadUsb);

  const result: InquiryMethodsAvailability = { scsi, usb };

  // Only cache when using default (production) helpers.
  if (!opts) {
    cached = result;
  }

  return result;
}
