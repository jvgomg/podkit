/**
 * Show Language transform for video tracks
 *
 * Parses language/region markers from series titles (e.g., "(JPN)" from
 * "Digimon Adventure (JPN)") and reformats them according to user config.
 *
 * When enabled: markers are displayed using the configured format string.
 * When disabled: markers are stripped from the display title.
 *
 * @module
 */

import type { ShowLanguageConfig, VideoTrackTransform, VideoTransformableTrack } from './types.js';
import { DEFAULT_SHOW_LANGUAGE_CONFIG } from './types.js';

// =============================================================================
// Language Code Mapping
// =============================================================================

/**
 * Map of language abbreviations to full names for expansion
 */
const LANGUAGE_EXPANSIONS: Record<string, string> = {
  jpn: 'Japanese',
  eng: 'English',
  chn: 'Chinese',
  kor: 'Korean',
  fre: 'French',
  ger: 'German',
  spa: 'Spanish',
  ita: 'Italian',
  por: 'Portuguese',
  rus: 'Russian',
  ara: 'Arabic',
  hin: 'Hindi',
  tha: 'Thai',
  vie: 'Vietnamese',
  usa: 'American',
};

/**
 * Known full language names (for reverse lookup — detect full names in parens)
 */
const FULL_LANGUAGE_NAMES = new Set(Object.values(LANGUAGE_EXPANSIONS).map((n) => n.toLowerCase()));

// =============================================================================
// Language Marker Parsing
// =============================================================================

/**
 * Result of parsing a language marker from a series title
 */
export interface LanguageMarkerParse {
  /** The base title without the language marker */
  baseTitle: string;
  /** The extracted language code or name (e.g., "JPN", "Japanese") */
  language: string;
  /** Whether the language was a full name or abbreviation */
  isFullName: boolean;
}

/**
 * Patterns for extracting language markers from series titles
 *
 * Ordered by specificity. Supports:
 * - Parenthesized: "Show (JPN)", "Show (Japanese)", "Show (USA Dub)"
 * - Bracketed: "Show [JPN]", "Show [Japanese]"
 */
const LANGUAGE_MARKER_PATTERNS: RegExp[] = [
  // (JPN), (ENG), (CHN), etc. — 3-letter codes in parens
  /\s*\(([A-Za-z]{3})\)\s*$/,
  // (Japanese), (Chinese), etc. — full names in parens
  /\s*\(([A-Za-z]+)\)\s*$/,
  // (USA Dub), (JPN Sub), etc. — code/name with qualifier in parens
  /\s*\(([A-Za-z]{3}\s+\w+)\)\s*$/,
  // [JPN], [ENG], etc. — codes in brackets
  /\s*\[([A-Za-z]{3})\]\s*$/,
  // [Japanese], [Chinese], etc. — full names in brackets
  /\s*\[([A-Za-z]+)\]\s*$/,
];

/**
 * Parse a language marker from a series title
 *
 * @param seriesTitle - The series title to parse
 * @returns Parse result if a language marker was found, null otherwise
 */
export function parseLanguageMarker(seriesTitle: string): LanguageMarkerParse | null {
  for (const pattern of LANGUAGE_MARKER_PATTERNS) {
    const match = seriesTitle.match(pattern);
    if (!match || !match[1]) continue;

    const rawLang = match[1];
    const lowerLang = rawLang.toLowerCase();

    // Check if it's a known language abbreviation
    if (LANGUAGE_EXPANSIONS[lowerLang]) {
      return {
        baseTitle: seriesTitle.slice(0, match.index).trimEnd(),
        language: rawLang,
        isFullName: false,
      };
    }

    // Check if it's a known full language name
    if (FULL_LANGUAGE_NAMES.has(lowerLang)) {
      return {
        baseTitle: seriesTitle.slice(0, match.index).trimEnd(),
        language: rawLang,
        isFullName: true,
      };
    }

    // Check for compound markers like "USA Dub", "JPN Sub"
    const compoundMatch = rawLang.match(/^([A-Za-z]{3})\s+/);
    if (compoundMatch && LANGUAGE_EXPANSIONS[compoundMatch[1]!.toLowerCase()]) {
      return {
        baseTitle: seriesTitle.slice(0, match.index).trimEnd(),
        language: rawLang,
        isFullName: false,
      };
    }
  }

  return null;
}

// =============================================================================
// Transform
// =============================================================================

/**
 * Apply the show language transform to a video track
 *
 * @param track - The video track to transform
 * @param config - Show language configuration
 * @returns The transformed track (same object if no changes)
 */
export function applyShowLanguage(
  track: VideoTransformableTrack,
  config: ShowLanguageConfig
): VideoTransformableTrack {
  if (!track.seriesTitle) return track;

  const parsed = parseLanguageMarker(track.seriesTitle);
  if (!parsed) return track;

  let newSeriesTitle: string;

  if (!config.enabled) {
    // Strip the language marker entirely
    newSeriesTitle = parsed.baseTitle;
  } else {
    // Determine the language text to display
    let langText = parsed.language;

    if (config.expand && !parsed.isFullName) {
      // Expand abbreviation to full name
      // Handle compound markers like "USA Dub" — only expand the code part
      const compoundMatch = langText.match(/^([A-Za-z]{3})(\s+.*)$/);
      if (compoundMatch) {
        const expanded = LANGUAGE_EXPANSIONS[compoundMatch[1]!.toLowerCase()];
        if (expanded) {
          langText = expanded + compoundMatch[2];
        }
      } else {
        const expanded = LANGUAGE_EXPANSIONS[langText.toLowerCase()];
        if (expanded) {
          langText = expanded;
        }
      }
    } else if (!config.expand && parsed.isFullName) {
      // Contract full name to abbreviation
      const lowerLang = parsed.language.toLowerCase();
      for (const [abbr, full] of Object.entries(LANGUAGE_EXPANSIONS)) {
        if (full.toLowerCase() === lowerLang) {
          langText = abbr.toUpperCase();
          break;
        }
      }
    }

    // Apply format string
    const formatted = config.format.replace('{}', langText);
    newSeriesTitle = `${parsed.baseTitle} ${formatted}`;
  }

  if (newSeriesTitle === track.seriesTitle) return track;

  return {
    ...track,
    seriesTitle: newSeriesTitle,
  };
}

/**
 * Show language transform object
 *
 * Conforms to VideoTrackTransform interface for use in the table-driven
 * video transform pipeline.
 */
export const showLanguageTransform: VideoTrackTransform<ShowLanguageConfig> = {
  name: 'showLanguage',
  defaultConfig: DEFAULT_SHOW_LANGUAGE_CONFIG,
  apply: applyShowLanguage,
};

/**
 * Expand a language abbreviation to its full name
 *
 * @param abbr - Language abbreviation (e.g., "JPN")
 * @returns Full name if known, or the abbreviation unchanged
 */
export function expandLanguage(abbr: string): string {
  return LANGUAGE_EXPANSIONS[abbr.toLowerCase()] ?? abbr;
}
