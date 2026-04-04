import { BufferReader } from '../../binary/reader.js';
import { ParseError } from '../../binary/errors.js';
import type { MhitRecord, MhodRecord } from '../types.js';
import { parseMhod } from './mhod.js';

/**
 * Parse an MHIT (track item) record.
 *
 * The header has grown across iTunes versions:
 *   - <= 0x9c (156 bytes): original fields
 *   - >= 0xf4 (244 bytes): extended fields (skip count, media type, etc.)
 *   - >= 0x148 (328 bytes): gapless playback fields
 *
 * After the header, `mhodCount` MHOD children follow.
 */
export function parseMhit(reader: BufferReader): MhitRecord {
  const startOffset = reader.offset;

  const tag = reader.readTag();
  if (tag !== 'mhit') {
    throw new ParseError('Expected mhit tag', {
      offset: startOffset,
      expected: 'mhit',
      actual: tag,
    });
  }

  const headerLen = reader.readUInt32();
  const totalLen = reader.readUInt32();
  const mhodCount = reader.readUInt32();

  if (headerLen < 0x9c) {
    throw new ParseError('mhit header too small', {
      offset: startOffset,
      expected: `>= ${0x9c} bytes`,
      actual: `${headerLen} bytes`,
    });
  }

  // ── Core fields (header >= 0x9c) ────────────────────────────────
  const trackId = reader.readUInt32(); // +16
  const visible = reader.readUInt32(); // +20
  const filetypeMarker = reader.readUInt32(); // +24
  const type1 = reader.readUInt8(); // +28
  const type2 = reader.readUInt8(); // +29
  const compilation = reader.readUInt8(); // +30
  const rating = reader.readUInt8(); // +31
  const dateModified = reader.readUInt32(); // +32
  const size = reader.readUInt32(); // +36
  const trackLength = reader.readUInt32(); // +40
  const trackNumber = reader.readUInt32(); // +44
  const trackTotal = reader.readUInt32(); // +48
  const year = reader.readUInt32(); // +52
  const bitrate = reader.readUInt32(); // +56
  const sampleRateCombo = reader.readUInt32(); // +60
  const sampleRate = sampleRateCombo >>> 16;
  const sampleRateLow = sampleRateCombo & 0xffff;
  const volume = reader.readInt32(); // +64
  const startTime = reader.readUInt32(); // +68
  const stopTime = reader.readUInt32(); // +72
  const soundCheck = reader.readUInt32(); // +76
  const playCount = reader.readUInt32(); // +80
  const playCount2 = reader.readUInt32(); // +84
  const lastPlayed = reader.readUInt32(); // +88
  const discNumber = reader.readUInt32(); // +92
  const discTotal = reader.readUInt32(); // +96
  const drmUserId = reader.readUInt32(); // +100
  const dateAdded = reader.readUInt32(); // +104
  const bookmarkTime = reader.readUInt32(); // +108
  const dbid = reader.readUInt64(); // +112
  const checked = reader.readUInt8(); // +120
  const appRating = reader.readUInt8(); // +121
  const bpm = reader.readUInt16(); // +122
  const artworkCount = reader.readUInt16(); // +124
  reader.readUInt16(); // +126 unknown
  const artworkSize = reader.readUInt32(); // +128
  reader.readUInt32(); // +132 unknown
  const sampleRate2 = reader.readUInt32(); // +136 (float stored as uint32)
  reader.readUInt32(); // +140 time_released
  reader.readUInt16(); // +144 unknown
  reader.readUInt16(); // +146 explicit_flag
  reader.readUInt32(); // +148 unknown
  reader.readUInt32(); // +152 unknown

  // We are now at offset +156 relative to start (0x9c)

  const result: MhitRecord = {
    trackId,
    visible,
    filetypeMarker,
    type1,
    type2,
    compilation,
    rating,
    dateModified,
    size,
    trackLength,
    trackNumber,
    trackTotal,
    year,
    bitrate,
    sampleRate,
    sampleRateLow,
    volume,
    startTime,
    stopTime,
    soundCheck,
    playCount,
    playCount2,
    lastPlayed,
    discNumber,
    discTotal,
    drmUserId,
    dateAdded,
    bookmarkTime,
    dbid,
    checked,
    appRating,
    bpm,
    artworkCount,
    artworkSize,
    sampleRate2,
    mhods: [],
    unknownHeaderBytes: new Uint8Array(0),
  };

  // ── Extended fields (header >= 0xf4) ────────────────────────────
  if (headerLen >= 0xf4) {
    result.skipCount = reader.readUInt32(); // +156
    result.lastSkipped = reader.readUInt32(); // +160
    result.hasArtwork = reader.readUInt8(); // +164
    result.skipWhenShuffling = reader.readUInt8(); // +165
    result.rememberPlaybackPosition = reader.readUInt8(); // +166
    result.flag4 = reader.readUInt8(); // +167
    result.dbid2 = reader.readUInt64(); // +168
    result.lyricsFlag = reader.readUInt8(); // +176
    result.movieFlag = reader.readUInt8(); // +177
    result.markUnplayed = reader.readUInt8(); // +178
    reader.readUInt8(); // +179 unknown
    reader.readUInt32(); // +180 unknown
    result.pregap = reader.readUInt32(); // +184
    result.sampleCount = reader.readUInt64(); // +188
    reader.readUInt32(); // +196 unknown
    result.postgap = reader.readUInt32(); // +200
    reader.readUInt32(); // +204 unknown
    result.mediaType = reader.readUInt32(); // +208
    result.seasonNumber = reader.readUInt32(); // +212
    result.episodeNumber = reader.readUInt32(); // +216
    // Skip remaining known unknowns up to 0xf4
    // +220..+240 = 6 x uint32 = 24 bytes
    reader.skip(24);
  }

  // ── Gapless fields (header >= 0x148) ────────────────────────────
  if (headerLen >= 0x148) {
    // We're at offset 0xf4 = 244. Need fields at 248, 256, 258
    reader.readUInt32(); // +244 unknown
    result.gaplessData = reader.readUInt32(); // +248
    reader.readUInt32(); // +252 unknown
    result.gaplessTrackFlag = reader.readUInt16(); // +256
    result.gaplessAlbumFlag = reader.readUInt16(); // +258
  }

  // ── Preserve remaining unknown header bytes ─────────────────────
  const consumed = reader.offset - startOffset;
  if (consumed < headerLen) {
    result.unknownHeaderBytes = reader.readBytes(headerLen - consumed);
  }

  // Jump to header end (in case we skipped too much or too little)
  reader.seek(startOffset + headerLen);

  // ── Parse child MHODs ───────────────────────────────────────────
  const bodyEnd = startOffset + totalLen;
  const mhods: MhodRecord[] = [];
  for (let i = 0; i < mhodCount && reader.offset < bodyEnd; i++) {
    mhods.push(parseMhod(reader));
  }
  result.mhods = mhods;

  reader.seek(bodyEnd);
  return result;
}
