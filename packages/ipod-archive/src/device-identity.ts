/**
 * Device identity for an iPod archive — resolution, capture, and the render
 * contract.
 *
 * Identity is derived entirely from artifacts in the dump, using the same
 * readers the rest of podkit uses — no bespoke identity format:
 *
 * - **Name** comes from the iTunesDB master-playlist title (the iPod's own
 *   name, which the firmware reads from there), via the already-open database.
 * - **Model / generation / serial / capacity / colour** come from a
 *   SysInfoExtended plist run through `resolveIpodModel`: the on-disk file when
 *   the device carried one (copied faithfully into `raw/`), else a
 *   **captured sidecar** (`podkit-sysinfo-extended.xml`) that the dump stage
 *   reads read-only from firmware for devices with no on-disk SysInfo (every
 *   iPod shuffle). Writing that sidecar into the dump — never to the device —
 *   is how a read-only device's full identity survives into the offline
 *   transform.
 * - **libgpod capabilities** are the last resort, used only when no
 *   SysInfoExtended is available at all.
 *
 * This module owns the {@link DumpDeviceIdentity} render contract and
 * {@link resolveDumpIdentity}. It never opens a device — the read-only firmware
 * inquiry happens in the CLI (which has `@podkit/core`) and its XML is handed in
 * as plain data, keeping this a leaf module.
 *
 * @module
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '@podkit/libgpod-node';
import {
  readSysInfoExtended,
  readSysInfoModelNumber,
  parseSysInfoExtendedXml,
  type SysInfoExtendedResult,
} from '@podkit/ipod-firmware';
import { resolveIpodModel, type IpodModel } from '@podkit/devices-ipod';

/**
 * Filename of the captured SysInfoExtended sidecar, at the dump root. Written
 * (read-only to the device) only when the device carried no on-disk SysInfo, so
 * the raw dump stays a byte-faithful copy of the device.
 */
export const CAPTURED_SYSINFO_FILENAME = 'podkit-sysinfo-extended.xml';

/**
 * Device identity surfaced from a dump for rendering. Every field is best-effort
 * and may be absent when the device could not be fully identified.
 */
export interface DumpDeviceIdentity {
  /** The iPod's own name, from the iTunesDB master playlist. */
  name?: string;
  /** Apple serial number. */
  serialNumber?: string;
  /** FireWire GUID. */
  firewireGuid?: string;
  /** Apple FamilyID integer. */
  familyId?: number;
  /** libgpod model identifier (e.g. `video_white`) — libgpod fallback only. */
  model?: string;
  /** Generation identifier (e.g. `video_5g` / `shuffle_4g`). */
  generation?: string;
  /** Human-readable model name (e.g. `iPod shuffle (4th Generation)`). */
  modelName?: string;
  /** Model number without prefix (e.g. `A147`). */
  modelNumber?: string;
  /** Capacity in GB. */
  capacityGb?: number;
  /** Device colour (e.g. `Silver`), when the model resolves a variant. */
  color?: string;
  /** Variant tag (e.g. `U2`, `2015`), when the model carries one. */
  variant?: string;
}

/** Map a resolved {@link IpodModel} onto the render contract's model fields. */
function identityFromModel(model: IpodModel): DumpDeviceIdentity {
  const identity: DumpDeviceIdentity = {
    modelName: model.displayName,
    generation: model.generationId,
  };
  if (model.modelNumber !== undefined) identity.modelNumber = model.modelNumber;
  if (model.capacityGb !== undefined) identity.capacityGb = model.capacityGb;
  if (model.color !== undefined) identity.color = model.color;
  if (model.variant !== undefined) identity.variant = model.variant;
  return identity;
}

/** Persist a captured SysInfoExtended XML as the dump's sidecar. */
export async function writeCapturedSysInfo(dumpDir: string, xml: string): Promise<void> {
  await writeFile(join(dumpDir, CAPTURED_SYSINFO_FILENAME), xml, 'utf8');
}

/**
 * Read + parse the captured SysInfoExtended sidecar from the dump root. Returns
 * null when the sidecar is absent or unreadable. Never throws.
 */
export async function readCapturedSysInfo(dumpDir: string): Promise<SysInfoExtendedResult | null> {
  let xml: string;
  try {
    xml = await readFile(join(dumpDir, CAPTURED_SYSINFO_FILENAME), 'utf8');
  } catch {
    return null;
  }
  return parseSysInfoExtendedXml(xml);
}

/** Whether a libgpod capability string is a real value, not a sentinel. */
function isKnown(value: string | null | undefined): value is string {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower !== 'unknown' && lower !== 'invalid';
}

/**
 * Read libgpod's device capabilities as the last-resort identity. Best-effort:
 * libgpod returns `unknown`/`Invalid`/0 sentinels for devices absent from its
 * (older) info table — every such sentinel is treated as "not known".
 */
function identityFromLibgpod(db: Database): DumpDeviceIdentity {
  const identity: DumpDeviceIdentity = {};
  try {
    const caps = db.getDeviceCapabilities();
    if (isKnown(caps.model)) identity.model = caps.model;
    if (isKnown(caps.generation)) identity.generation = caps.generation;
    if (isKnown(caps.modelName)) identity.modelName = caps.modelName;
    if (isKnown(caps.modelNumber)) identity.modelNumber = caps.modelNumber;
    const capacity = db.device.capacity;
    if (capacity > 0) identity.capacityGb = capacity;
  } catch {
    // Capability read failed — the database still parsed, so this is non-fatal.
  }
  return identity;
}

/** libgpod's raw generation string (e.g. `video_1`), or undefined when unknown. */
function libgpodGeneration(db: Database): string | undefined {
  try {
    const gen = db.getDeviceCapabilities().generation;
    return isKnown(gen) ? gen : undefined;
  } catch {
    return undefined;
  }
}

/** The iPod's own name, from the iTunesDB master playlist, or undefined. */
function ipodNameFromDb(db: Database): string | undefined {
  try {
    return db.getMasterPlaylist()?.name?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a dump's device identity from its artifacts:
 *
 * - name from the iTunesDB master playlist;
 * - serial / GUID / FamilyID + model from a SysInfoExtended — the on-disk file
 *   (faithfully copied into `raw/`) if present, else the captured sidecar —
 *   run through `resolveIpodModel`;
 * - libgpod capabilities as the last resort.
 */
export async function resolveDumpIdentity(args: {
  db: Database;
  ipodRoot: string;
  dumpDir: string;
}): Promise<DumpDeviceIdentity> {
  const { db, ipodRoot, dumpDir } = args;

  const base: DumpDeviceIdentity = {};

  // Name — the iPod's own name lives in the iTunesDB, not the disk volume label.
  const name = ipodNameFromDb(db);
  if (name) base.name = name;

  // SysInfoExtended: the on-disk file (byte-faithful copy) first, else the
  // sidecar captured read-only from firmware for a SysInfo-less device.
  const sysInfo = readSysInfoExtended(ipodRoot) ?? (await readCapturedSysInfo(dumpDir));
  if (sysInfo?.serialNumber) base.serialNumber = sysInfo.serialNumber;
  if (sysInfo?.firewireGuid) base.firewireGuid = sysInfo.firewireGuid;
  if (sysInfo?.identity.familyId !== undefined) base.familyId = sysInfo.identity.familyId;

  // Model — offline resolution over the full identity bag. The classic SysInfo
  // `ModelNumStr` is read directly as a fallback because `readSysInfoExtended`
  // returns null when the *extended* plist is absent (some older iPods carry
  // only the classic SysInfo).
  const model = resolveIpodModel({
    modelNumStr: sysInfo?.identity.modelNumStr ?? readSysInfoModelNumber(ipodRoot),
    serialNumber: sysInfo?.serialNumber,
    familyId: sysInfo?.identity.familyId ?? null,
    libgpodGeneration: libgpodGeneration(db),
  });
  if (model) return { ...base, ...identityFromModel(model) };

  // Last resort: libgpod capabilities.
  return { ...base, ...identityFromLibgpod(db) };
}
