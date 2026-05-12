/**
 * Tag writer for mass-storage devices — writes metadata tags to audio files.
 *
 * Uses node-taglib-sharp for format-correct tag writing across FLAC
 * (Vorbis comments), MP3 (ID3v2), M4A (MP4 atoms), and OGG/Opus (Vorbis
 * comments). Modifies files in-place without re-encoding.
 *
 * @module
 */

import { ByteVector, File as TagFile, Picture, PictureType } from 'node-taglib-sharp';

/**
 * Subset of audio-file metadata fields podkit can write to disk.
 *
 * All fields are optional: undefined means "leave the existing tag value
 * unchanged"; a defined value (including the empty string / number 0) is
 * applied as-is. Callers are expected to omit fields they have not
 * actually changed so the read-modify-write cycle stays minimal.
 */
export interface TagFields {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  compilation?: boolean;
  comment?: string;
}

/**
 * Interface for writing metadata tags to audio files.
 * Injectable for testing — tests can provide a mock implementation.
 */
export interface TagWriter {
  /**
   * Apply a partial set of textual metadata fields to a file's tag block.
   * Opens, mutates, saves, and disposes in a single operation.
   */
  writeTags(filePath: string, fields: TagFields): Promise<void>;

  writeReplayGain(
    filePath: string,
    trackGain: number,
    trackPeak?: number,
    albumGain?: number,
    albumPeak?: number
  ): Promise<void>;

  writePicture(filePath: string, imageData: Buffer): Promise<void>;
}

/**
 * Tag writer using node-taglib-sharp.
 *
 * Field-to-container mappings node-taglib-sharp handles for us:
 * - FLAC/OGG/Opus: Vorbis comments (`TITLE`, `ARTIST`, `ALBUMARTIST`, …)
 * - MP3: ID3v2 frames (`TIT2`, `TPE1`, `TPE2`, …)
 * - M4A: MP4 atoms (`©nam`, `©ART`, `aART`, …)
 *
 * Modifies files in-place (no temp files or re-encoding needed).
 */
export class TagLibTagWriter implements TagWriter {
  async writeTags(filePath: string, fields: TagFields): Promise<void> {
    const file = TagFile.createFromPath(filePath);
    try {
      const tag = file.tag;
      if (fields.title !== undefined) tag.title = fields.title;
      if (fields.artist !== undefined) tag.performers = [fields.artist];
      if (fields.albumArtist !== undefined) tag.albumArtists = [fields.albumArtist];
      if (fields.album !== undefined) tag.album = fields.album;
      if (fields.genre !== undefined) tag.genres = [fields.genre];
      if (fields.year !== undefined) tag.year = fields.year;
      if (fields.trackNumber !== undefined) tag.track = fields.trackNumber;
      if (fields.discNumber !== undefined) tag.disc = fields.discNumber;
      if (fields.compilation !== undefined) tag.isCompilation = fields.compilation;
      if (fields.comment !== undefined) tag.comment = fields.comment;
      file.save();
    } finally {
      file.dispose();
    }
  }

  async writeReplayGain(
    filePath: string,
    trackGain: number,
    trackPeak?: number,
    albumGain?: number,
    albumPeak?: number
  ): Promise<void> {
    const file = TagFile.createFromPath(filePath);
    try {
      file.tag.replayGainTrackGain = trackGain;
      if (trackPeak !== undefined) {
        file.tag.replayGainTrackPeak = trackPeak;
      }
      if (albumGain !== undefined) {
        file.tag.replayGainAlbumGain = albumGain;
      }
      if (albumPeak !== undefined) {
        file.tag.replayGainAlbumPeak = albumPeak;
      }
      file.save();
    } finally {
      file.dispose();
    }
  }

  async writePicture(filePath: string, imageData: Buffer): Promise<void> {
    const file = TagFile.createFromPath(filePath);
    try {
      const picture = Picture.fromData(ByteVector.fromByteArray(imageData));
      picture.type = PictureType.FrontCover;
      file.tag.pictures = [picture];
      file.save();
    } finally {
      file.dispose();
    }
  }
}
