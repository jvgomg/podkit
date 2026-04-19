/**
 * Device assessment types and iFlash detection logic
 *
 * Provides structured pre-mount analysis of iPod device characteristics.
 * Used to generate informative diagnostics when devices cannot be
 * automatically mounted by the operating system.
 */

/**
 * A piece of evidence contributing to an iFlash storage determination.
 * Each signal is independently observable from OS-level device data
 * before the volume is mounted.
 */
export interface IFlashEvidence {
  /** Short signal name suitable for display (e.g., "2048-byte block size") */
  signal: string;
  /** Human-readable explanation of why this signal indicates iFlash */
  detail: string;
  /** The observed value that triggered this signal (e.g., "2048 bytes/block") */
  value: string;
}

/**
 * Result of iFlash storage detection.
 *
 * `confirmed` is true when at least one signal is present. Multiple
 * independent signals strengthen confidence. The `evidence` array is
 * always populated with all detected signals so callers can present
 * specific reasons to users.
 */
export interface IFlashAssessment {
  /** Whether iFlash storage is confirmed by one or more signals */
  confirmed: boolean;
  /** All signals that contributed to the conclusion, in detection order */
  evidence: IFlashEvidence[];
}

/**
 * USB device identity gathered from the host OS USB subsystem.
 * Available before mounting and independent of the filesystem.
 */
export interface UsbDeviceInfo {
  /** USB product ID in normalised hex (e.g., "0x1209") */
  productId: string;
  /** USB vendor ID in normalised hex (e.g., "0x05ac") */
  vendorId: string;
  /** Resolved human-readable model name if the product ID is known */
  modelName?: string;
  /** USB serial number (= FirewireGuid for iPods, 16 hex chars) */
  serialNumber?: string;
  /** USB bus number (for libusb device addressing) */
  busNumber?: number;
  /** USB device address (for libusb device addressing) */
  deviceAddress?: number;
}

/**
 * Pre-mount assessment of a detected iPod device.
 *
 * Combines raw OS-level disk data with USB identity and interpreted
 * analysis (iFlash detection). Constructed by platform implementations
 * and consumed by CLI layers to display diagnostics and choose mount
 * strategies.
 */
export interface DeviceAssessment {
  /** Disk partition identifier (e.g., "disk5s2" on macOS) */
  diskIdentifier: string;
  /** Volume name as reported by the OS (e.g., "TERAPOD") */
  volumeName: string;
  /** Volume UUID for persistent identification */
  volumeUuid?: string;
  /** Total device size in bytes */
  sizeBytes: number;
  /**
   * Physical block size in bytes reported by the OS.
   * Standard iPod hard drives: 512. iFlash adapters: 2048.
   */
  blockSizeBytes: number;
  /** Whether the volume is currently mounted */
  isMounted: boolean;
  /** Mount point path if currently mounted */
  mountPoint?: string;
  /** USB subsystem identity, if available on this platform */
  usb?: UsbDeviceInfo;
  /** iFlash storage analysis derived from disk and USB characteristics */
  iFlash: IFlashAssessment;
}

// ---------------------------------------------------------------------------
// iFlash detection
// ---------------------------------------------------------------------------

/**
 * Maximum storage capacity of any unmodified iPod, in bytes.
 * The iPod Classic 7th generation (Late 2009) shipped with 160 GB.
 * Any device reporting higher capacity must use third-party flash storage.
 */
const ORIGINAL_IPOD_MAX_BYTES = 160 * 1024 * 1024 * 1024;

/**
 * Detect iFlash storage from raw device characteristics.
 *
 * Analyses the OS-reported block size and disk capacity against
 * known iFlash signatures. Each confirmed signal is recorded with
 * a human-readable explanation so callers can present specific
 * reasons to users.
 *
 * This is a pure function — it does not perform any OS calls.
 *
 * @param sizeBytes - Total device size in bytes (from diskutil)
 * @param blockSizeBytes - Physical block size in bytes (from diskutil)
 */
export function detectIFlash(sizeBytes: number, blockSizeBytes: number): IFlashAssessment {
  const evidence: IFlashEvidence[] = [];

  // Signal 1: non-standard block size
  // iFlash adapters emulate optical media, reporting 2048-byte sectors.
  // Standard iPod hard drives (Toshiba 1.8" spindles) use 512-byte sectors.
  // This is a hardware-level characteristic detectable without mounting.
  if (blockSizeBytes === 2048) {
    evidence.push({
      signal: '2048-byte block size',
      detail:
        'iFlash adapters emulate optical media sectors (2048 bytes per block). ' +
        'Standard iPod hard drives use 512-byte sectors.',
      value: '2048 bytes/block',
    });
  }

  // Signal 2: capacity exceeds original iPod maximum
  // No unmodified iPod shipped with more than 160 GB. Any larger
  // capacity confirms third-party flash storage.
  if (sizeBytes > ORIGINAL_IPOD_MAX_BYTES) {
    const gb = Math.round(sizeBytes / (1024 * 1024 * 1024));
    evidence.push({
      signal: 'Capacity exceeds iPod Classic maximum',
      detail:
        'The largest original iPod Classic shipped with 160 GB. ' +
        'Greater capacity indicates third-party flash storage (iFlash or similar).',
      value: `${gb} GB (original maximum: 160 GB)`,
    });
  }

  return {
    confirmed: evidence.length > 0,
    evidence,
  };
}
