/**
 * FFmpeg presence diagnostic check.
 *
 * FFmpeg is podkit's one runtime dependency: without it nothing transcodes,
 * so its absence fails here. The encoder checks probe the same binary and
 * `skip` when it is missing, pointing back at this check, so the root cause
 * is reported once (see docs/architecture/conventions.md §13).
 */

import type { SubprocessRunner, SubprocessRunResult } from '@podkit/device-types';
import { defaultSubprocessRunner } from '@podkit/device-types';
import { DEFAULT_FFMPEG } from '../../transcode/ffmpeg.js';
import type { DiagnosticCheck, CheckResult, DiagnosticContext } from '../types.js';

const INSTALL_ADVICE =
  'Install FFmpeg:\n' +
  '    macOS:         brew install ffmpeg\n' +
  '    Debian/Ubuntu: sudo apt install ffmpeg\n' +
  '    Alpine:        apk add ffmpeg';

/**
 * What a check that probes FFmpeg returns when the binary is missing: this
 * check owns that failure, so dependents skip and point here.
 */
export const FFMPEG_MISSING_SKIP: CheckResult = {
  status: 'skip',
  summary: 'FFmpeg not available (see FFmpeg check)',
  repairable: false,
};

/**
 * Pure check logic — accepts an injected subprocess runner so unit tests can
 * drive the matrix without spawning real ffmpeg.
 */
export async function checkFfmpegForRunner(
  subprocess: SubprocessRunner = defaultSubprocessRunner
): Promise<CheckResult> {
  let result: SubprocessRunResult;
  try {
    result = await subprocess.run(DEFAULT_FFMPEG, ['-version']);
  } catch (err) {
    return {
      status: 'fail',
      summary: 'FFmpeg not found',
      repairable: false,
      details: {
        error: err instanceof Error ? err.message : String(err),
        repairAdvice: INSTALL_ADVICE,
      },
    };
  }

  if (result.exitCode !== 0) {
    return {
      status: 'fail',
      summary: `FFmpeg failed to run (\`ffmpeg -version\` exited ${result.exitCode})`,
      repairable: false,
      details: {
        exitCode: result.exitCode,
        stderr: result.stderr.trim(),
        repairAdvice: `Reinstall FFmpeg.\n\n${INSTALL_ADVICE}`,
      },
    };
  }

  const version = result.stdout.match(/ffmpeg version (\S+)/)?.[1];
  return {
    status: 'pass',
    summary: version ? `FFmpeg ${version}` : 'FFmpeg (version unknown)',
    repairable: false,
    details: { version: version ?? 'unknown' },
  };
}

export const ffmpegCheck: DiagnosticCheck = {
  id: 'ffmpeg',
  name: 'FFmpeg',
  applicableTo: ['ipod', 'mass-storage'],
  scope: 'system',

  async check(_ctx: DiagnosticContext): Promise<CheckResult> {
    return checkFfmpegForRunner(defaultSubprocessRunner);
  },
};
