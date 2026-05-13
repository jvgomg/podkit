#!/usr/bin/env bun
/**
 * Build-time check: verify the host ffmpeg has every encoder this package
 * uses to synthesise audio fixtures. Run before `bun build` (see
 * `package.json`'s `build` script) so test-fixtures fails to build with a
 * clear message rather than letting downstream tests silently skip or
 * fail on missing encoders at runtime.
 *
 * Dependents (`@podkit/core` tests etc.) import this package's library
 * functions; if a developer's ffmpeg is missing libvorbis (the macOS
 * Homebrew default), the test-fixtures build refuses to proceed and
 * tells them the exact install command.
 */
import { execFileSync } from 'node:child_process';

interface EncoderRequirement {
  /** ffmpeg encoder name as listed by `ffmpeg -encoders`. */
  encoder: string;
  /** Human-readable codec for the error message. */
  codec: string;
  /** Why test-fixtures needs this encoder. */
  usedFor: string;
}

const REQUIRED_ENCODERS: EncoderRequirement[] = [
  { encoder: 'flac', codec: 'FLAC', usedFor: 'lossless mini-track fixtures' },
  { encoder: 'libmp3lame', codec: 'MP3', usedFor: 'MP3 mini-track fixtures' },
  { encoder: 'aac', codec: 'AAC', usedFor: 'AAC mini-track fixtures (M4A container)' },
  { encoder: 'libvorbis', codec: 'OGG Vorbis', usedFor: '.ogg mini-track fixtures' },
  { encoder: 'libopus', codec: 'Opus', usedFor: '.opus mini-track fixtures' },
];

function detectPackageManager(): 'brew' | 'apt' | 'dnf' | 'apk' | 'pacman' | null {
  const platform = process.platform;
  const candidates: Array<['brew' | 'apt' | 'dnf' | 'apk' | 'pacman', string]> =
    platform === 'darwin'
      ? [['brew', 'brew']]
      : [
          ['apt', 'apt-get'],
          ['dnf', 'dnf'],
          ['apk', 'apk'],
          ['pacman', 'pacman'],
        ];
  for (const [name, bin] of candidates) {
    try {
      execFileSync('which', [bin], { stdio: 'pipe' });
      return name;
    } catch {
      // not found, try next
    }
  }
  return null;
}

function installHint(missing: EncoderRequirement[]): string {
  const pm = detectPackageManager();
  const codecs = missing.map((m) => m.codec).join(', ');

  const lines: string[] = [];
  lines.push(`Missing ffmpeg encoders: ${codecs}.`);
  lines.push('');
  lines.push('test-fixtures synthesises audio across every codec podkit accepts.');
  lines.push('Install hints:');
  lines.push('');

  switch (pm) {
    case 'brew':
      lines.push('  macOS (detected: Homebrew)');
      lines.push("    Homebrew's stock ffmpeg currently omits libvorbis.");
      lines.push('    Use the homebrew-ffmpeg tap, which ships libvorbis, libopus, and libmp3lame');
      lines.push('    as required dependencies (no --with-* flags needed for those):');
      lines.push(
        '      brew uninstall --ignore-dependencies ffmpeg   # if stock ffmpeg is installed'
      );
      lines.push('      brew tap homebrew-ffmpeg/ffmpeg');
      lines.push('      brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-fdk-aac');
      lines.push(
        '    The --with-fdk-aac flag is optional; macOS already has aac_at (VideoToolbox).'
      );
      break;
    case 'apt':
      lines.push('  Debian/Ubuntu (detected: apt)');
      lines.push('    sudo apt install ffmpeg');
      lines.push('    (Debian ships ffmpeg with libvorbis/libopus/libmp3lame/aac by default.)');
      break;
    case 'dnf':
      lines.push('  Fedora/RHEL (detected: dnf)');
      lines.push('    sudo dnf install ffmpeg-free   # or `ffmpeg` from RPM Fusion');
      break;
    case 'apk':
      lines.push('  Alpine (detected: apk)');
      lines.push('    apk add ffmpeg');
      break;
    case 'pacman':
      lines.push('  Arch (detected: pacman)');
      lines.push('    sudo pacman -S ffmpeg');
      break;
    default:
      lines.push('  (No supported package manager detected on $PATH.)');
      lines.push('  macOS:         see Homebrew instructions above');
      lines.push('  Debian/Ubuntu: sudo apt install ffmpeg');
      lines.push('  Fedora:        sudo dnf install ffmpeg-free');
      lines.push('  Alpine:        apk add ffmpeg');
  }

  lines.push('');
  lines.push('After installing, re-run the build (turbo: `bun run build --force`).');
  return lines.join('\n');
}

function main(): void {
  let ffmpegEncoders: string;
  try {
    ffmpegEncoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch {
    console.error('ffmpeg not found on $PATH.');
    console.error('');
    console.error(installHint(REQUIRED_ENCODERS));
    process.exit(1);
  }

  const missing: EncoderRequirement[] = [];
  for (const req of REQUIRED_ENCODERS) {
    const present = new RegExp(`\\b${req.encoder}\\b`).test(ffmpegEncoders);
    if (!present) missing.push(req);
  }

  if (missing.length === 0) {
    return;
  }

  console.error(installHint(missing));
  process.exit(1);
}

main();
