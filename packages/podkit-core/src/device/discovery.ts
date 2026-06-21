/**
 * Discovered-device union — a single tagged record per physical device,
 * reconciled across the block-device pipeline ({@link PlatformDeviceInfo}
 * from `DeviceManager.scan`) and the USB-inquiry
 * pipeline ({@link ClassifiedUsbDevice} from `classifyUsbDevices`). One
 * union type, three arms (iPod / mass-storage / unsupported), each carrying
 * its own per-arm `matchedBy` enum.
 *
 * Why a per-arm `matchedBy` enum rather than a base type?
 * - **iPod** can match by `serial`, `disk-identifier`, `block-only`, or `usb-only`.
 * - **Mass-storage** has no serial-based matching path today (presets identify
 *   by VID/PID, not by Apple-format serial), so its enum is narrower:
 *   `disk-identifier` / `block-only` / `usb-only`.
 * - **Unsupported** is USB-only by invariant (we don't know what filesystem
 *   an unsupported device would expose, so block-side reconciliation is
 *   meaningless): `usb-only` only.
 *
 * Why no `<EnumeratedUsbDevice>` generic at this layer? The classification
 * functions (`classifyAsIpod`, `classifyAsMassStorage`) are generic over
 * the carrying USB-device shape so they can preserve richer types from
 * the caller. But by the time records reach `DiscoveredDevice`, the
 * carrying shape is always `EnumeratedUsbDevice` (the output of
 * `enumerateUsb`). Baking it in lets consumers consume the union without
 * threading a generic parameter through every helper.
 *
 * @module
 */

import type { DeviceAddIntent } from '@podkit/device-types';
import { formatIpodShortLabel, type IpodClassification } from '@podkit/devices-ipod';
import {
  formatPresetDisplay,
  formatPresetShortDisplay,
  type MassStorageClassification,
  type MassStoragePreset,
  type UnsupportedDeviceClassification,
} from '@podkit/devices-mass-storage';
import { stripPartitionSuffix } from './platforms/linux.js';
import type { ClassifiedUsbDevice } from './classify.js';
import { classifyUsbDevices } from './classify.js';
import { enumerateUsb } from './usb-enumeration.js';
import type { EnumeratedUsbDevice } from './usb-enumeration.js';
import type { DeviceManager, PlatformDeviceInfo } from './types.js';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A physical device discovered on the system, reconciled across both
 * discovery pipelines into a single record.
 *
 * Discriminated by `kind`. Each arm carries a `matchedBy` enum precise to
 * that arm — the union is intentionally **not** artificially symmetric.
 *
 * Producers (`reconcileDiscoveredDevices` / `discoverConnectedDevices`)
 * promise:
 * - one record per physical device,
 * - stable order (block-matched first by block order; remaining USB-only
 *   second by USB-classification order),
 * - replug stability — same inputs → equal records, same order.
 */
export type DiscoveredDevice =
  | DiscoveredDeviceIpod
  | DiscoveredDeviceMassStorage
  | DiscoveredDeviceUnsupported;

/**
 * A physical iPod, reconciled.
 *
 * `block` is the OS block-device side (a mounted volume or a probed
 * partition); `usb` is the USB-inquiry side (vendor/product ID classified
 * against the iPod USB tables). At least one is present; when both are
 * present, `matchedBy` records which key paired them.
 *
 * `matchedBy` values:
 * - `'serial'` — the USB serial-number string (Apple's 16-hex format)
 *   matched the block-side `usb.serialNumber`. Highest-confidence match.
 * - `'disk-identifier'` — the USB inquiry's `diskIdentifier` matched
 *   the block-side `identifier` after stripping any partition suffix on
 *   both sides (`disk2s1` ↔ `disk2`, `sdc1` ↔ `sdc`, `mmcblk0p1` ↔
 *   `mmcblk0`). Used on macOS, which doesn't surface a block-side
 *   `usb` fingerprint.
 * - `'block-only'` — no matching USB classification was found. The
 *   block side classified this as an iPod via {@link DeviceManager.scan}
 *   (media-type, FAT32+iPod_Control, etc.) but the USB enumeration didn't
 *   produce a corresponding iPod entry (e.g. libusb permission denial,
 *   sleeping device).
 * - `'usb-only'` — no block side. iOS device in restore mode, a powered-on
 *   iPod that hasn't presented as a mass-storage volume, FunctionFS-synthesised
 *   VM-test persona with no backing image.
 */
export interface DiscoveredDeviceIpod {
  kind: 'ipod';
  block?: PlatformDeviceInfo;
  usb?: IpodClassification<EnumeratedUsbDevice>;
  matchedBy: 'serial' | 'disk-identifier' | 'block-only' | 'usb-only';
}

/**
 * A physical mass-storage music player (Echo Mini, Rockbox-flashed iPod, …),
 * reconciled.
 *
 * `block` is the OS block-device side (a mounted volume); `usb` is the
 * USB-inquiry side (vendor/product ID classified against a registered
 * mass-storage preset). At least one is present.
 *
 * `block: undefined` is **valid and expected**: an Echo Mini that's plugged
 * in but powered off, or whose USB mode is not "mass-storage", still appears
 * as a USB-only `DiscoveredDeviceMassStorage`. `device scan` renders these as
 * `(echo-mini) — no volume mounted` so the user knows to switch the device
 * into the right USB mode.
 *
 * `matchedBy` values:
 * - `'disk-identifier'` — the USB inquiry's `diskIdentifier` matched the
 *   block-side `identifier` (partition suffix stripped on both sides).
 *   No `'serial'` path exists today because mass-storage presets identify
 *   by VID/PID, not by Apple-format serial.
 * - `'block-only'` — mounted volume that no preset claimed via USB classification.
 *   This happens when the block side is mass-storage but the USB layer didn't
 *   recognise the VID/PID. (In the orchestrator today this is impossible because
 *   `scan({ kinds: ['ipod'] })` pre-filters to iPods — see the orchestrator
 *   JSDoc — but the reconciler accepts the case for future callers that pass
 *   the full `scan()` output.)
 * - `'usb-only'` — recognised mass-storage USB but no block-device entry
 *   (powered off, wrong USB mode).
 */
export interface DiscoveredDeviceMassStorage {
  kind: 'mass-storage';
  block?: PlatformDeviceInfo;
  usb?: MassStorageClassification<EnumeratedUsbDevice>;
  matchedBy: 'disk-identifier' | 'block-only' | 'usb-only';
}

/**
 * A USB device that podkit recognises by VID but explicitly refuses to
 * support (Sony Walkman, generic non-music USB storage, …).
 *
 * Unsupported devices flow through the discovery pipeline so the CLI can
 * surface the canonical refusal reason (`"Sony Walkman is not yet
 * supported by podkit — no preset registered for USB 0x054c:0x…"`)
 * instead of silently dropping the device.
 *
 * By invariant, `matchedBy` is always `'usb-only'`: there is no sane block-side
 * reconciliation for an unsupported device because we don't know what filesystem
 * shape it would expose. `block` is left for future expansion (a hypothetical
 * "we identified an unsupported device by mountpoint heuristics" path) but is
 * never populated today.
 */
export interface DiscoveredDeviceUnsupported {
  kind: 'unsupported';
  block?: PlatformDeviceInfo;
  usb: UnsupportedDeviceClassification<EnumeratedUsbDevice>;
  matchedBy: 'usb-only';
}

// ── Display helpers ──────────────────────────────────────────────────────────

/**
 * Rendered strings for a {@link DiscoveredDevice}.
 *
 * Three fields:
 * - `short` — compact label for table cells (`'Echo Mini'`, `'iPod nano 3G'`).
 * - `rich` — full label for headlines and detail lines (`'FiiO Snowsky Echo Mini (echo-mini)'`,
 *   `'iPod nano 4GB Silver (2nd Generation)'`).
 * - `source` — where the identity came from. Diagnostic; consumers shouldn't
 *   branch on it for display logic (the strings already encode the right
 *   formatting). `'preset'` for mass-storage with a USB-classified preset,
 *   `'ipod-generation'` for iPods with a resolved model, `'usb-fingerprint'`
 *   for the block-only fallbacks (volume name etc.), `'unsupported-fallback'`
 *   for the unsupported arm.
 */
export interface DeviceDisplay {
  short: string;
  rich: string;
  source: 'preset' | 'ipod-generation' | 'usb-fingerprint' | 'unsupported-fallback';
}

/**
 * Compose a {@link DeviceDisplay} for a {@link DiscoveredDevice}.
 *
 * Reuses existing format helpers — `formatPresetDisplay` /
 * `formatPresetShortDisplay` from `@podkit/devices-mass-storage` for the
 * mass-storage arm, and the `IpodModel.displayName` baked into each
 * `IpodClassification` by `classifyAsIpod` for the iPod arm — rather than
 * re-implementing the label vocabulary.
 *
 * Pure: no I/O, no platform branches. Same input → same output.
 */
export function displayFor(d: DiscoveredDevice): DeviceDisplay {
  switch (d.kind) {
    case 'mass-storage':
      return displayForMassStorage(d);
    case 'ipod':
      return displayForIpod(d);
    case 'unsupported':
      return displayForUnsupported(d);
  }
}

function displayForMassStorage(d: DiscoveredDeviceMassStorage): DeviceDisplay {
  if (d.usb) {
    // Preset metadata is the authoritative source for vendor + product +
    // preset-id labels. Compose the two shared helpers rather than rolling
    // a new format here.
    return {
      short: formatPresetShortDisplay(d.usb.preset),
      rich: formatPresetDisplay(d.usb.presetId, d.usb.preset),
      source: 'preset',
    };
  }
  // Block-only mass-storage: no preset metadata available. Fall back to the
  // volume name as a best-effort label. (Today this path is unreachable from
  // `discoverConnectedDevices` because the orchestrator only feeds iPod-filtered
  // block devices — see the orchestrator JSDoc — but the reconciler can produce
  // this shape for future callers, so the renderer must handle it.)
  const volumeName = d.block?.volumeName?.trim();
  const label = volumeName && volumeName.length > 0 ? volumeName : 'USB storage';
  return { short: label, rich: label, source: 'usb-fingerprint' };
}

function displayForIpod(d: DiscoveredDeviceIpod): DeviceDisplay {
  // Preferred path: USB inquiry gave us a resolved model (built by
  // `classifyAsIpod` → `identify` during USB classification). Its
  // `family` + `ordinal` structured fields drive both labels — short uses
  // `formatIpodShortLabel`, rich uses the displayName already composed by
  // `identify()` via `formatIpodLabel`. See ADR-020.
  const usbModel = d.usb?.model;
  if (usbModel) {
    return {
      short: formatIpodShortLabel({ family: usbModel.family, ordinal: usbModel.ordinal }),
      rich: usbModel.displayName,
      source: 'ipod-generation',
    };
  }
  // Block-only iPod (no USB classification): fall back to volume name / "iPod".
  // The block-side data alone doesn't carry generation/model info — that
  // requires sysinfo probing, which is the readiness pipeline's job, not
  // discovery's. Discovery returns a stable label here; readiness fills in
  // the richer identity later.
  const volumeName = d.block?.volumeName?.trim();
  const fallback = volumeName && volumeName.length > 0 ? volumeName : 'iPod';
  return { short: fallback, rich: fallback, source: 'usb-fingerprint' };
}

function displayForUnsupported(d: DiscoveredDeviceUnsupported): DeviceDisplay {
  // The classifier provides a canonical refusal string (`reason`) and an
  // optional family label. Use the family as the short label when present;
  // the reason is always the rich text.
  const short = d.usb.family ?? 'Unsupported device';
  return { short, rich: d.usb.reason, source: 'unsupported-fallback' };
}

// ── displayForConfig (configured devices) ────────────────────────────────────

/**
 * Structural subset of a configured device the {@link displayForConfig}
 * helper reads.
 *
 * Pinned as a structural type so callers can pass either a raw TOML
 * `DeviceConfig` (`manufacturer: string`) or a `ResolvedDeviceSettings`
 * (resolved-with-provenance shape — `manufacturer: { value: string }`),
 * without coupling the helper signature to either CLI module. The
 * `{ value: string }` arm of each union covers the resolved form;
 * {@link unwrapDisplayField} projects both into a plain string.
 */
export interface DeviceDisplayInput {
  type?: string;
  manufacturer?: string | { value: string };
  productName?: string | { value: string };
}

/** Project a raw-or-Resolved display field to its plain string value. */
function unwrapDisplayField(v: string | { value: string } | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v : v.value;
}

/**
 * Compose a {@link DeviceDisplay} for a CONFIGURED device — the static-config
 * sibling of {@link displayFor}, which works on a live {@link DiscoveredDevice}.
 *
 * Where `displayFor` reads identity off a freshly-reconciled USB/block record,
 * `displayForConfig` reads the persisted TOML `type` + a preset registry. It
 * yields the same `{ short, rich }` shape so CLI call sites can render labels
 * for configured-but-not-necessarily-connected devices without branching on
 * the iPod-vs-mass-storage kind.
 *
 * Resolution, matching the long-standing CLI label helpers it replaces:
 * - iPod / undefined / unknown type → `{ short: 'iPod', rich: 'iPod' }`
 *   (the historical fallback — iPod rich labels come from the cascade /
 *   discovery pipeline elsewhere, not from config).
 * - mass-storage preset → short is the per-device `productName` override (if
 *   set) else `formatPresetShortDisplay(preset)`; rich is
 *   `'<manufacturer override ?? preset.manufacturer> <productName override ?? preset.productName> (<type>)'`,
 *   keeping the preset id as the `--type` token tail.
 *
 * Pure: no I/O, no platform branches. Same input → same output.
 */
export function displayForConfig(
  device: DeviceDisplayInput | undefined,
  presets: Record<string, MassStoragePreset>
): DeviceDisplay {
  const type = device?.type;
  // iPod / undefined / unknown type all collapse to the historical 'iPod'
  // fallback. `source: 'ipod-generation'` mirrors `displayForIpod`'s tag even
  // though config alone carries no resolved model — discovery / the cascade
  // fills the richer identity in when a live device is available.
  if (type === undefined || type === 'ipod') {
    return { short: 'iPod', rich: 'iPod', source: 'ipod-generation' };
  }
  const preset = presets[type];
  if (!preset) {
    // Unknown type — backward compat with the old switch: fall back to 'iPod'.
    return { short: 'iPod', rich: 'iPod', source: 'ipod-generation' };
  }
  const manufacturer = unwrapDisplayField(device?.manufacturer) ?? preset.manufacturer;
  const productName = unwrapDisplayField(device?.productName) ?? preset.productName;
  return {
    short: unwrapDisplayField(device?.productName) ?? formatPresetShortDisplay(preset),
    rich: `${manufacturer} ${productName} (${type})`,
    source: 'preset',
  };
}

// ── describeAddIntent dispatcher ────────────────────────────────────────────

/**
 * Build a CLI add-intent describing how the user would register this
 * device with `podkit device add`. Returns `null` when the device kind
 * can't be turned into an actionable suggestion (e.g. mass-storage with
 * no preset id, or any case where the user simply needs the standard
 * `device add` flow).
 *
 * Sibling to {@link displayFor} — same dispatch shape, per-kind helpers
 * below. Hosted here (next to the union and its display surface) so a
 * new device kind only needs one new function instead of a runtime-
 * registered provider in a separate package.
 *
 * The behaviour mirrors the pre-TASK-427 `DeviceProvider.describeAddIntent`
 * implementations in `@podkit/devices-ipod/src/provider.ts` and
 * `@podkit/devices-mass-storage/src/provider.ts` — lifted verbatim into
 * the discovery layer.
 */
export function describeAddIntent(d: DiscoveredDevice): DeviceAddIntent | null {
  switch (d.kind) {
    case 'ipod':
      return describeAddIntentForIpod(d);
    case 'mass-storage':
      return describeAddIntentForMassStorage(d);
    case 'unsupported':
      return describeAddIntentForUnsupported(d);
  }
}

function describeAddIntentForIpod(d: DiscoveredDeviceIpod): DeviceAddIntent | null {
  // Unsupported iPod (Touch / nano 6 / shuffle 3G/4G / iOS device): surface
  // the reason as a note. No add-command to suggest — but the user benefits
  // from knowing the device was *recognised*, just not supported.
  const reason = d.usb?.unsupportedReason;
  if (reason) {
    const { headline, docsUrl } = reason;
    return {
      providerId: 'ipod',
      kind: 'ipod',
      addArgs: [],
      notes: docsUrl ? [headline, `See: ${docsUrl}`] : [headline],
    };
  }
  // Supported iPod recognised via USB. The user's add command was the right
  // one; they just need to mount the device first (or check the USB
  // connection).
  if (d.usb) {
    return {
      providerId: 'ipod',
      kind: 'ipod',
      addArgs: [],
      notes: [
        '(iPod detected via USB but no mounted disk — try `podkit device mount` first, then re-run this command)',
      ],
    };
  }
  // Block-only iPod (no USB classification). Nothing actionable to suggest;
  // the device is presumably already mountable and the standard `device
  // add` flow will find it.
  return null;
}

function describeAddIntentForMassStorage(d: DiscoveredDeviceMassStorage): DeviceAddIntent | null {
  // Without a preset id there's nothing actionable to suggest — the CLI
  // would have nothing to pass to `--type`.
  const presetId = d.usb?.presetId;
  if (!presetId) return null;

  const addArgs: string[] = ['--type', presetId, '--path', '<mount-point>'];
  const notes: string[] = [];
  const diskIdentifier = d.usb?.device.diskIdentifier;
  if (diskIdentifier) {
    notes.push(`(disk: ${diskIdentifier} — mount it first if not already mounted)`);
  }
  const intent: DeviceAddIntent = {
    providerId: 'mass-storage',
    kind: presetId,
    addArgs,
  };
  return notes.length > 0 ? { ...intent, notes } : intent;
}

function describeAddIntentForUnsupported(d: DiscoveredDeviceUnsupported): DeviceAddIntent | null {
  // Surface the canonical refusal so the user knows the device was seen
  // but explicitly rejected. No addArgs — there's nothing to do.
  return {
    providerId: 'unsupported',
    kind: 'unsupported',
    addArgs: [],
    notes: [d.usb.reason],
  };
}

// ── Reconciliation ──────────────────────────────────────────────────────────

function nonEmpty(s: string | undefined | null): s is string {
  return typeof s === 'string' && s.length > 0;
}

/**
 * Classify a block-device record as iPod-like based on its block-side data.
 *
 * Used by {@link reconcileDiscoveredDevices} when a block device has no
 * matching USB classification: without USB inquiry, we have to guess
 * whether the block-only entry is an iPod or generic mass-storage.
 *
 * Today {@link discoverConnectedDevices} only feeds this function with
 * already-iPod-filtered block devices (from
 * {@link DeviceManager.scan}`({ kinds: ['ipod'] })`),
 * so every block-only entry IS an iPod and this heuristic always returns
 * `true`. The heuristic is kept as a defensive narrow for future callers
 * that may pass the full `scan()` output — they will get correct
 * classification provided the platform populates `mediaType` (macOS) or
 * the volume is iPod-shaped.
 *
 * **Safety note for future callers:** the `volumeName === 'IPOD'` fallback
 * is unsafe against the full `scan()` stream — a generic FAT32 stick
 * a user happened to label "IPOD" would misclassify. Future callers passing
 * unfiltered block lists should combine this heuristic with a stronger
 * signal (USB-side classification, iPod_Control directory probe, etc.)
 * before treating the result as authoritative.
 *
 * @internal
 */
function blockLooksLikeIpod(block: PlatformDeviceInfo): boolean {
  // macOS surfaces `mediaType: 'iPod'` when diskutil's `Device / Media Name`
  // contains the iPod string.
  if (block.mediaType?.toLowerCase().includes('ipod')) return true;
  // Heuristic fallback: a `IPOD`-labelled volume (the historical default
  // iTunes-formatted name) on FAT32 / HFS+ is treated as an iPod when no
  // mediaType is available (Linux path).
  if (block.volumeName?.toUpperCase() === 'IPOD') return true;
  return false;
}

/**
 * Reconcile block-device records and USB-classified records into one record
 * per physical device.
 *
 * Pure: no I/O, no platform branches. Stable: calling twice with the same
 * inputs returns equal records in the same order (block-matched records
 * preserve block order; remaining USB records preserve USB order).
 *
 * Matching rules:
 *  1. **Serial-number match (iPod only)** — when both sides carry a non-empty
 *     serial and they're equal, fold into one `DiscoveredDeviceIpod` record
 *     (`matchedBy: 'serial'`).
 *  2. **Disk-identifier match (iPod + mass-storage)** — when the USB classification's
 *     `device.diskIdentifier` matches the block's `identifier` after stripping
 *     any partition suffix from both sides, fold into one record
 *     (`matchedBy: 'disk-identifier'`). The kind comes from the USB side.
 *  3. **Unsupported devices are never matched against block devices.** Each
 *     unsupported entry emits a USB-only `DiscoveredDeviceUnsupported`.
 *  4. **Unmatched block devices** — classified as `'ipod'` if
 *     {@link blockLooksLikeIpod} says so, else `'mass-storage'`. `matchedBy: 'block-only'`.
 *  5. **Unmatched USB entries** — emitted with the corresponding kind and
 *     `matchedBy: 'usb-only'`.
 *
 * Each USB entry matches at most one block record (the first by input order);
 * each block record matches at most one USB entry.
 */
export function reconcileDiscoveredDevices(
  blockDevices: PlatformDeviceInfo[],
  classified: ClassifiedUsbDevice[]
): DiscoveredDevice[] {
  const records: DiscoveredDevice[] = [];
  const claimedUsbIndices = new Set<number>();

  for (const block of blockDevices) {
    const matched = findMatchingUsbForBlock(block, classified, claimedUsbIndices);
    if (matched) {
      claimedUsbIndices.add(matched.index);
      // Kind comes from the USB side. Unsupported is impossible here because
      // findMatchingUsbForBlock skips unsupported entries.
      if (matched.usb.kind === 'ipod') {
        records.push({ kind: 'ipod', block, usb: matched.usb, matchedBy: matched.matchedBy });
      } else {
        // mass-storage. Serial-match is iPod-only, so the matchedBy is always
        // disk-identifier here — the narrow type captures that invariant.
        records.push({
          kind: 'mass-storage',
          block,
          usb: matched.usb,
          matchedBy: 'disk-identifier',
        });
      }
    } else {
      // No USB match — fall back to block-side classification.
      if (blockLooksLikeIpod(block)) {
        records.push({ kind: 'ipod', block, matchedBy: 'block-only' });
      } else {
        records.push({ kind: 'mass-storage', block, matchedBy: 'block-only' });
      }
    }
  }

  for (let i = 0; i < classified.length; i++) {
    if (claimedUsbIndices.has(i)) continue;
    const usb = classified[i]!;
    switch (usb.kind) {
      case 'ipod':
        records.push({ kind: 'ipod', usb, matchedBy: 'usb-only' });
        break;
      case 'mass-storage':
        records.push({ kind: 'mass-storage', usb, matchedBy: 'usb-only' });
        break;
      case 'unsupported':
        records.push({ kind: 'unsupported', usb, matchedBy: 'usb-only' });
        break;
    }
  }

  return records;
}

/**
 * Find the first USB classification that matches the given block device.
 *
 * Skips USB entries already claimed by an earlier block (each USB record
 * matches at most one block). Skips `'unsupported'` entries entirely (per
 * the {@link DiscoveredDeviceUnsupported} invariant).
 *
 * Match priority:
 *  1. Serial-number (iPod only — mass-storage classifications don't
 *     carry an Apple-format serial today).
 *  2. Disk-identifier (iPod + mass-storage; partition suffix stripped on both sides).
 *
 * @internal
 */
function findMatchingUsbForBlock(
  block: PlatformDeviceInfo,
  classified: ClassifiedUsbDevice[],
  claimed: ReadonlySet<number>
):
  | {
      usb: IpodClassification<EnumeratedUsbDevice> | MassStorageClassification<EnumeratedUsbDevice>;
      index: number;
      matchedBy: 'serial' | 'disk-identifier';
    }
  | undefined {
  // Priority 1: serial-number match (iPod only).
  const blockSerial = block.usb?.serialNumber;
  if (nonEmpty(blockSerial)) {
    for (let i = 0; i < classified.length; i++) {
      if (claimed.has(i)) continue;
      const candidate = classified[i]!;
      if (candidate.kind !== 'ipod') continue;
      const usbSerial = candidate.device.serialNumber;
      if (nonEmpty(usbSerial) && usbSerial === blockSerial) {
        return { usb: candidate, index: i, matchedBy: 'serial' };
      }
    }
  }

  // Priority 2: disk-identifier match (iPod + mass-storage; not unsupported).
  const blockWholeDisk = stripPartitionSuffix(block.identifier);
  for (let i = 0; i < classified.length; i++) {
    if (claimed.has(i)) continue;
    const candidate = classified[i]!;
    if (candidate.kind === 'unsupported') continue;
    const usbDisk = candidate.device.diskIdentifier;
    if (!nonEmpty(usbDisk)) continue;
    if (stripPartitionSuffix(usbDisk) === blockWholeDisk) {
      return { usb: candidate, index: i, matchedBy: 'disk-identifier' };
    }
  }

  return undefined;
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Options for {@link discoverConnectedDevices}.
 */
export interface DiscoverConnectedDevicesOptions {
  /**
   * The platform device manager. Provides the block-device side
   * ({@link DeviceManager.scan}`({ kinds: ['ipod'] })`). Required.
   */
  deviceManager: DeviceManager;
  /**
   * Mass-storage presets in scope. Forwarded to `classifyUsbDevices` so the
   * USB-classification step recognises user-defined `[presets.X]` DAPs in
   * addition to the built-in set. When omitted, only built-in presets are
   * matched. CLI consumers should pass `mergedPresets(config)`.
   */
  massStoragePresets?: Record<string, MassStoragePreset>;
  /**
   * Override for the USB enumeration step. Defaults to the package-level
   * {@link enumerateUsb}. Test seam.
   */
  enumerate?: () => Promise<EnumeratedUsbDevice[]>;
  /**
   * Override for the USB classification step. Defaults to the package-level
   * {@link classifyUsbDevices}. Test seam.
   */
  classify?: (devices: EnumeratedUsbDevice[]) => ClassifiedUsbDevice[];
}

/**
 * End-to-end device discovery: enumerate USB, classify, list block devices,
 * reconcile, return one record per physical device.
 *
 * Returns an empty list when the device manager reports the platform is
 * unsupported (Windows today) — symmetric with how `device scan` skips the
 * block-device pipeline when `manager.isSupported === false`.
 *
 * **Block-only kind classification — judgement call.** The orchestrator
 * calls `manager.scan({ kinds: ['ipod'] })`, which pre-filters to iPods
 * (media-type, `IPOD` volume label, etc.). Every block-only entry from this
 * orchestrator is therefore an iPod — the {@link blockLooksLikeIpod} fallback
 * in {@link reconcileDiscoveredDevices} is defensive only for callers that
 * supply the full `scan()` output. The reconciler is the more general
 * primitive; this orchestrator preserves today's iPod-centric behaviour.
 */
export async function discoverConnectedDevices(
  opts: DiscoverConnectedDevicesOptions
): Promise<DiscoveredDevice[]> {
  const { deviceManager } = opts;
  const enumerate = opts.enumerate ?? enumerateUsb;
  // Arrow-wrap so the seam type takes only `EnumeratedUsbDevice[]` — the
  // real `classifyUsbDevices` takes an optional second `options` arg the
  // seam doesn't expose. Threads `massStoragePresets` through so user-
  // defined `[presets.X]` DAPs are recognised at classification time.
  const classify =
    opts.classify ??
    ((devices) => classifyUsbDevices(devices, { massStoragePresets: opts.massStoragePresets }));

  if (!deviceManager.isSupported) return [];

  const [blockDevices, enumerated] = await Promise.all([
    deviceManager.scan({ kinds: ['ipod'] }),
    enumerate(),
  ]);
  const classified = classify(enumerated);
  return reconcileDiscoveredDevices(blockDevices, classified);
}
