/**
 * @podkit/ipod-firmware — iPod firmware inquiry (SCSI + USB delivery)
 *
 * Public surface for the ipod-firmware package. The orchestrator
 * (`inquireFirmware`) is the deep entry point most callers want; the
 * transports, probe, and parser are exported for diagnostics, testing,
 * and downstream extraction in P3+.
 *
 * @module
 */

// Inquiry orchestrator
export {
  inquireFirmware,
  type ScsiTransport,
  type UsbTransport,
  type InquireOptions,
} from './inquiry/orchestrator.js';

// SCSI transport
export {
  scsiReadVpdPages,
  readAllVpdSubpages,
  type ScsiReadOptions,
} from './inquiry/scsi/index.js';
export {
  ScsiError,
  errnoToKind,
  type ScsiErrorKind,
  type ScsiErrorFields,
} from './inquiry/scsi/errors.js';
export {
  parseSenseData,
  buildVpdCdb,
  readVpdPageLength,
  type ScsiSenseData,
  type ScsiSyscall,
  type ScsiSyscallResult,
} from './inquiry/scsi/types.js';

// USB transport (transitional shim over libgpod-node)
export { readUsbInquiry, type UsbReadOptions, type LibgpodReader } from './inquiry/usb.js';

// Method availability probe
export {
  probeInquiryMethods,
  clearProbeCache,
  type InquiryMethodAvailability,
  type InquiryMethodsAvailability,
  type ProbeFs,
  type ProbePlatform,
  type ProbeUsbLoader,
  type ProbeOptions,
} from './inquiry/probe.js';

// Plist parser
export {
  parsePlist,
  type PlistValue,
  type PlistDict,
  type PlistArray,
  type PlistString,
  type PlistInteger,
  type PlistData,
  type PlistBoolean,
  type PlistReal,
} from './plist/parser.js';

// Diagnostic checks live in @podkit/core (see TASK-292.09 — DiagnosticCheck
// type carries deep core dependencies, so checks are registered in core and
// consume this package's `probeInquiryMethods` / `inquireFirmware` primitives.
