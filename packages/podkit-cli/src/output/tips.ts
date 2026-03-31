/**
 * Tips framework — actionable insights shown contextually across commands
 *
 * Tips are evaluated against a context object and rendered as display lines.
 * Each tip definition inspects only the context fields it cares about,
 * so callers only need to populate the fields relevant to their command.
 */

export interface Tip {
  message: string;
  url?: string;
}

/**
 * Context fields that tip definitions can inspect.
 * Each field is optional — tips check only the fields they care about.
 */
export interface TipContext {
  /** Content stats from a sync or device listing */
  stats?: {
    tracks: number;
    normalizedTracks: number;
  };
  /** Mount result requiring sudo */
  mountRequiresSudo?: boolean;
  /** Number of tracks with artwork but no artwork hash baseline (from sync) */
  artworkMissingBaseline?: number;
  /** Number of existing tracks whose transfer mode doesn't match current setting */
  transferModeMismatch?: number;
  /** Sync tag counts from device info */
  syncTagInfo?: {
    trackCount: number;
    syncTagCount: number;
    missingArt: number;
  };
}

export interface TipDefinition {
  evaluate: (context: TipContext) => Tip | null;
}

const NORMALIZATION_TIP: TipDefinition = {
  evaluate: ({ stats }) => {
    if (stats && stats.normalizedTracks > 0 && stats.normalizedTracks < stats.tracks) {
      return {
        message:
          'Some tracks are missing audio normalization data. Add ReplayGain or Sound Check tags for consistent volume.',
        url: 'https://jvgomg.github.io/podkit/user-guide/syncing/sound-check/',
      };
    }
    return null;
  },
};

const MACOS_MOUNTING_TIP: TipDefinition = {
  evaluate: ({ mountRequiresSudo }) => {
    if (mountRequiresSudo) {
      return {
        message: 'Learn more about macOS mounting issues with iFlash devices.',
        url: 'https://jvgomg.github.io/podkit/troubleshooting/macos-mounting/',
      };
    }
    return null;
  },
};

const ARTWORK_BASELINE_TIP: TipDefinition = {
  evaluate: ({ artworkMissingBaseline }) => {
    if (artworkMissingBaseline && artworkMissingBaseline > 0) {
      const plural = artworkMissingBaseline === 1 ? '' : 's';
      return {
        message: `${artworkMissingBaseline} track${plural} have artwork but no artwork hash in their sync tag. Run with --force-sync-tags --check-artwork to improve sync tag consistency for artwork change detection.`,
      };
    }
    return null;
  },
};

const NO_SYNC_TAGS_TIP: TipDefinition = {
  evaluate: ({ syncTagInfo }) => {
    if (syncTagInfo && syncTagInfo.trackCount > 0 && syncTagInfo.syncTagCount === 0) {
      return {
        message:
          "Your tracks have no sync tags. Run 'podkit sync --force-sync-tags' to establish sync tag consistency for reliable preset change detection.",
      };
    }
    return null;
  },
};

const TRANSFER_MODE_MISMATCH_TIP: TipDefinition = {
  evaluate: ({ transferModeMismatch }) => {
    if (transferModeMismatch && transferModeMismatch > 0) {
      const plural = transferModeMismatch === 1 ? '' : 's';
      const verb = transferModeMismatch === 1 ? 'was' : 'were';
      return {
        message: `${transferModeMismatch} track${plural} ${verb} synced with a different transfer mode. Use --force-transfer-mode to reprocess them with the current transfer mode setting.`,
      };
    }
    return null;
  },
};

const MISSING_ARTWORK_HASH_TIP: TipDefinition = {
  evaluate: ({ syncTagInfo }) => {
    if (syncTagInfo && syncTagInfo.missingArt > 0 && syncTagInfo.syncTagCount > 0) {
      const plural = syncTagInfo.missingArt === 1 ? '' : 's';
      return {
        message: `${syncTagInfo.missingArt} track${plural} have artwork but no artwork hash in their sync tag. Run 'podkit sync --check-artwork --force-sync-tags' to improve sync tag consistency for artwork change detection.`,
      };
    }
    return null;
  },
};

const ALL_TIPS: TipDefinition[] = [
  NORMALIZATION_TIP,
  MACOS_MOUNTING_TIP,
  ARTWORK_BASELINE_TIP,
  TRANSFER_MODE_MISMATCH_TIP,
  NO_SYNC_TAGS_TIP,
  MISSING_ARTWORK_HASH_TIP,
];

export function collectTips(context: TipContext): Tip[] {
  const tips: Tip[] = [];
  for (const def of ALL_TIPS) {
    const tip = def.evaluate(context);
    if (tip) tips.push(tip);
  }
  return tips;
}

/**
 * Format tips as display lines.
 * Returns an empty array if there are no tips.
 */
export function formatTips(tips: Tip[]): string[] {
  if (tips.length === 0) return [];
  const lines: string[] = [];
  for (const tip of tips) {
    lines.push(`Tip: ${tip.message}`);
    if (tip.url) {
      lines.push(`  See: ${tip.url}`);
    }
  }
  return lines;
}

/** Minimal output interface for printTips — avoids coupling to OutputContext */
interface TipOutput {
  newline(): void;
  print(message: string): void;
}

/**
 * Collect and print tips for a given context.
 * Prints nothing if no tips match. Adds a leading newline before tips.
 */
export function printTips(out: TipOutput, context: TipContext): void {
  const tips = collectTips(context);
  const lines = formatTips(tips);
  if (lines.length > 0) {
    out.newline();
    for (const line of lines) {
      out.print(line);
    }
  }
}
