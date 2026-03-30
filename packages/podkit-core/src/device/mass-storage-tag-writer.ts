/**
 * Tag writer for mass-storage devices — writes metadata tags to audio files.
 *
 * Uses node-taglib-sharp for format-correct tag writing across FLAC
 * (Vorbis COMMENT), MP3 (ID3v2 COMM), and M4A (©cmt) containers.
 * Modifies files in-place without re-encoding.
 *
 * @module
 */

import { File as TagFile } from 'node-taglib-sharp';

/**
 * Interface for writing metadata tags to audio files.
 * Injectable for testing — tests can provide a mock implementation.
 */
export interface TagWriter {
  writeComment(filePath: string, comment: string): Promise<void>;
  writeReplayGain(filePath: string, trackGain: number, trackPeak?: number): Promise<void>;
}

/**
 * Tag writer using node-taglib-sharp.
 *
 * Writes the comment tag to the correct format-specific field:
 * - FLAC/OGG: Vorbis `COMMENT` tag
 * - MP3: ID3v2 `COMM` frame
 * - M4A/AAC: `©cmt` atom
 *
 * Modifies files in-place (no temp files or re-encoding needed).
 */
export class TagLibTagWriter implements TagWriter {
  async writeComment(filePath: string, comment: string): Promise<void> {
    const file = TagFile.createFromPath(filePath);
    try {
      file.tag.comment = comment;
      file.save();
    } finally {
      file.dispose();
    }
  }

  async writeReplayGain(filePath: string, trackGain: number, trackPeak?: number): Promise<void> {
    const file = TagFile.createFromPath(filePath);
    try {
      file.tag.replayGainTrackGain = trackGain;
      if (trackPeak !== undefined) {
        file.tag.replayGainTrackPeak = trackPeak;
      }
      file.save();
    } finally {
      file.dispose();
    }
  }
}
