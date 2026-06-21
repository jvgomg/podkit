/**
 * Combined confirmation + firmware-inquiry runner for `podkit device add`.
 *
 * Collapses two byte-equivalent blocks from device/add.ts (path-branch
 * 780-830 and scan-branch 1242-1295) into a single helper.
 *
 * The block decides whether to offer reading SysInfoExtended over USB,
 * prompts the user for combined confirmation, and runs the actual inquiry
 * through the core helper. Tier gating lives in the caller: M4 only emits
 * `prompt-write-sie` (which reaches this helper) in the verify tier, so the
 * helper no longer consults a per-call opt-out flag.
 *
 * Returns a discriminated result:
 *  - `{ proceed: false }` — the user declined the prompt; caller should
 *    return early (the "Cancelled" message is already printed).
 *  - `{ proceed: true, ... }` — caller proceeds with persistence.
 *    `assessment` may have been updated by the inquiry's re-assess
 *    step; `firmwareWritten` reports whether SIE was actually written.
 */

import type { IpodIdentityAssessment } from '@podkit/core';
import { ensureSysInfoExtendedAndReassess } from '@podkit/core';
import type { OutputContext } from '../../output/index.js';
import { SYSINFO_MISSING_PROMPT_LINES } from './add-render.js';

export interface OfferFirmwareInquiryDeps {
  assessIdentity?: typeof import('@podkit/core').assessIpodIdentity;
  ensureSysInfoExtended?: typeof import('@podkit/core').ensureSysInfoExtended;
  /**
   * Test seam — override the inquiry-runner so unit tests don't have to
   * stub both `assessIdentity` and `ensureSysInfoExtended` to control
   * the outcome. Production uses `ensureSysInfoExtendedAndReassess`
   * from `@podkit/core`.
   */
  runInquiry?: typeof ensureSysInfoExtendedAndReassess;
}

export interface OfferFirmwareInquiryArgs {
  /** Cascade-derived identity assessment. May be null on the scan branch when the cascade resolved nothing. */
  assessment: IpodIdentityAssessment | null;
  /** `--yes` mode: skip the interactive prompt entirely. */
  autoConfirm: boolean;
  /** `true` when the user has already acknowledged the device is unsupported. SIE write is skipped in that case. */
  recordUnsupported: boolean;
  /** Where the user-visible prompt + warnings render. */
  out: OutputContext;
  /** Device name being added; embedded in the prompt copy. */
  name: string;
  /** Mount point passed to the inquiry helper. */
  mountPoint: string;
  /** Function used to ask the user yes/no. Injected so tests can stub. */
  confirmFn: (message: string) => Promise<boolean>;
  /** Optional core overrides forwarded to `ensureSysInfoExtendedAndReassess`. */
  deps?: OfferFirmwareInquiryDeps;
}

export type FirmwareInquiryResult =
  | { proceed: false }
  | {
      proceed: true;
      /** Possibly-updated assessment (after a successful inquiry → re-assess). */
      assessment: IpodIdentityAssessment | null;
      /** Whether SysInfoExtended was actually written by this call. */
      firmwareWritten: boolean;
    };

export async function offerFirmwareInquiry(
  args: OfferFirmwareInquiryArgs
): Promise<FirmwareInquiryResult> {
  const { autoConfirm, recordUnsupported, out, name, mountPoint, confirmFn } = args;
  let assessment = args.assessment;

  const offer = !!assessment && assessment.firmwareInquiry === 'missing' && !recordUnsupported;

  if (!autoConfirm && out.isText) {
    if (offer) {
      out.newline();
      for (const line of SYSINFO_MISSING_PROMPT_LINES) out.print(line);
      out.newline();
    } else {
      out.newline();
    }
    const promptText = offer
      ? `Add this iPod as "${name}" and write SysInfoExtended?`
      : `Add this iPod as "${name}"?`;
    const shouldSave = await confirmFn(promptText);
    if (!shouldSave) {
      out.print('Cancelled. No changes made.');
      return { proceed: false };
    }
  }

  let firmwareWritten = false;
  if (offer && assessment) {
    const runInquiry = args.deps?.runInquiry ?? ensureSysInfoExtendedAndReassess;
    const r = await runInquiry(mountPoint, assessment, {
      assessIdentity: args.deps?.assessIdentity,
      ensureSysInfoExtended: args.deps?.ensureSysInfoExtended,
    });
    assessment = r.assessment;
    firmwareWritten = r.firmwareWritten;
    if (r.sysInfoWriteError && out.isText) {
      out.warn(`Failed to read SysInfoExtended from USB: ${r.sysInfoWriteError}`);
      out.print('  Run `podkit doctor --repair sysinfo-extended` to retry.');
    }
  }

  return { proceed: true, assessment, firmwareWritten };
}
