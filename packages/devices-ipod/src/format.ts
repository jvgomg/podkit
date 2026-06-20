/**
 * Display formatters for iPod identity.
 *
 * `formatIpodLabel` produces the rich label that lives on `IpodModel.displayName`.
 * `formatIpodShortLabel` produces the compact `iPod nano 3G` form for table
 * cells.
 *
 * Both compose from the structured family + ordinal fields per ADR-020. The
 * formatters are the only place that decides on capitalisation, parenthesis,
 * or ordinal-suffix rendering — tables carry no display strings.
 *
 * @module
 */

/** Inputs to the formatters — a flat shape matching `IpodModel`'s relevant fields. */
export interface IpodLabelParts {
  family: string;
  ordinal: number | null;
  capacityGb?: number;
  color?: string;
  variant?: string;
}

/**
 * Compose a rich display label.
 *
 * Shape: `${family}[ ${variant}][ ${capacity}][ ${color}][ (${ordinal-suffix} Generation)]`.
 *
 * Examples:
 * - `{ family: 'iPod nano', ordinal: 3 }` → `iPod nano (3rd Generation)`
 * - `{ family: 'iPod nano', ordinal: 2, capacityGb: 4, color: 'Silver' }`
 *   → `iPod nano 4GB Silver (2nd Generation)`
 * - `{ family: 'iPod', ordinal: 4, variant: 'U2', capacityGb: 25 }`
 *   → `iPod U2 25GB (4th Generation)`
 * - `{ family: 'iPod Photo', ordinal: null, capacityGb: 40 }`
 *   → `iPod Photo 40GB`
 * - `{ family: 'iPod Video', ordinal: 5.5 }`
 *   → `iPod Video (5.5th Generation)`
 */
export function formatIpodLabel(parts: IpodLabelParts): string {
  const segments: string[] = [parts.family];
  if (parts.variant) segments.push(parts.variant);
  if (parts.capacityGb !== undefined) segments.push(formatCapacity(parts.capacityGb));
  if (parts.color) segments.push(parts.color);
  if (parts.ordinal !== null && parts.ordinal !== undefined) {
    segments.push(`(${formatOrdinal(parts.ordinal)} Generation)`);
  }
  return segments.join(' ');
}

/**
 * Compose a compact label suitable for table cells.
 *
 * Shape: `${family} ${ordinal}G` when an ordinal is known, otherwise just
 * `${family}`. Decimal ordinals are preserved (`5.5G`).
 *
 * Examples:
 * - `{ family: 'iPod nano', ordinal: 3 }` → `iPod nano 3G`
 * - `{ family: 'iPod Video', ordinal: 5.5 }` → `iPod Video 5.5G`
 * - `{ family: 'iPod Photo', ordinal: null }` → `iPod Photo`
 */
export function formatIpodShortLabel(parts: Pick<IpodLabelParts, 'family' | 'ordinal'>): string {
  if (parts.ordinal === null || parts.ordinal === undefined) return parts.family;
  return `${parts.family} ${parts.ordinal}G`;
}

function formatCapacity(capacityGb: number): string {
  if (capacityGb < 1) return `${Math.round(capacityGb * 1024)}MB`;
  return `${capacityGb}GB`;
}

function formatOrdinal(n: number): string {
  // For integer ordinals, attach -st/-nd/-rd/-th. For decimals (5.5), always -th.
  if (!Number.isInteger(n)) return `${n}th`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
}
