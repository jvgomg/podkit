/**
 * Test preflight assertions.
 *
 * Throws immediately at module-load time when an external dependency required
 * by integration tests is missing or broken. Wired in via each package's
 * `bunfig.toml` preload.
 *
 * No `@podkit/libgpod-node` import — that would create a workspace cycle.
 * Consumers that need a libgpod-node check should call `isNativeAvailable()`
 * from their own preflight file and throw via `failMissingDep(...)`.
 *
 * Tests must never silently skip when deps are missing — that masks broken
 * environments. If your test depends on a tool, declare it in preflight.
 */

import { execSync } from 'node:child_process';

function probeBinary(
  bin: string,
  versionFlag = '--version'
): { ok: true; version: string } | { ok: false; reason: string } {
  try {
    const out = execSync(`${bin} ${versionFlag} 2>&1`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const firstLine = out.trim().split('\n')[0] ?? '';
    return { ok: true, version: firstLine };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

export function failMissingDep(name: string, install: string): never {
  throw new Error(
    `\n\n` +
      `═══════════════════════════════════════════════════════════════════\n` +
      ` Missing or broken test dependency: ${name}\n` +
      `═══════════════════════════════════════════════════════════════════\n\n` +
      ` ${install}\n\n` +
      `═══════════════════════════════════════════════════════════════════\n`
  );
}

export function requireFFmpeg(): void {
  const result = probeBinary('ffmpeg', '-version');
  if (!result.ok) {
    failMissingDep(
      'ffmpeg',
      `${result.reason}\n\n Install FFmpeg:\n     macOS:   brew install ffmpeg\n     Ubuntu:  sudo apt install ffmpeg`
    );
  }
}

export function requireGpodTool(): void {
  const result = probeBinary('gpod-tool');
  if (!result.ok) {
    failMissingDep('gpod-tool', `${result.reason}\n\n Build gpod-tool:\n     mise run tools:build`);
  }
}
