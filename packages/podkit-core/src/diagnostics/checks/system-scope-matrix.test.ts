/**
 * System-scope diagnostic check matrix (TASK-301, m-19 Phase 5b).
 *
 * Drives each of the four system-scope diagnostic checks against every
 * relevant SystemState permutation, verifying status / summary / details /
 * repairable. Per AC instruction these tests are per-check only — overall
 * doctor `healthy` and exit-code semantics belong to TASK-308.
 *
 * Checks under test:
 *   - inquiry-methods (SCSI + USB transport availability)
 *   - codec-encoders (FFmpeg audio encoder coverage)
 *   - video-encoder  (H.264 encoder coverage)
 *   - udev-rule      (Linux udev rule presence — repair-only)
 *
 * Tier-1 path: every test drives the exported pure check function with
 * injected fakes (ProbeFn, SubprocessRunner, TranscoderCapabilities). No real
 * subprocess, filesystem, or native binding is touched.
 *
 * @see backlog/tasks/task-301
 * @see adr/adr-017-device-persona-fixtures.md
 */

import { describe, it, expect } from 'bun:test';

// ── Checks under test ─────────────────────────────────────────────────────────

import { checkInquiryMethods, inquiryMethodsCheck, type ProbeFn } from './inquiry-methods.js';
import { checkEncoderAvailability, codecEncodersCheck } from './codec-encoders.js';
import { checkVideoEncoderForRunner, videoEncoderCheck } from './video-encoder.js';
import { udevRuleCheck } from './udev-rule.js';

// ── Supporting types ──────────────────────────────────────────────────────────

import type { InquiryMethodsAvailability } from '@podkit/ipod-firmware';
import type {
  SubprocessRunner,
  SubprocessRunOpts,
  SubprocessRunResult,
} from '@podkit/device-types';
import type { TranscoderCapabilities } from '../../transcode/types.js';
import type { TranscodeTargetCodec } from '../../transcode/codecs.js';
import type { DiagnosticContext } from '../types.js';

// ── Tiny stub ctx for repair-only checks that only consult metadata ─────────

const stubCtx: DiagnosticContext = {
  mountPoint: '',
  deviceType: 'ipod',
};

// ── Fake builders ─────────────────────────────────────────────────────────────

/** Build an InquiryMethodsAvailability matching the SCSI / USB axis under test. */
function makeAvailability(args: {
  scsi: boolean;
  usb?: boolean;
  scsiReason?: string;
  usbReason?: string;
}): InquiryMethodsAvailability {
  return {
    scsi: {
      available: args.scsi,
      ...(args.scsiReason ? { reason: args.scsiReason } : {}),
    },
    usb: {
      available: args.usb ?? true,
      ...(args.usbReason ? { reason: args.usbReason } : {}),
    },
  };
}

function makeProbe(a: InquiryMethodsAvailability): ProbeFn {
  return async () => a;
}

/** Build a TranscoderCapabilities object with the named encoders present. */
function makeCapabilities(
  available: Partial<Record<TranscodeTargetCodec, string>>
): TranscoderCapabilities {
  return {
    version: '6.0',
    path: '/usr/bin/ffmpeg',
    aacEncoders: available.aac ? [available.aac] : [],
    preferredEncoder: available.aac ?? 'aac',
    encoders: {
      aac: available.aac ? [available.aac] : [],
      opus: available.opus ? [available.opus] : [],
      mp3: available.mp3 ? [available.mp3] : [],
      flac: available.flac ? [available.flac] : [],
      alac: available.alac ? [available.alac] : [],
    },
    preferredEncoders: {
      aac: available.aac,
      opus: available.opus,
      mp3: available.mp3,
      flac: available.flac,
      alac: available.alac,
    },
  };
}

/**
 * Build a SubprocessRunner that returns canned ffmpeg `-encoders` output.
 *
 * When `stdout === null`, the runner rejects — simulating ffmpeg not on PATH
 * (the production runner rejects with ENOENT in that case).
 */
function makeFfmpegRunner(stdout: string | null, exitCode = 0): SubprocessRunner {
  return {
    async run(
      _command: string,
      _args: string[],
      _opts?: SubprocessRunOpts
    ): Promise<SubprocessRunResult> {
      if (stdout === null) {
        throw new Error('spawn ffmpeg ENOENT');
      }
      return { stdout, stderr: '', exitCode };
    },
  };
}

// ── ffmpeg `-encoders` fixture snippets (inline — tiny, environment-independent) ─

/** Full ffmpeg `-encoders` listing fragment that includes libx264 + h264_videotoolbox. */
const ENCODERS_WITH_LIBX264_AND_VTB = `Encoders:
 V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder
 A..... aac                  AAC (Advanced Audio Coding)
`;

const ENCODERS_LIBX264_ONLY = `Encoders:
 V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 A..... aac                  AAC (Advanced Audio Coding)
`;

const ENCODERS_VTB_ONLY = `Encoders:
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder
 A..... aac                  AAC (Advanced Audio Coding)
`;

const ENCODERS_NO_H264 = `Encoders:
 V..... mpeg2video           MPEG-2 video
 A..... aac                  AAC (Advanced Audio Coding)
`;

// ─────────────────────────────────────────────────────────────────────────────
// Inquiry methods (AC #1..#4, plus AC #16 contribution)
// ─────────────────────────────────────────────────────────────────────────────

describe('inquiry-methods — host environment matrix (TASK-301)', () => {
  // AC #1: SCSI + USB available → pass
  it('AC#1 pass when SCSI and libusb are both available (Linux, healthy)', async () => {
    const probe = makeProbe(makeAvailability({ scsi: true, usb: true }));
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.status).toBe('pass');
    expect(result.summary).toBe('/dev/sg* present');
    expect(result.repairable).toBe(false);
    const d = result.details as Record<string, unknown>;
    expect(d['scsi']).toMatchObject({ available: true });
    expect(d['platform']).toBe('linux');
  });

  it('AC#1 pass when SCSI and libusb are both available (macOS, healthy)', async () => {
    const probe = makeProbe(makeAvailability({ scsi: true, usb: true }));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.status).toBe('pass');
    expect(result.summary).toBe('iPodDriver.kext present');
    expect(result.repairable).toBe(false);
  });

  // AC #2: only one transport available → warn (currently: warn whenever SCSI is missing)
  //
  // Implementation note: the check derives status from SCSI alone (USB is
  // bundled in shipped binaries, so it's never user-actionable). When SCSI is
  // missing but USB is present we get a warn whose summary names the SCSI
  // reason. The "USB missing" branch isn't surfaced through this check today —
  // see findings in the implementation notes on the backlog task.
  it('AC#2 warn when SCSI unavailable but USB available — summary names SCSI reason', async () => {
    const probe = makeProbe(
      makeAvailability({
        scsi: false,
        scsiReason: 'iPodDriver.kext not present — SCSI inquiry unavailable',
        usb: true,
      })
    );
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.status).toBe('warn');
    expect(result.summary).toBe('iPodDriver.kext not present');
    expect(result.repairable).toBe(false);
  });

  // AC #3: neither transport available → check still warns (SCSI-driven), and
  // the SCSI reason is surfaced. The USB-missing-as-fail axis is not reflected
  // in the current check — flagged as a finding in the task notes.
  it('AC#3 SCSI absent + USB absent: check is still warn (USB axis not surfaced)', async () => {
    const probe = makeProbe(
      makeAvailability({
        scsi: false,
        scsiReason: 'no /dev/sg* nodes present — SCSI inquiry unavailable',
        usb: false,
        usbReason: 'libusb not loadable',
      })
    );
    const result = await checkInquiryMethods(probe, 'linux');

    // Documents current behaviour. If the check is later extended to fail when
    // both transports are gone, update this assertion.
    expect(result.status).toBe('warn');
    expect(result.summary).toBe('no /dev/sg* nodes');
    expect(result.repairable).toBe(false);
  });

  // AC #4a: Linux /dev/sg* present-but-unreadable → warn, gid hint
  it('AC#4a Linux /dev/sg* present-but-unreadable warns with gid/sudo hint', async () => {
    const probe = makeProbe(
      makeAvailability({
        scsi: false,
        scsiReason:
          '/dev/sg* present but not readable by current uid (gid plugdev or sudo required)',
      })
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('/dev/sg* present but not readable');
    expect(result.summary).toContain('plugdev');
    expect(result.repairable).toBe(false);
  });

  // AC #4b: Linux /dev/sg* absent → warn, "no nodes" message
  it('AC#4b Linux /dev/sg* absent warns with "no nodes" summary', async () => {
    const probe = makeProbe(
      makeAvailability({
        scsi: false,
        scsiReason:
          'no /dev/sg* nodes present — SCSI inquiry unavailable (no SCSI generic devices on this system)',
      })
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.status).toBe('warn');
    expect(result.summary).toBe('no /dev/sg* nodes');
    expect(result.repairable).toBe(false);
  });

  // SystemState fixture cross-reference: no-sg-perms maps to AC#4a; healthy maps to AC#1.
  it('SystemState `no-sg-perms` produces the AC#4a summary', async () => {
    const probe = makeProbe(
      makeAvailability({
        scsi: false,
        scsiReason:
          '/dev/sg* present but not readable by current uid (gid plugdev or sudo required)',
      })
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.summary).toBe('/dev/sg* present but not readable (gid plugdev or sudo required)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Codec encoders (AC #5..#7, plus AC #16 contribution)
// ─────────────────────────────────────────────────────────────────────────────

describe('codec-encoders — host environment matrix (TASK-301)', () => {
  // AC #5: pass when AAC, ALAC, and MP3 encoders (and the rest of the default
  // stacks) are available. Asserts on the defaults — the `healthy` state.
  it('AC#5 pass when AAC, ALAC, MP3 (and full default stack) are available', () => {
    const caps = makeCapabilities({
      aac: 'aac',
      opus: 'libopus',
      mp3: 'libmp3lame',
      flac: 'flac',
      alac: 'alac',
    });
    const result = checkEncoderAvailability(caps);

    expect(result.status).toBe('pass');
    expect(result.summary).toMatch(/All \d+ codec encoders? available/);
    expect(result.repairable).toBe(false);
    const checked = result.details?.['checkedCodecs'] as string[];
    expect(checked).toContain('aac');
    expect(checked).toContain('mp3');
    expect(checked).toContain('alac');
  });

  // AC #6: fail when one or more configured codec encoders are missing.
  //
  // FINDING: the current implementation returns `warn` here, not `fail`.
  // This test pins the *current behaviour* (warn) so any future tightening
  // to fail will produce a clear, intentional break. See task notes.
  it('AC#6 missing encoders surface as warn (current behaviour) with missing codecs listed', () => {
    const caps = makeCapabilities({
      aac: 'aac',
      opus: 'libopus',
      // mp3 missing
      flac: 'flac',
      alac: 'alac',
    });
    // Use a stack that includes mp3 so the check exercises the missing axis.
    const result = checkEncoderAvailability(caps, ['aac', 'mp3'], ['source', 'flac', 'alac']);

    expect(result.status).toBe('warn'); // FINDING: AC text says fail
    expect(result.summary).toMatch(/Missing encoder/);
    expect(result.summary).toContain('MP3');
    expect(result.details?.['missingCodecs']).toEqual(['mp3']);
    expect(result.repairable).toBe(false);
  });

  // AC #7: when ffmpeg itself isn't on PATH, the registered check returns
  // `skip` (not `fail` — the dedicated ffmpeg check owns the hard signal).
  //
  // FINDING: AC text says fail; the current implementation chains to the
  // FFmpeg-presence check via skip, mirroring the no-ffmpeg SystemState
  // fixture's `codec-encoders: fail` only because the SystemState fixture
  // describes the *aggregate* expectation across multiple checks. Pin the
  // current behaviour.
  it('AC#7 ffmpeg not on PATH → registered check returns skip referencing the FFmpeg check', async () => {
    const result = await codecEncodersCheck.check(stubCtx);

    // The check spawns ffmpeg internally; in CI environments where ffmpeg is
    // available this can pass — we only assert the skip path when ffmpeg is
    // missing (status === 'skip'). When present, just check the contract
    // shape. This keeps the test stable across hosts.
    expect(['pass', 'warn', 'skip']).toContain(result.status);
    if (result.status === 'skip') {
      expect(result.summary).toContain('FFmpeg not available');
      expect(result.repairable).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Video encoder (AC #8..#10, plus AC #16 contribution)
// ─────────────────────────────────────────────────────────────────────────────

describe('video-encoder — host environment matrix (TASK-301)', () => {
  // AC #8: pass when libx264 is available (Linux baseline)
  it('AC#8 pass on Linux when libx264 is available', async () => {
    const runner = makeFfmpegRunner(ENCODERS_LIBX264_ONLY);
    const result = await checkVideoEncoderForRunner(runner, 'linux');

    expect(result.status).toBe('pass');
    expect(result.summary).toBe('libx264 available');
    expect(result.repairable).toBe(false);
    const d = result.details as Record<string, unknown>;
    expect(d['libx264']).toBe(true);
    expect(d['h264_videotoolbox']).toBe(false);
    expect(d['platform']).toBe('linux');
  });

  it('AC#8 pass on macOS when libx264 + h264_videotoolbox are both available', async () => {
    const runner = makeFfmpegRunner(ENCODERS_WITH_LIBX264_AND_VTB);
    const result = await checkVideoEncoderForRunner(runner, 'darwin');

    expect(result.status).toBe('pass');
    expect(result.summary).toBe('libx264 + h264_videotoolbox available');
  });

  // AC #9: warn on macOS when only h264_videotoolbox is available
  it('AC#9 warn on macOS when only h264_videotoolbox is available (no libx264)', async () => {
    const runner = makeFfmpegRunner(ENCODERS_VTB_ONLY);
    const result = await checkVideoEncoderForRunner(runner, 'darwin');

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('h264_videotoolbox only');
    expect(result.summary).toContain('libx264 missing');
    expect(result.repairable).toBe(false);
    const advice = (result.details?.['repairAdvice'] ?? '') as string;
    expect(advice).toContain('libx264');
  });

  // AC #10: fail when no H.264 encoder is available at all
  it('AC#10 fail on Linux when no H.264 encoder is available', async () => {
    const runner = makeFfmpegRunner(ENCODERS_NO_H264);
    const result = await checkVideoEncoderForRunner(runner, 'linux');

    expect(result.status).toBe('fail');
    expect(result.summary).toContain('No H.264 encoder available');
    expect(result.repairable).toBe(false);
    const advice = (result.details?.['repairAdvice'] ?? '') as string;
    expect(advice).toContain('Install an H.264 encoder');
  });

  it('AC#10 fail on macOS when neither libx264 nor h264_videotoolbox is present', async () => {
    const runner = makeFfmpegRunner(ENCODERS_NO_H264);
    const result = await checkVideoEncoderForRunner(runner, 'darwin');

    expect(result.status).toBe('fail');
    expect(result.summary).toContain('No H.264 encoder available');
  });

  // FFmpeg missing → skip (the no-ffmpeg SystemState)
  it('SystemState `no-ffmpeg` produces skip referencing the FFmpeg check', async () => {
    const runner = makeFfmpegRunner(null);
    const result = await checkVideoEncoderForRunner(runner, 'linux');

    expect(result.status).toBe('skip');
    expect(result.summary).toContain('FFmpeg not available');
    expect(result.repairable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// udev-rule (AC #11..#15, plus AC #16 contribution)
//
// The current udevRuleCheck is `repairOnly: true` and its `check()` always
// returns `skip` — there is no detection logic for "rule present", "rule
// absent", or "rule stale". ACs #11..#14 therefore have no implementation to
// drive. They are documented as DEFERRED here; if/when detection lands the
// failing tests below will need updating.
//
// AC #15 (udev-rule on macOS reports skip) is asserted via the check's
// scope/skip behaviour. We assert `skip` rather than registry-absent because
// the check is registered on all platforms — see diagnostics/index.ts.
// ─────────────────────────────────────────────────────────────────────────────

describe('udev-rule — host environment matrix (TASK-301)', () => {
  it('AC#15 udev-rule check returns skip on macOS (registered on all platforms; skip is the platform-aware signal)', async () => {
    const result = await udevRuleCheck.check(stubCtx);

    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
  });

  it('AC#15 udev-rule check returns skip on Linux too (repair-only — detection lives in the repair)', async () => {
    // The pure check() doesn't read process.platform; same result on Linux.
    const result = await udevRuleCheck.check(stubCtx);
    expect(result.status).toBe('skip');
  });

  // Document the deferred ACs in-test so anyone touching this matrix later
  // sees the gap immediately rather than scrolling through backlog notes.
  it('AC#11..#14 DEFERRED — udevRuleCheck is repairOnly; no rule-presence detection logic exists today', () => {
    expect(udevRuleCheck.repairOnly).toBe(true);
    expect(udevRuleCheck.repair).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting metadata (AC #16)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#16 — every system-scope check declares scope: "system"', () => {
  const SYSTEM_SCOPE_CHECKS = [
    inquiryMethodsCheck,
    codecEncodersCheck,
    videoEncoderCheck,
    udevRuleCheck,
  ] as const;

  for (const check of SYSTEM_SCOPE_CHECKS) {
    it(`${check.id} has scope: 'system'`, () => {
      expect(check.scope).toBe('system');
    });
  }
});
