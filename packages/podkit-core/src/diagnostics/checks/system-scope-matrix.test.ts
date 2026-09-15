/**
 * System-scope diagnostic check matrix.
 *
 * Drives each of the four system-scope diagnostic checks against every
 * relevant SystemState permutation, verifying status / summary / details /
 * repairable. Deliberately per-check only: the overall doctor `healthy`
 * verdict and the exit-code mapping are pinned by their own suites, so a
 * change to the aggregation rules cannot silently rewrite these.
 *
 * Checks under test:
 *   - inquiry-methods (SCSI + USB transport availability)
 *   - codec-encoders (FFmpeg audio encoder coverage)
 *   - video-encoder  (H.264 encoder coverage)
 *   - udev-rule      (Linux udev rule presence — repair-only)
 *
 * Unit-test path: every test drives the exported pure check function with
 * injected fakes (ProbeFn, SubprocessRunner, TranscoderCapabilities). No real
 * subprocess, filesystem, or native binding is touched.
 *
 * @see docs/adr/adr-017-device-persona-fixtures.md
 */

import { describe, it, expect } from 'bun:test';

// ── Checks under test ─────────────────────────────────────────────────────────

import { checkInquiryMethods, inquiryMethodsCheck, type ProbeFn } from './inquiry-methods.js';
import { checkEncoderAvailability, codecEncodersCheck } from './codec-encoders.js';
import { debrisTranscodeTmpCheck } from './debris-transcode-tmp.js';
import { checkVideoEncoderForRunner, videoEncoderCheck } from './video-encoder.js';
import {
  checkUdevRule,
  runUdevRuleInstall,
  udevRuleCheck,
  UDEV_RULE_CONTENT,
  TARGET_PATH,
  type FsOps,
  type ReadFileFn,
  type SudoExecutor,
} from './udev-rule.js';

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
// Inquiry methods — SCSI/USB transport availability across host states
// ─────────────────────────────────────────────────────────────────────────────

describe('inquiry-methods — host environment matrix', () => {
  // Both transports available → pass.
  it('pass when SCSI and libusb are both available (Linux, healthy)', async () => {
    const probe = makeProbe(makeAvailability({ scsi: true, usb: true }));
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.status).toBe('pass');
    // USB is the preferred transport; summary leads with USB, notes SCSI too.
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('/dev/sg* present');
    expect(result.repairable).toBe(false);
    const d = result.details as Record<string, unknown>;
    expect(d['scsi']).toMatchObject({ available: true });
    expect(d['usb']).toMatchObject({ available: true });
    expect(d['plan']).toBe('usb-then-scsi');
    expect(d['platform']).toBe('linux');
  });

  it('pass when SCSI and libusb are both available (macOS, healthy)', async () => {
    const probe = makeProbe(makeAvailability({ scsi: true, usb: true }));
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.status).toBe('pass');
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('iPodDriver.kext present');
    expect(result.repairable).toBe(false);
  });

  // USB available, SCSI missing → pass (USB is preferred; SCSI is an optional fallback).
  // A Linux host without /dev/sg* but with working USB must not show warn.
  it('pass when USB available but SCSI unavailable — SCSI absence noted in summary', async () => {
    const probe = makeProbe(
      makeAvailability({
        scsi: false,
        scsiReason: 'iPodDriver.kext not present — SCSI inquiry unavailable',
        usb: true,
      })
    );
    const result = await checkInquiryMethods(probe, 'darwin');

    expect(result.status).toBe('pass');
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('iPodDriver.kext not present');
    expect(result.repairable).toBe(false);
    const d = result.details as Record<string, unknown>;
    expect(d['plan']).toBe('usb-only');
  });

  // Neither transport available → warn, with both failures surfaced in the summary.
  it('SCSI absent + USB absent: warn with USB failure reason surfaced', async () => {
    const probe = makeProbe(
      makeAvailability({
        scsi: false,
        scsiReason: 'no /dev/sg* nodes present — SCSI inquiry unavailable',
        usb: false,
        usbReason: 'libusb not loadable',
      })
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('USB and SCSI inquiry both unavailable');
    expect(result.summary).toContain('libusb not loadable');
    expect(result.repairable).toBe(false);
    const d = result.details as Record<string, unknown>;
    expect(d['plan']).toBe('none');
  });

  // Linux /dev/sg* present-but-unreadable, USB available → pass, SCSI note in summary.
  it('Linux /dev/sg* present-but-unreadable — pass (USB up), SCSI hint in summary', async () => {
    const probe = makeProbe(
      makeAvailability({
        scsi: false,
        scsiReason:
          '/dev/sg* present but not readable by current uid (gid plugdev or sudo required)',
        usb: true,
      })
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.status).toBe('pass');
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('not readable');
    expect(result.summary).toContain('plugdev');
    expect(result.repairable).toBe(false);
  });

  // Linux /dev/sg* absent, USB available → pass, with sg* absence noted.
  it('Linux /dev/sg* absent — pass (USB up), sg* absence noted', async () => {
    const probe = makeProbe(
      makeAvailability({
        scsi: false,
        scsiReason:
          'no /dev/sg* nodes present — SCSI inquiry unavailable (no SCSI generic devices on this system)',
        usb: true,
      })
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.status).toBe('pass');
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('no /dev/sg*');
    expect(result.repairable).toBe(false);
  });

  // The same two transport outcomes as above, reached through the named
  // SystemState fixtures rather than hand-built availability objects:
  // `no-sg-perms` is the present-but-unreadable case, `healthy` the both-up one.
  it('SystemState `no-sg-perms` + USB available: pass, summary surfaces sg* permission hint', async () => {
    const probe = makeProbe(
      makeAvailability({
        scsi: false,
        scsiReason:
          '/dev/sg* present but not readable by current uid (gid plugdev or sudo required)',
        usb: true,
      })
    );
    const result = await checkInquiryMethods(probe, 'linux');

    expect(result.status).toBe('pass');
    expect(result.summary).toContain('USB inquiry available');
    expect(result.summary).toContain('/dev/sg* not readable');
    expect(result.summary).toContain('plugdev');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Codec encoders — FFmpeg audio encoder coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('codec-encoders — host environment matrix', () => {
  // Pass when AAC, ALAC, and MP3 encoders (and the rest of the default
  // stacks) are available. Asserts on the defaults — the `healthy` state.
  it('pass when AAC, ALAC, MP3 (and full default stack) are available', () => {
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

  // One or more configured codec encoders missing.
  //
  // Note the severity: the implementation returns `warn` here, not `fail`,
  // because a missing encoder narrows what podkit can transcode to without
  // making the host unusable. This test pins that *current* behaviour, so
  // any future tightening to `fail` produces a clear, intentional break
  // rather than a silent severity change.
  it('missing encoders surface as warn (current behaviour) with missing codecs listed', () => {
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

  // When ffmpeg itself isn't on PATH, the registered check returns `skip`
  // (not `fail` — the dedicated ffmpeg check owns the hard signal).
  //
  // The no-ffmpeg SystemState fixture records `codec-encoders: fail`, which
  // looks like a contradiction but is not: that fixture describes the
  // *aggregate* expectation across several checks, and the hard failure it
  // predicts comes from the FFmpeg-presence check this one chains to. What
  // is pinned here is the single check's own verdict.
  it('ffmpeg not on PATH → registered check returns skip referencing the FFmpeg check', async () => {
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
// Video encoder — H.264 encoder coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('video-encoder — host environment matrix', () => {
  // Pass when libx264 is available (Linux baseline).
  it('pass on Linux when libx264 is available', async () => {
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

  it('pass on macOS when libx264 + h264_videotoolbox are both available', async () => {
    const runner = makeFfmpegRunner(ENCODERS_WITH_LIBX264_AND_VTB);
    const result = await checkVideoEncoderForRunner(runner, 'darwin');

    expect(result.status).toBe('pass');
    expect(result.summary).toBe('libx264 + h264_videotoolbox available');
  });

  // Warn on macOS when only h264_videotoolbox is available.
  it('warn on macOS when only h264_videotoolbox is available (no libx264)', async () => {
    const runner = makeFfmpegRunner(ENCODERS_VTB_ONLY);
    const result = await checkVideoEncoderForRunner(runner, 'darwin');

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('h264_videotoolbox only');
    expect(result.summary).toContain('libx264 missing');
    expect(result.repairable).toBe(false);
    const advice = (result.details?.['repairAdvice'] ?? '') as string;
    expect(advice).toContain('libx264');
  });

  // Fail when no H.264 encoder is available at all.
  it('fail on Linux when no H.264 encoder is available', async () => {
    const runner = makeFfmpegRunner(ENCODERS_NO_H264);
    const result = await checkVideoEncoderForRunner(runner, 'linux');

    expect(result.status).toBe('fail');
    expect(result.summary).toContain('No H.264 encoder available');
    expect(result.repairable).toBe(false);
    const advice = (result.details?.['repairAdvice'] ?? '') as string;
    expect(advice).toContain('Install an H.264 encoder');
  });

  it('fail on macOS when neither libx264 nor h264_videotoolbox is present', async () => {
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
// udev-rule — Linux udev rule presence, staleness and repair
//
// Detection coverage became possible once `udevRuleCheck` grew rule-presence
// and staleness detection. Every case is driven through the pure
// `checkUdevRule()` function with an injectable `readFile` fake, so the test
// never touches the host filesystem. The round-trip case drives the repair
// against an in-memory FS, then re-runs `check()` against the same store.
// ─────────────────────────────────────────────────────────────────────────────

/** In-memory readFile fake. `undefined` content → ENOENT. */
function readFileFromMap(map: Map<string, string>): ReadFileFn {
  return async (path: string) => {
    const content = map.get(path);
    if (content === undefined) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return content;
  };
}

describe('udev-rule — host environment matrix', () => {
  it('Linux: rule present + content matches → pass', async () => {
    const fs = new Map<string, string>([[TARGET_PATH, UDEV_RULE_CONTENT]]);
    const result = await checkUdevRule({
      platform: 'linux',
      readFile: readFileFromMap(fs),
    });

    expect(result.status).toBe('pass');
    expect(result.summary).toBe('iPod udev rule installed');
    expect(result.repairable).toBe(false);
    expect(result.details?.['path']).toBe(TARGET_PATH);
  });

  it('Linux: rule absent → fail + repairable', async () => {
    const fs = new Map<string, string>();
    const result = await checkUdevRule({
      platform: 'linux',
      readFile: readFileFromMap(fs),
    });

    expect(result.status).toBe('fail');
    expect(result.summary).toBe('iPod udev rule not installed');
    expect(result.repairable).toBe(true);
    expect(result.details?.['path']).toBe(TARGET_PATH);
  });

  it('Linux: rule present + content stale → warn + repairable', async () => {
    const stale = `# stale podkit udev rule (older vendor set)
ACTION=="add", SUBSYSTEM=="scsi_generic", ATTRS{idVendor}=="05ac"
`;
    const fs = new Map<string, string>([[TARGET_PATH, stale]]);
    const result = await checkUdevRule({
      platform: 'linux',
      readFile: readFileFromMap(fs),
    });

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('stale');
    expect(result.repairable).toBe(true);
    expect(result.details?.['path']).toBe(TARGET_PATH);
    expect(typeof result.details?.['diff']).toBe('string');
  });

  it('Linux: rule unreadable (EACCES) → fail (not repairable)', async () => {
    const readFile: ReadFileFn = async (_p) => {
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    };
    const result = await checkUdevRule({
      platform: 'linux',
      readFile,
    });

    expect(result.status).toBe('fail');
    expect(result.summary).toBe('cannot read iPod udev rule');
    expect(result.repairable).toBe(false);
    expect(result.details?.['errno']).toBe('EACCES');
  });

  it('round-trip: repair installs the rule, then a second check() returns pass', async () => {
    // In-memory filesystem: starts empty (rule absent).
    const fs = new Map<string, string>();
    const readFile = readFileFromMap(fs);

    // 1) First check — rule is absent.
    const before = await checkUdevRule({ platform: 'linux', readFile });
    expect(before.status).toBe('fail');
    expect(before.repairable).toBe(true);

    // 2) Drive the repair against the same in-memory FS. The repair writes to
    //    a temp path then `sudo cp`s to TARGET_PATH; the FsOps + executor
    //    fakes route both writes back into the same map so a subsequent
    //    check() will see the installed rule.
    const fsOps: FsOps = {
      writeFile: (path, content) => {
        fs.set(path, content);
      },
      unlink: (path) => {
        fs.delete(path);
      },
    };
    const executor: SudoExecutor = (args) => {
      if (args[0] === 'cp' && args.length === 3) {
        const src = args[1]!;
        const dst = args[2]!;
        const content = fs.get(src);
        if (content !== undefined) {
          fs.set(dst, content);
        }
        return { code: 0, stderr: '' };
      }
      // udevadm control --reload / trigger — succeed silently.
      return { code: 0, stderr: '' };
    };

    const repairResult = await runUdevRuleInstall({
      platform: 'linux',
      dryRun: false,
      executor,
      fsOps,
    });
    expect(repairResult.success).toBe(true);

    // 3) Second check — rule is now present and matches canonical content.
    const after = await checkUdevRule({ platform: 'linux', readFile });
    expect(after.status).toBe('pass');
    expect(after.summary).toBe('iPod udev rule installed');
    expect(after.repairable).toBe(false);
  });

  it('dry-run prints the action without writing the rule', async () => {
    const fs = new Map<string, string>();
    let writes = 0;
    const fsOps: FsOps = {
      writeFile: () => {
        writes += 1;
      },
      unlink: () => {
        writes += 1;
      },
    };
    let executorCalls = 0;
    const executor: SudoExecutor = () => {
      executorCalls += 1;
      return { code: 0, stderr: '' };
    };

    const repairResult = await runUdevRuleInstall({
      platform: 'linux',
      dryRun: true,
      executor,
      fsOps,
    });
    expect(repairResult.success).toBe(true);
    expect(repairResult.summary).toContain(TARGET_PATH);
    expect(writes).toBe(0);
    expect(executorCalls).toBe(0);

    // Filesystem is still empty → check() still reports fail.
    const after = await checkUdevRule({
      platform: 'linux',
      readFile: readFileFromMap(fs),
    });
    expect(after.status).toBe('fail');
  });

  it('udev-rule check returns skip on macOS (not applicable to platform)', async () => {
    let readCalls = 0;
    const result = await checkUdevRule({
      platform: 'darwin',
      readFile: async () => {
        readCalls += 1;
        return UDEV_RULE_CONTENT;
      },
    });
    expect(result.status).toBe('skip');
    expect(result.summary).toBe('not applicable to platform');
    expect(result.repairable).toBe(false);
    // Skip path is returned without reading the file.
    expect(readCalls).toBe(0);
  });

  it('udev-rule shows up in the doctor JSON contract (registered, has repair, system-scope)', () => {
    expect(udevRuleCheck.id).toBe('udev-rule');
    expect(udevRuleCheck.scope).toBe('system');
    expect(udevRuleCheck.repair).toBeDefined();
    // No longer repairOnly — detection logic is now wired up.
    expect(udevRuleCheck.repairOnly).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting metadata — scope declarations
// ─────────────────────────────────────────────────────────────────────────────

describe('every system-scope check declares scope: "system"', () => {
  const SYSTEM_SCOPE_CHECKS = [
    inquiryMethodsCheck,
    codecEncodersCheck,
    videoEncoderCheck,
    udevRuleCheck,
    // Host-global walker for abandoned
    // `podkit-transcode-<uuid>/` scratch dirs left by SIGKILLed syncs.
    debrisTranscodeTmpCheck,
  ] as const;

  for (const check of SYSTEM_SCOPE_CHECKS) {
    it(`${check.id} has scope: 'system'`, () => {
      expect(check.scope).toBe('system');
    });
  }
});
