/**
 * Device identity for an iPod archive — resolution, persistence, and the
 * render contract.
 *
 * An iPod's identity can come from three places, in decreasing fidelity:
 *
 * 1. **Captured at dump time** (`podkit-device.json`). The dump stage runs while
 *    the device is live, so the CLI can resolve the full model — including over
 *    USB, the only source for devices that carry no on-disk `SysInfo` (every
 *    iPod shuffle). That result is persisted beside `raw dump/` and is
 *    authoritative for the transform.
 * 2. **Resolved offline from the dump** via `@podkit/devices-ipod`'s
 *    `resolveIpodModel`, cascading the on-disk `SysInfo`/SysInfoExtended
 *    identity bag (ModelNumStr, serial, FamilyID) plus libgpod's generation
 *    string. Richer than libgpod alone — it identifies models libgpod's older
 *    table returns `Invalid` for.
 * 3. **libgpod device capabilities** — the last resort, used only when the two
 *    above yield nothing.
 *
 * This module owns the {@link DumpDeviceIdentity} render contract, the persisted
 * {@link CapturedDeviceIdentity} shape, and {@link resolveDumpIdentity} which
 * applies the precedence. It never opens a device — the live USB resolution
 * happens in the CLI (which has `@podkit/core`) and is handed in as plain data,
 * keeping this a leaf module.
 *
 * @module
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '@podkit/libgpod-node';
import { readSysInfoExtended, readSysInfoModelNumber } from '@podkit/ipod-firmware';
import { resolveIpodModel, type IpodModel } from '@podkit/devices-ipod';

/** Filename of the captured device-identity artifact, at the dump root. */
export const DEVICE_IDENTITY_FILENAME = 'podkit-device.json';

/** Current schema version of {@link CapturedDeviceIdentity}. */
const SCHEMA_VERSION = 1;

/**
 * Device identity surfaced from a dump for rendering. Every field is best-effort
 * and may be absent when the device could not be fully identified.
 */
export interface DumpDeviceIdentity {
  /** Apple serial number. */
  serialNumber?: string;
  /** FireWire GUID. */
  firewireGuid?: string;
  /** Apple FamilyID integer. */
  familyId?: number;
  /** libgpod model identifier (e.g. `video_white`) — libgpod fallback only. */
  model?: string;
  /** Generation identifier (e.g. `video_1` / `shuffle_4`). */
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

/**
 * The persisted `podkit-device.json` shape — a serializable projection of the
 * live-resolved {@link IpodModel} plus the serial/GUID read at dump time. Every
 * model field is optional so a generation-only (USB) resolution still persists.
 */
export interface CapturedDeviceIdentity {
  /** Schema version, for forward compatibility. */
  schemaVersion: number;
  /** Human-readable model name (`IpodModel.displayName`). */
  displayName?: string;
  /** Generation identifier (`IpodModel.generationId`). */
  generationId?: string;
  /** Marketing family (`IpodModel.family`). */
  family?: string;
  /** Generation ordinal (`IpodModel.ordinal`). */
  ordinal?: number | null;
  /** Model number without prefix (`IpodModel.modelNumber`). */
  modelNumber?: string;
  /** Capacity in GB (`IpodModel.capacityGb`). */
  capacityGb?: number;
  /** Device colour (`IpodModel.color`). */
  color?: string;
  /** Variant tag (`IpodModel.variant`). */
  variant?: string;
  /** Apple serial number, when known at capture. */
  serialNumber?: string;
  /** FireWire GUID, when known at capture. */
  firewireGuid?: string;
}

/**
 * Build the persisted identity from a live-resolved model plus the serial/GUID
 * read at dump time. A `null` model (unidentifiable device) still persists
 * whatever serial/GUID was captured, so the record is never wholly empty.
 */
export function captureIdentity(
  model: IpodModel | null,
  extra: { serialNumber?: string; firewireGuid?: string }
): CapturedDeviceIdentity {
  const captured: CapturedDeviceIdentity = { schemaVersion: SCHEMA_VERSION };
  if (model) {
    captured.displayName = model.displayName;
    captured.generationId = model.generationId;
    captured.family = model.family;
    captured.ordinal = model.ordinal;
    if (model.modelNumber !== undefined) captured.modelNumber = model.modelNumber;
    if (model.capacityGb !== undefined) captured.capacityGb = model.capacityGb;
    if (model.color !== undefined) captured.color = model.color;
    if (model.variant !== undefined) captured.variant = model.variant;
  }
  if (extra.serialNumber) captured.serialNumber = extra.serialNumber;
  if (extra.firewireGuid) captured.firewireGuid = extra.firewireGuid;
  return captured;
}

/** Map a persisted capture onto the render contract. */
export function identityFromCaptured(captured: CapturedDeviceIdentity): DumpDeviceIdentity {
  const identity: DumpDeviceIdentity = {};
  if (captured.displayName) identity.modelName = captured.displayName;
  if (captured.generationId) identity.generation = captured.generationId;
  if (captured.modelNumber) identity.modelNumber = captured.modelNumber;
  if (captured.capacityGb !== undefined) identity.capacityGb = captured.capacityGb;
  if (captured.color) identity.color = captured.color;
  if (captured.variant) identity.variant = captured.variant;
  if (captured.serialNumber) identity.serialNumber = captured.serialNumber;
  if (captured.firewireGuid) identity.firewireGuid = captured.firewireGuid;
  return identity;
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

/** Persist the captured identity as `podkit-device.json` at the dump root. */
export async function writeCapturedIdentity(
  dumpDir: string,
  captured: CapturedDeviceIdentity
): Promise<void> {
  const path = join(dumpDir, DEVICE_IDENTITY_FILENAME);
  await writeFile(path, `${JSON.stringify(captured, null, 2)}\n`, 'utf8');
}

/**
 * Read `podkit-device.json` from the dump root. Returns null when the artifact
 * is absent, unreadable, or not a valid current-schema record — the caller then
 * falls back to offline resolution. Never throws.
 */
export async function readCapturedIdentity(
  dumpDir: string
): Promise<CapturedDeviceIdentity | null> {
  let raw: string;
  try {
    raw = await readFile(join(dumpDir, DEVICE_IDENTITY_FILENAME), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CapturedDeviceIdentity;
    // Only the current schema is understood. A future version is treated as
    // absent so the caller falls back to offline resolution rather than
    // mis-reading a differently-shaped record as v1.
    if (parsed?.schemaVersion !== SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
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

/**
 * Resolve a dump's device identity by precedence: captured live at dump time
 * (`podkit-device.json`), else offline via `resolveIpodModel` over the on-disk
 * identity bag, else libgpod's capabilities. Serial/GUID/FamilyID from the
 * on-disk SysInfoExtended are folded into the offline/libgpod paths.
 */
export async function resolveDumpIdentity(args: {
  db: Database;
  ipodRoot: string;
  dumpDir: string;
}): Promise<DumpDeviceIdentity> {
  const { db, ipodRoot, dumpDir } = args;

  // 1. A captured file that actually carries a model is authoritative — it was
  // resolved live (including over USB, the only source for shuffles). A capture
  // with *no* model (serial/GUID only — USB classification missed) must NOT
  // short-circuit: the on-disk SysInfo may still identify the model offline. Its
  // serial/GUID are folded into the base facts below instead.
  const captured = await readCapturedIdentity(dumpDir);
  if (captured && (captured.displayName || captured.generationId)) {
    return identityFromCaptured(captured);
  }

  // Base facts: a model-less capture's serial/GUID (read live) take precedence
  // over the on-disk SysInfoExtended, then fall back to it.
  const base: DumpDeviceIdentity = {};
  const sysInfo = readSysInfoExtended(ipodRoot);
  const serialNumber = captured?.serialNumber ?? sysInfo?.serialNumber;
  const firewireGuid = captured?.firewireGuid ?? sysInfo?.firewireGuid;
  if (serialNumber) base.serialNumber = serialNumber;
  if (firewireGuid) base.firewireGuid = firewireGuid;
  if (sysInfo?.identity.familyId !== undefined) base.familyId = sysInfo.identity.familyId;

  // 2. Offline model resolution over the full on-disk identity bag. The classic
  // SysInfo `ModelNumStr` is read directly — `readSysInfoExtended` returns null
  // when the *extended* plist is absent (common on second-hand iPods), so its
  // identity bag can't be relied on for the model number on its own. A captured
  // serial can also drive the serial-suffix lookup here.
  const model = resolveIpodModel({
    modelNumStr: sysInfo?.identity.modelNumStr ?? readSysInfoModelNumber(ipodRoot),
    serialNumber,
    familyId: sysInfo?.identity.familyId ?? null,
    libgpodGeneration: libgpodGeneration(db),
  });
  if (model) return { ...base, ...identityFromModel(model) };

  // 3. libgpod capabilities — last resort.
  return { ...base, ...identityFromLibgpod(db) };
}
