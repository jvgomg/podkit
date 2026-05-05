/**
 * @deprecated The iPod generation tables, model lookups, and identification
 * functions have moved to `@podkit/devices-ipod`. Import directly from
 * `@podkit/devices-ipod` for new code. This shim re-exports the full public
 * API for one release; it will be removed in TASK-295.05 (P4).
 *
 * Moved symbols:
 * - Types: IpodChecksumType, IpodGenerationId, IpodGeneration,
 *          IpodModelVariant, IpodModel, IpodModelSource, IpodModelInput
 * - Lookups: lookupIpodModel, lookupIpodModelByNumber, lookupIpodModelBySerial,
 *            lookupGenerationByProductId, getGenerationInfo, getChecksumType,
 *            getChecksumTypeByModelNumber, lookupGenerationByModelNumber,
 *            toLibgpodGeneration
 * - Identity: resolveIpodModel (alias for identify())
 *
 * @module
 */

export type {
  IpodChecksumType,
  IpodGenerationId,
  IpodGeneration,
  IpodModelVariant,
  IpodModel,
  IpodModelSource,
  IpodModelInput,
} from '@podkit/devices-ipod';

export {
  lookupIpodModel,
  lookupIpodModelByNumber,
  lookupIpodModelBySerial,
  lookupGenerationByProductId,
  getGenerationInfo,
  getChecksumType,
  getChecksumTypeByModelNumber,
  lookupGenerationByModelNumber,
  toLibgpodGeneration,
  resolveIpodModel,
} from '@podkit/devices-ipod';
