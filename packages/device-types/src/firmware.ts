/**
 * Firmware capability types
 *
 * Structured representation of the iPod's SysInfoExtended plist, which
 * describes the device's hardware capabilities. Obtained via USB or SCSI
 * inquiry by `@podkit/ipod-firmware`.
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Structured capability data extracted from SysInfoExtended.
 * All fields beyond `audioCodecs` and `familyId` are optional — older firmware
 * versions may omit them.
 */
export type FirmwareCapabilities = {
  /** Audio codecs supported natively by the device */
  audioCodecs: { codec: string; sampleRates?: number[]; bitDepths?: number[] }[];
  /** Video codecs supported natively by the device */
  videoCodecs?: {
    codec: string;
    profile?: string;
    level?: string;
    maxResolution?: string;
    maxBitrate?: number;
  }[];
  /** Artwork formats supported by the device (iTunesDB artwork database) */
  artworkFormats?: { formatId: number; width: number; height: number; pixelFormat?: string }[];
  /** Album art formats (may differ from artworkFormats on some generations) */
  albumArtFormats?: { formatId: number; width: number; height: number; pixelFormat?: string }[];
  /** iPod family identifier — used for generation/model resolution */
  familyId: number;
  /** iTunesDB schema version the device expects */
  dbVersion?: number;
  /** Human-readable firmware version string */
  firmwareVersion?: string;
  /** Device RAM in bytes */
  ramBytes?: number;
};

/**
 * Parsed result of a SysInfoExtended inquiry.
 * The `capabilities` field is populated when the XML payload is successfully
 * extracted and decoded. It may be absent if extraction fails (e.g. the
 * firmware does not include a SysInfoExtended response for this device).
 */
export type ParsedFirmware = {
  /** FireWire GUID that uniquely identifies this iPod unit */
  firewireGuid: string;
  /** Device serial number */
  serialNumber: string;
  /** Raw SysInfoExtended XML payload */
  rawXml: string;
  /** Structured capabilities — populated when extraction succeeds */
  capabilities?: FirmwareCapabilities;
};
