/**
 * E2E test for `podkit doctor` system-scope checks.
 *
 * Catches environment-level breakage that silently corrupts sync (the
 * h264_videotoolbox-on-Linux bug being the canonical example). If FFmpeg is
 * missing an H.264 encoder, no audio encoder for the configured codecs, or
 * isn't reachable at all, this test should fail loudly long before the user
 * sees "0 tracks transferred".
 *
 * Runs in any environment with FFmpeg installed. Specifically targeted at
 * Linux VMs (mise run test:linux), where macOS-only paths historically slipped
 * through unnoticed.
 */

import { describe, it, expect } from 'bun:test';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';

interface DoctorCheck {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  summary: string;
}

interface DoctorOutput {
  healthy: boolean;
  mountPoint: string;
  deviceModel: string;
  checks: DoctorCheck[];
}

describe('doctor: system checks', () => {
  it('reports a working H.264 encoder for transcoding', async () => {
    await withTarget(async (target) => {
      const result = await runCliJson<DoctorOutput>(['doctor', '--device', target.path, '--json']);

      expect(result.result.exitCode).toBe(0);
      if (!result.json) {
        throw new Error(`doctor --json failed to produce JSON: ${result.result.stderr}`);
      }
      const videoEncoder = result.json.checks.find((c) => c.id === 'video-encoder');
      if (!videoEncoder) {
        throw new Error('doctor output missing video-encoder check');
      }
      // Pass means a usable encoder is present (libx264 universally; or
      // h264_videotoolbox on macOS as a bonus). Warn is acceptable on macOS
      // when only VideoToolbox is present. Fail means no encoder at all —
      // video sync would silently produce zero tracks.
      expect(['pass', 'warn']).toContain(videoEncoder.status);
    });
  });

  it('reports all configured audio encoders as available', async () => {
    await withTarget(async (target) => {
      const result = await runCliJson<DoctorOutput>(['doctor', '--device', target.path, '--json']);

      expect(result.result.exitCode).toBe(0);
      if (!result.json) {
        throw new Error(`doctor --json failed to produce JSON: ${result.result.stderr}`);
      }
      const codecCheck = result.json.checks.find((c) => c.id === 'codec-encoders');
      expect(codecCheck).toBeDefined();
      expect(codecCheck!.status).toBe('pass');
    });
  });

  it('overall healthy on a clean device with proper FFmpeg', async () => {
    await withTarget(async (target) => {
      const result = await runCliJson<DoctorOutput>(['doctor', '--device', target.path, '--json']);

      expect(result.result.exitCode).toBe(0);
      if (!result.json) {
        throw new Error(`doctor --json failed to produce JSON: ${result.result.stderr}`);
      }
      // healthy === true requires every applicable check to pass or skip.
      // A failing system-scope check (e.g. missing libx264) flips this false.
      const failedSystemChecks = result.json.checks.filter(
        (c) => c.status === 'fail' && !c.id.startsWith('orphan-')
      );
      if (failedSystemChecks.length > 0) {
        throw new Error(
          `Failed system checks:\n${failedSystemChecks
            .map((c) => `  - ${c.id}: ${c.summary}`)
            .join('\n')}`
        );
      }
    });
  });
});
