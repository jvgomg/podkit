import type { IpodGeneration } from '@podkit/libgpod-node';
import type { ModelEntry, ChecksumType, GenerationInfo } from './types';
import { MODEL_MATRIX } from './models';
import { GENERATION_INFO } from './generations';

/** Models that can be tested with dummy iPod databases. */
export const TESTABLE_MODELS = MODEL_MATRIX.filter((m) => m.canCreateDummy);

/** Models that cannot be tested (need real hardware or workaround). */
export const UNTESTABLE_MODELS = MODEL_MATRIX.filter((m) => !m.canCreateDummy);

/** Get a model entry by generation. */
export function getModelByGeneration(generation: IpodGeneration): ModelEntry | undefined {
  return MODEL_MATRIX.find((m) => m.generation === generation);
}

/** Get all models with a specific checksum type. */
export function getModelsByChecksumType(type: ChecksumType): ModelEntry[] {
  return MODEL_MATRIX.filter((m) => m.checksumType === type);
}

/** Get generation info by generation identifier. */
export function getGenerationInfo(generation: IpodGeneration): GenerationInfo | undefined {
  return GENERATION_INFO.find((g) => g.generation === generation);
}

/** Get all generations at a given confidence level. */
export function getGenerationsByConfidence(confidence: 'verified' | 'simulated' | 'expected'): GenerationInfo[] {
  return GENERATION_INFO.filter((g) => g.confidence === confidence);
}
