/**
 * Inquiry transport selection
 *
 * Pure function that maps a {@link InquiryMethodsAvailability} into a
 * {@link SelectionPlan} the orchestrator can dispatch on.
 *
 * Kept separate from `orchestrator.ts` so the matrix of availability →
 * plan mappings can be tested in isolation, without spinning up mock
 * transports or fixtures. The orchestrator itself only needs to handle
 * the four resulting plan branches.
 *
 * @module
 */

import type { InquiryMethodsAvailability } from './probe.js';

/**
 * The set of execution plans the orchestrator can carry out.
 *
 * - `usb-only` — only USB inquiry is available; SCSI is not probed-available.
 * - `scsi-only` — only SCSI inquiry is available; USB is not.
 * - `usb-then-scsi` — both available. USB attempted first; SCSI is the fallback
 *   if the USB transport throws (NOT if the bytes parse but identity extraction
 *   fails — see orchestrator TSDoc).
 * - `none` — neither method is available; orchestrator should return `null`.
 */
export type SelectionPlan = 'usb-only' | 'scsi-only' | 'usb-then-scsi' | 'none';

/**
 * Pick a {@link SelectionPlan} given the result of {@link probeInquiryMethods}.
 *
 * USB is preferred when both transports are available because USB inquiry
 * returns richer data on nano 5G and later devices (full video codec list,
 * `ImageSpecifications2`, etc.) than the SCSI VPD path returns for the same
 * hardware. SCSI remains a valid fallback for older devices and for systems
 * where the libusb binding cannot be loaded.
 */
export function chooseTransports(availability: InquiryMethodsAvailability): SelectionPlan {
  if (availability.usb.available && availability.scsi.available) return 'usb-then-scsi';
  if (availability.usb.available) return 'usb-only';
  if (availability.scsi.available) return 'scsi-only';
  return 'none';
}
