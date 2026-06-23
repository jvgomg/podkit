/**
 * Pure derivation of an on-disk volume label from a device name.
 *
 * The case-correct device name (e.g. "Party iPod") lives in the iTunesDB
 * master-playlist name. The OS volume label is a *separate, lossier* surface:
 *
 * - **FAT** (FAT16/FAT32): labels are upper-case-folded, limited to **11
 *   characters**, and reject a handful of characters. Rendering "Party iPod"
 *   onto a FAT volume yields "PARTY IPOD" — a lossy transform we surface to the
 *   user so they understand why the Finder/Explorer label differs from the name
 *   the iPod displays.
 * - **HFS+**: labels preserve case and allow long names (HFS+ permits up to 255
 *   UTF-16 code units). Only genuinely-illegal characters (`:`, the HFS path
 *   separator) are stripped, so the transform is usually loss-free.
 *
 * This module is pure and total: it never throws on normal input and handles
 * empty / whitespace-only names defensively. The platform layer is responsible
 * for mapping an OS filesystem string (e.g. "MS-DOS FAT32", "vfat",
 * "Apple_HFS", "hfsplus") onto the {@link VolumeFilesystem} enum before calling
 * here — keeping that OS-string knowledge out of this pure function.
 */

/**
 * Filesystem families that have distinct volume-label rules. The platform
 * layer maps OS-reported filesystem strings onto these.
 */
export type VolumeFilesystem = 'fat' | 'hfs';

/** Result of deriving a volume label from a device name. */
export interface LabelFromNameResult {
  /** The label to write to the volume. */
  label: string;
  /**
   * Whether the derived label dropped information from the name — characters
   * were stripped or the name was truncated to fit. Case-folding to uppercase
   * on FAT is NOT considered lossy: it's an expected, at-a-glance-obvious
   * transform (the caller shows the resulting label anyway), so it does not
   * warrant a warning. `warning` is present iff `lossy` is `true`.
   */
  lossy: boolean;
  /**
   * Human-readable explanation of the lossy transform, suitable for surfacing
   * to the user. Present only when `lossy` is `true` (i.e. characters were
   * dropped or the name was truncated — not for mere case-folding).
   */
  warning?: string;
}

/** FAT volume labels are limited to 11 characters. */
const FAT_LABEL_MAX_LENGTH = 11;

/**
 * Characters illegal in a FAT volume label. FAT labels disallow the characters
 * that are illegal in 8.3 filenames plus a few label-specific ones. We strip
 * (rather than reject) so the function stays total. The \x00-\x1f range
 * intentionally matches control characters so they are stripped from labels.
 */
// eslint-disable-next-line no-control-regex -- control chars are deliberately stripped
const FAT_ILLEGAL_CHARS = /[*?.,;:+=[\]/\\"|<>\x00-\x1f]/g;

/**
 * Characters illegal in an HFS+ volume label. HFS+ uses `:` as its path
 * separator, so it is the one character the Finder forbids in a volume name
 * (it is silently shown as `/` and stored as `:`). Control characters are also
 * stripped defensively.
 */
// eslint-disable-next-line no-control-regex -- control chars are deliberately stripped
const HFS_ILLEGAL_CHARS = /[:\x00-\x1f]/g;

/** HFS+ permits volume names up to 255 UTF-16 code units. */
const HFS_LABEL_MAX_LENGTH = 255;

/**
 * Derive a volume label from a device name for the given filesystem family.
 *
 * @param name - The case-correct device name (e.g. "Party iPod").
 * @param fs - The filesystem family the label is being written to.
 * @returns The derived label plus whether the transform was lossy.
 */
export function labelFromName(name: string, fs: VolumeFilesystem): LabelFromNameResult {
  const trimmed = name.trim();

  if (fs === 'fat') {
    return fatLabel(trimmed);
  }
  return hfsLabel(trimmed);
}

function fatLabel(name: string): LabelFromNameResult {
  const stripped = name.replace(FAT_ILLEGAL_CHARS, '');
  const folded = stripped.toUpperCase();
  const truncated = folded.slice(0, FAT_LABEL_MAX_LENGTH).trimEnd();

  // Content loss — warn-worthy — means characters were removed or the name was
  // too long to fit. Pure case-folding ("GreenPod" → "GREENPOD") is expected and
  // NOT lossy: the caller prints the resulting label, so a warning adds noise.
  const charsStripped = stripped !== name;
  const wasTruncated = folded.length > FAT_LABEL_MAX_LENGTH;
  const lossy = charsStripped || wasTruncated;

  if (!lossy) {
    return { label: truncated, lossy: false };
  }

  return {
    label: truncated,
    lossy: true,
    warning: `The disk label "${truncated}" differs from the name — FAT volume labels are uppercase, limited to ${FAT_LABEL_MAX_LENGTH} characters, and exclude some punctuation.`,
  };
}

function hfsLabel(name: string): LabelFromNameResult {
  const stripped = name.replace(HFS_ILLEGAL_CHARS, '');
  const truncated = stripped.slice(0, HFS_LABEL_MAX_LENGTH);

  // HFS+ preserves case, so the only warn-worthy losses are stripped characters
  // or truncation past the (very high) length limit.
  const charsStripped = stripped !== name;
  const wasTruncated = stripped.length > HFS_LABEL_MAX_LENGTH;
  const lossy = charsStripped || wasTruncated;

  if (!lossy) {
    return { label: truncated, lossy: false };
  }

  return {
    label: truncated,
    lossy: true,
    warning: `The disk label "${truncated}" differs from the name — some characters or length are not permitted in a volume label.`,
  };
}

/**
 * Map an OS-reported filesystem string onto a {@link VolumeFilesystem} family.
 *
 * Recognises both macOS diskutil strings ("MS-DOS FAT32", "Apple_HFS",
 * "Windows_FAT_32") and Linux lsblk/findmnt `fstype` values ("vfat", "hfsplus",
 * "hfs"). Comparison is case-insensitive. Returns `null` for filesystems with
 * no known label-relabel path (e.g. APFS, exFAT) so callers can refuse rather
 * than guess.
 *
 * @param filesystem - The raw filesystem string from the platform probe.
 * @returns The label-rule family, or `null` if unrecognised / unsupported.
 */
export function classifyVolumeFilesystem(filesystem: string | undefined): VolumeFilesystem | null {
  if (!filesystem) return null;
  const f = filesystem.toLowerCase();

  // exFAT is NOT FAT16/32 — it has different label rules and `fatlabel`/
  // diskutil's FAT label path does not apply. Refuse rather than mis-truncate.
  if (f.includes('exfat')) {
    return null;
  }

  // FAT family: macOS "MS-DOS FAT32" / "Windows_FAT_32" / "DOS_FAT_32",
  // Linux "vfat" / "msdos".
  if (f.includes('fat') || f.includes('msdos') || f.includes('ms-dos')) {
    return 'fat';
  }

  // HFS family: macOS "Apple_HFS" / "HFS+" / "Mac OS Extended",
  // Linux "hfsplus" / "hfs". Exclude APFS, which is not HFS.
  if (f.includes('apfs')) {
    return null;
  }
  if (f.includes('hfs') || f.includes('mac os extended')) {
    return 'hfs';
  }

  return null;
}
