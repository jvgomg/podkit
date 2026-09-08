/**
 * Turning a non-zero FFmpeg exit into a message worth reading.
 *
 * FFmpeg negates an errno into its exit byte, so `254` is `-ENOENT` and
 * covers both "cannot read the input" and "cannot write the output" — the one
 * distinction a caller actually needs, and the one the number cannot carry.
 * TASK-501 spent four CI runs inferring from the code what a single line of
 * stderr states outright.
 *
 * Shared by the audio transcoder (`transcode/ffmpeg.ts`) and the video one
 * (`video/transcode.ts`) so the two cannot drift apart on which diagnostics
 * they recognise.
 *
 * @module
 */

/** Longest diagnostic we will quote; anything beyond is elided. */
const MAX_DIAGNOSTIC_CHARS = 200;

/**
 * Lines worth surfacing. FFmpeg's normal chatter — the version banner, the
 * configure flags, the stream mapping — carries none of these, and its
 * failures all carry at least one.
 */
const DIAGNOSTIC_PATTERN =
  /error|invalid|no such file|failed|denied|permission|not permitted|does not contain any stream/i;

/**
 * The first diagnostic line in `stderr`, or `null` if it holds none.
 *
 * The `[component @ 0xADDRESS]` prefix is stripped: the address varies run to
 * run, so leaving it in would make otherwise-identical failures look distinct
 * in logs and issue reports. The *first* match is taken rather than the last
 * because FFmpeg reports the specific cause before its generic summary — it
 * says `Error opening output /tmp/…/out.m4a: No such file or directory`
 * before `Error opening output files: No such file or directory`, and only
 * the first names the path.
 */
export function firstFFmpegDiagnostic(stderr: string): string | null {
  for (const raw of stderr.split('\n')) {
    const line = raw.replace(/^\[[^\]]*\]\s*/, '').trim();
    if (line === '') continue;
    if (!DIAGNOSTIC_PATTERN.test(line)) continue;
    return line.length > MAX_DIAGNOSTIC_CHARS ? `${line.slice(0, MAX_DIAGNOSTIC_CHARS)}…` : line;
  }
  return null;
}

/** Build the message for a non-zero FFmpeg exit, with its own diagnostic. */
export function describeFFmpegFailure(code: number | null, stderr: string): string {
  const base = `FFmpeg exited with code ${code}`;
  const diagnostic = firstFFmpegDiagnostic(stderr);
  return diagnostic === null ? base : `${base}: ${diagnostic}`;
}
