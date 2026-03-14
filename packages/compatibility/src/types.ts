import type { IpodGeneration } from '@podkit/libgpod-node';

/**
 * Type of checksum required by the iPod model.
 * - 'none': No checksum (1st-4th gen, Photo, Video, Mini, Nano 1-2, Shuffle 1-2)
 * - 'hash58': HMAC-SHA1 checksum (Classic 1-3, Nano 3-4)
 * - 'hash72': AES-based checksum with HashInfo file (Nano 5)
 */
export type ChecksumType = 'none' | 'hash58' | 'hash72';

/**
 * Confidence level for device compatibility.
 * - 'verified': Confirmed with real hardware
 * - 'simulated': Has automated E2E test coverage (simulated database)
 * - 'expected': Should work based on libgpod support, no test yet
 */
export type ConfidenceLevel = 'verified' | 'simulated' | 'expected';

/**
 * Feature capabilities for an iPod model.
 */
export interface ModelFeatures {
  music: boolean;
  artwork: boolean;
  video: boolean;
  playlists: boolean;
}

/**
 * A single entry in the model compatibility matrix.
 */
export interface ModelEntry {
  /** Full Apple model number (e.g., 'MA147') */
  modelNumber: string;
  /** Human-readable name (e.g., 'iPod Video 60GB (5th Gen)') */
  name: string;
  /** libgpod generation identifier */
  generation: IpodGeneration;
  /** Feature capabilities */
  features: ModelFeatures;
  /** Checksum type required by this model */
  checksumType: ChecksumType;
  /** Whether a dummy database can be created for E2E testing */
  canCreateDummy: boolean;
}

/**
 * Per-generation summary information.
 */
export interface GenerationInfo {
  /** libgpod generation identifier */
  generation: IpodGeneration;
  /** Human-readable display name (e.g., 'iPod Video (5th Gen)') */
  displayName: string;
  /** All known model numbers for this generation */
  models: string[];
  /** Feature capabilities (shared across generation) */
  features: ModelFeatures;
  /** Checksum type required */
  checksumType: ChecksumType;
  /** Overall confidence level for this generation */
  confidence: ConfidenceLevel;
}

/**
 * A record of real hardware confirmation.
 */
export interface RealDeviceReport {
  /** libgpod generation identifier */
  generation: IpodGeneration;
  /** Model number tested */
  modelNumber: string;
  /** Who confirmed the test */
  confirmedBy: string;
  /** Date of confirmation (ISO 8601) */
  date: string;
  /** Optional notes about the test */
  notes?: string;
}

export type { IpodGeneration };
