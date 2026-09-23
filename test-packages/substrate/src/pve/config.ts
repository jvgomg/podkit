/**
 * Machine-specific Proxmox configuration, read from the environment.
 *
 * Nothing here has a value in the repo. Which hypervisor, which token, which
 * VMID fills a registry role — all facts about one developer's infrastructure,
 * so they live in the gitignored env file beside the ssh alias, for the reason
 * ADR-029 §2 gives. The repo declares the role; the machine declares the guest.
 *
 * Absent configuration is an ordinary state, not an error: without it the
 * lifecycle verbs print their manual `qm` equivalent and everything else works
 * over the ssh link. PARTIAL configuration is not ordinary — it is a half-typed
 * setup, and degrading silently there would hide the typo.
 *
 * @module
 */

import type { VmDefinition } from '../registry.js';

/** Base URL of the PVE API, e.g. `https://pve.example:8006`. */
export const PVE_API_URL_ENV = 'PODKIT_PVE_API_URL';
/** Token id in PVE's `user@realm!tokenname` form. */
export const PVE_TOKEN_ID_ENV = 'PODKIT_PVE_TOKEN_ID';
/** Token secret, printed once at creation. */
export const PVE_TOKEN_SECRET_ENV = 'PODKIT_PVE_TOKEN_SECRET';
/** SHA-256 fingerprint of the host's TLS certificate. Optional. */
export const PVE_TLS_FINGERPRINT_ENV = 'PODKIT_PVE_TLS_FINGERPRINT';
/** Pool the substrates live in — the unit the token's ACL is scoped to. */
export const PVE_POOL_ENV = 'PODKIT_PVE_POOL';
/** Space-separated storages: disk storage first, snippet/image storage second. */
export const PVE_STORAGE_ENV = 'PODKIT_PVE_STORAGE';
/** Bridge a substrate's NIC attaches to. */
export const PVE_BRIDGE_ENV = 'PODKIT_PVE_BRIDGE';

/** Defaults matching the reference recipe in `docs/environments/`. */
export const DEFAULT_PVE_POOL = 'podkit';
export const DEFAULT_PVE_STORAGES = ['local-lvm', 'local'] as const;
export const DEFAULT_PVE_BRIDGE = 'vmbr0';

/** The three keys without which no API call can be made. */
const REQUIRED_ENV = [PVE_API_URL_ENV, PVE_TOKEN_ID_ENV, PVE_TOKEN_SECRET_ENV] as const;

/** Every key this module reads, for "did the operator configure anything?". */
const ALL_ENV = [
  ...REQUIRED_ENV,
  PVE_TLS_FINGERPRINT_ENV,
  PVE_POOL_ENV,
  PVE_STORAGE_ENV,
  PVE_BRIDGE_ENV,
] as const;

/** Environment variable holding the VMID for a registry entry. */
export function pveVmidEnvVar(substrateId: string): string {
  const snake = substrateId
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll('-', '_')
    .toUpperCase();
  return `PODKIT_PVE_VMID_${snake}`;
}

/** Resolved Proxmox connection settings. */
export interface PveConfig {
  /** Base URL, trailing slash stripped. */
  readonly apiUrl: URL;
  readonly tokenId: string;
  readonly tokenSecret: string;
  /** Pinned certificate fingerprint, or `null` for system-CA validation. */
  readonly tlsFingerprint: string | null;
  readonly pool: string;
  /** Storage VM disks are allocated on. */
  readonly diskStorage: string;
  /** Storage holding the cloud-init snippet and the pinned image. */
  readonly snippetStorage: string;
  readonly bridge: string;
}

/** Whether this machine can drive PVE, and what is missing if not. */
export type PveConfigResolution =
  | { readonly available: true; readonly config: PveConfig }
  | {
      readonly available: false;
      /** Required keys that are unset. */
      readonly missing: readonly string[];
      /**
       * Some PVE keys are set and others are not. Unlike a wholly unconfigured
       * machine, this is a mistake to report rather than a mode to support.
       */
      readonly partial: boolean;
    };

/** A configured value that cannot be used as given. */
export class PveConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PveConfigError';
  }
}

function trimmed(env: Readonly<Record<string, string | undefined>>, key: string): string {
  return env[key]?.trim() ?? '';
}

/** Resolve PVE settings from an environment. Pure; no I/O, no process reads. */
export function resolvePveConfig(
  env: Readonly<Record<string, string | undefined>>
): PveConfigResolution {
  const missing = REQUIRED_ENV.filter((key) => !trimmed(env, key));
  if (missing.length > 0) {
    return {
      available: false,
      missing,
      partial: ALL_ENV.some((key) => trimmed(env, key).length > 0),
    };
  }

  const rawUrl = trimmed(env, PVE_API_URL_ENV);
  let apiUrl: URL;
  try {
    apiUrl = new URL(rawUrl.replace(/\/+$/, ''));
  } catch {
    throw new PveConfigError(
      `${PVE_API_URL_ENV}='${rawUrl}' is not a URL. It is a full base URL including the ` +
        `scheme and port, e.g. https://pve.example:8006 — not a bare hostname.`
    );
  }
  if (apiUrl.protocol !== 'https:') {
    throw new PveConfigError(
      `${PVE_API_URL_ENV}='${rawUrl}' is ${apiUrl.protocol.replace(':', '')}. ` +
        `The API token is a bearer credential and is only ever sent over https.`
    );
  }

  const tokenId = trimmed(env, PVE_TOKEN_ID_ENV);
  if (!tokenId.includes('!') || !tokenId.includes('@')) {
    throw new PveConfigError(
      `${PVE_TOKEN_ID_ENV}='${tokenId}' is not a PVE token id. The full form is ` +
        `'user@realm!tokenname' — the realm and the token name are both required.`
    );
  }

  const storages = trimmed(env, PVE_STORAGE_ENV).split(/\s+/).filter(Boolean);
  const [diskStorage = DEFAULT_PVE_STORAGES[0], snippetStorage = DEFAULT_PVE_STORAGES[1]] =
    storages;

  return {
    available: true,
    config: {
      apiUrl,
      tokenId,
      tokenSecret: trimmed(env, PVE_TOKEN_SECRET_ENV),
      tlsFingerprint: trimmed(env, PVE_TLS_FINGERPRINT_ENV) || null,
      pool: trimmed(env, PVE_POOL_ENV) || DEFAULT_PVE_POOL,
      diskStorage,
      // A single-entry list means disks and snippets share one storage. Both
      // still have to be granted; the recipe loops over whatever is named.
      snippetStorage: snippetStorage ?? diskStorage,
      bridge: trimmed(env, PVE_BRIDGE_ENV) || DEFAULT_PVE_BRIDGE,
    },
  };
}

/**
 * VMID of the guest filling a registry role on this machine, or `null` when
 * this machine does not have one.
 */
export function resolvePveVmid(
  substrate: VmDefinition,
  env: Readonly<Record<string, string | undefined>>
): number | null {
  const key = pveVmidEnvVar(substrate.id);
  const raw = trimmed(env, key);
  if (!raw) return null;
  const vmid = Number(raw);
  if (!Number.isInteger(vmid) || vmid < 100) {
    throw new PveConfigError(
      `${key}='${raw}' is not a VMID. PVE guest ids are integers of 100 or more.`
    );
  }
  return vmid;
}
