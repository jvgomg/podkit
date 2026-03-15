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
    soundCheckTracks: number;
  };
  /** Mount result requiring sudo */
  mountRequiresSudo?: boolean;
}

export interface TipDefinition {
  evaluate: (context: TipContext) => Tip | null;
}

const SOUND_CHECK_TIP: TipDefinition = {
  evaluate: ({ stats }) => {
    if (stats && stats.soundCheckTracks > 0 && stats.soundCheckTracks < stats.tracks) {
      return {
        message:
          'Some tracks are missing Sound Check data. Add normalization tags for consistent volume.',
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

const ALL_TIPS: TipDefinition[] = [SOUND_CHECK_TIP, MACOS_MOUNTING_TIP];

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
