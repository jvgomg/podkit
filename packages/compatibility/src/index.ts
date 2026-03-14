/**
 * iPod model compatibility data.
 *
 * Single source of truth for model capabilities, checksum types,
 * and test verification status. Consumed by E2E tests and docs site.
 *
 * @packageDocumentation
 */

// Types
export type {
  ChecksumType,
  ConfidenceLevel,
  ModelFeatures,
  ModelEntry,
  GenerationInfo,
  RealDeviceReport,
  IpodGeneration,
} from './types';

// Data
export { MODEL_MATRIX } from './models';
export { GENERATION_INFO } from './generations';
export { REAL_DEVICE_REPORTS } from './real-devices';

// Helpers
export {
  TESTABLE_MODELS,
  UNTESTABLE_MODELS,
  getModelByGeneration,
  getModelsByChecksumType,
  getGenerationInfo,
  getGenerationsByConfidence,
} from './helpers';
