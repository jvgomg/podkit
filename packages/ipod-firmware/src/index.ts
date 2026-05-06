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
  type TransportOptions,
} from './inquiry/orchestrator.js';

// Transport selection (pure planning function)
export { chooseTransports, type SelectionPlan } from './inquiry/selection.js';

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

// USB transport (libusb-1.0 via koffi FFI)
export {
  readUsbInquiry,
  loadLibusb,
  UsbInquiryError,
  type UsbReadOptions,
  type LibusbBinding,
  type LibusbPtr,
  type LibusbLoadResult,
  type UsbInquiryErrorKind,
} from './inquiry/usb.js';

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

// Firmware extraction
export { extractFromPlist, bigintToFireWireGuid } from './firmware/extract.js';

// Diagnostic primitives — pure functions consumed by core's check registry.
// Diagnostic check objects themselves live in @podkit/core because the
// DiagnosticCheck type has deep core dependencies (see TASK-292.09).
export {
  compareSysInfoConsistency,
  normaliseFireWireGuid,
  type SysInfoConsistencyStatus,
  type SysInfoConsistencyResult,
} from './diagnostics/sysinfo-consistency.js';

// SysInfoExtended file I/O — moved from @podkit/core in P4 (TASK-295.01)
export {
  readSysInfoExtended,
  writeSysInfoExtended,
  ensureSysInfoExtended,
  SYSINFO_EXTENDED_PATH,
  SYSINFO_DEVICE_DIR,
  type SysInfoExtendedResult,
  type UsbDeviceAddress,
  type ReadFromUsbFn,
  type ModelResolver,
} from './sysinfo/index.js';
