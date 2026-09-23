/**
 * A hand-rolled Proxmox VE API client (ADR-029 §3): six endpoint groups, one
 * auth header, form-encoded bodies.
 *
 * `fetch` and the certificate probe are injectable — the test seam for every
 * request path, header, body and error mapping.
 *
 * Mutating calls return a UPID rather than completing, so each is followed by
 * polling the task; skipping that reads a status that is still the old one.
 *
 * @module
 */

import { pveApiError, type PveApiError } from './errors.js';
import {
  resolvePinnedTls,
  probeCertificateOverTls,
  type PinnedTlsOptions,
  type ProbeCertificateFn,
} from './tls.js';
import type { PveConfig } from './config.js';

/** The API could not be reached at all — DNS, refused connection, timeout. */
export class PveUnreachableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PveUnreachableError';
  }
}

/** A task PVE accepted but which finished badly. */
export class PveTaskError extends Error {
  readonly upid: string;
  readonly exitStatus: string;
  constructor(upid: string, exitStatus: string, message: string) {
    super(message);
    this.name = 'PveTaskError';
    this.upid = upid;
    this.exitStatus = exitStatus;
  }
}

/** A guest as the pool listing describes it. */
export interface PveGuest {
  readonly vmid: number;
  readonly name: string;
  /** PVE node hosting it — needed by every per-guest endpoint. */
  readonly node: string;
  readonly status: string;
  readonly type: string;
}

/** One guest snapshot. */
export interface PveSnapshot {
  readonly name: string;
  readonly description: string;
  /** Unix seconds, or `null` for the synthetic `current` entry. */
  readonly snaptime: number | null;
  readonly parent: string | null;
}

/** Lifecycle status, with `missing` for a guest the pool does not contain. */
export type PveGuestStatus = 'running' | 'stopped' | 'missing' | (string & {});

/** Everything `createGuest` needs that is not already in {@link PveConfig}. */
export interface CreateGuestSpec {
  readonly vmid: number;
  readonly name: string;
  /** Node to create on. Omit to use the only node the token can see. */
  readonly node?: string;
  readonly memoryMiB: number;
  readonly cores: number;
  readonly diskGiB: number;
  /** Absolute path on the PVE host of the pinned cloud image. */
  readonly imagePath: string;
  /** cloud-init snippet reference, e.g. `local:snippets/podkit-substrate.yaml`. */
  readonly snippetRef: string;
}

/** Options for {@link createPveClient}. */
export interface CreatePveClientOpts {
  readonly config: PveConfig;
  /** DI seam. Production callers leave unset. */
  readonly fetchFn?: typeof fetch;
  /** DI seam for the pinning probe. Production callers leave unset. */
  readonly probeCertificate?: ProbeCertificateFn;
  /** DI seam for task-poll backoff. Production callers leave unset. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Per-request timeout. */
  readonly requestTimeoutMs?: number;
  /** How long a UPID may stay running before the poll gives up. */
  readonly taskTimeoutMs?: number;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/**
 * A cold create imports a multi-GiB image; a shutdown waits on the guest's stop
 * jobs. Ten minutes clears both without being indistinguishable from a hang.
 */
export const DEFAULT_TASK_TIMEOUT_MS = 600_000;
const TASK_POLL_INTERVAL_MS = 1_000;

/** The client surface. */
export interface PveClient {
  /** PVE version string, e.g. `9.1.4`. The cheapest reachability check. */
  version(): Promise<string>;
  /** Nodes the token can see. */
  listNodes(): Promise<readonly string[]>;
  /**
   * Every guest in the configured pool, with node and status. One call, and
   * the only one the pool ACL exists to permit.
   */
  poolMembers(): Promise<readonly PveGuest[]>;
  /** A single pool member, or `null` when the pool does not contain it. */
  findGuest(vmid: number): Promise<PveGuest | null>;
  guestStatus(vmid: number): Promise<PveGuestStatus>;
  createGuest(spec: CreateGuestSpec): Promise<void>;
  start(vmid: number): Promise<void>;
  /** Graceful ACPI shutdown by default; `force` pulls the power. */
  stop(vmid: number, opts?: { force?: boolean }): Promise<void>;
  destroy(vmid: number): Promise<void>;
  listSnapshots(vmid: number): Promise<readonly PveSnapshot[]>;
  snapshot(vmid: number, name: string, description?: string): Promise<void>;
  rollback(vmid: number, name: string): Promise<void>;
  deleteSnapshot(vmid: number, name: string): Promise<void>;
  /** Addresses the guest agent reports, minus loopback. */
  guestAddresses(vmid: number): Promise<readonly string[]>;
}

/** `fetch` init plus the runtime TLS settings pinning needs. */
type PveRequestInit = RequestInit & { tls?: PinnedTlsOptions };

interface RequestOpts {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: Readonly<Record<string, string | number | undefined>>;
}

function formEncode(body: Readonly<Record<string, string | number | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

export function createPveClient(opts: CreatePveClientOpts): PveClient {
  const { config } = opts;
  const doFetch = opts.fetchFn ?? fetch;
  const probe = opts.probeCertificate ?? probeCertificateOverTls;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const taskTimeoutMs = opts.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;

  // Resolved once. The probe costs a handshake, and re-running it per request
  // would also mean re-reporting a pin mismatch several times per verb.
  let pinned: Promise<PinnedTlsOptions | undefined> | undefined;
  function tlsOptions(): Promise<PinnedTlsOptions | undefined> {
    pinned ??= config.tlsFingerprint
      ? resolvePinnedTls(config.apiUrl, config.tlsFingerprint, probe)
      : Promise.resolve(undefined);
    return pinned;
  }

  // Per-request TLS settings are a Bun `fetch` extension. Node's ignores the
  // option, which would leave the pin unenforced — so refuse rather than
  // proceed. An injected fetch is a test's own business.
  if (
    config.tlsFingerprint &&
    !opts.fetchFn &&
    typeof (globalThis as { Bun?: unknown }).Bun === 'undefined'
  ) {
    throw new Error(
      "PODKIT_PVE_TLS_FINGERPRINT is set, but this runtime's `fetch` cannot be given " +
        'per-request TLS settings, so the pin could not be enforced. Run this under Bun.'
    );
  }

  async function request<T>(req: RequestOpts): Promise<T> {
    // Appended to the configured URL rather than rooted at its origin: a base
    // URL may carry a path when the API sits behind a reverse proxy, and an
    // absolute path would silently discard it.
    const url = new URL(`${config.apiUrl.href.replace(/\/+$/, '')}/api2/json${req.path}`);
    const tls = await tlsOptions();
    const init: PveRequestInit = {
      method: req.method,
      headers: {
        Authorization: `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`,
        ...(req.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(req.body ? { body: formEncode(req.body) } : {}),
      ...(tls ? { tls } : {}),
      signal: AbortSignal.timeout(requestTimeoutMs),
    };

    let response: Response;
    try {
      response = await doFetch(url, init);
    } catch (err) {
      throw new PveUnreachableError(
        `cannot reach the Proxmox API at ${config.apiUrl.origin} ` +
          `(${req.method} ${req.path}): ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw pveApiError({
        method: req.method,
        path: req.path,
        status: response.status,
        statusText: response.statusText,
        body: text.slice(0, 2_000),
      });
    }
    // A 200 with an unparseable body means something that is not PVE answered.
    try {
      return (JSON.parse(text) as { data: T }).data;
    } catch {
      throw new PveUnreachableError(
        `${req.method} ${req.path} returned ${response.status} but not JSON. ` +
          `Is ${config.apiUrl.origin} the Proxmox API and not a login page in front of it?`
      );
    }
  }

  /** Run a mutating call and wait for the UPID it returns to finish. */
  async function requestTask(node: string, req: RequestOpts): Promise<void> {
    const upid = await request<string>(req);
    if (typeof upid !== 'string' || !upid.startsWith('UPID:')) return;
    await waitForTask(node, upid, `${req.method} ${req.path}`);
  }

  async function waitForTask(node: string, upid: string, what: string): Promise<void> {
    const deadline = Date.now() + taskTimeoutMs;
    for (;;) {
      const status = await request<{ status: string; exitstatus?: string }>({
        method: 'GET',
        path: `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`,
      });
      if (status.status === 'stopped') {
        const exit = status.exitstatus ?? 'unknown';
        if (exit !== 'OK') {
          throw new PveTaskError(upid, exit, `PVE task for ${what} finished as '${exit}'.`);
        }
        return;
      }
      if (Date.now() >= deadline) {
        throw new PveTaskError(
          upid,
          'running',
          `PVE task for ${what} was still running after ${Math.round(taskTimeoutMs / 1000)}s. ` +
            `Follow it on the host with \`pvesh get /nodes/${node}/tasks/${upid}/log\`.`
        );
      }
      await sleep(TASK_POLL_INTERVAL_MS);
    }
  }

  async function poolMembers(): Promise<readonly PveGuest[]> {
    const pool = await request<{ members?: readonly Record<string, unknown>[] }>({
      method: 'GET',
      path: `/pools/${encodeURIComponent(config.pool)}`,
    });
    return (pool.members ?? [])
      .filter((m) => m['type'] === 'qemu')
      .map((m) => ({
        vmid: Number(m['vmid']),
        name: String(m['name'] ?? ''),
        node: String(m['node'] ?? ''),
        status: String(m['status'] ?? 'unknown'),
        type: String(m['type'] ?? ''),
      }));
  }

  async function findGuest(vmid: number): Promise<PveGuest | null> {
    return (await poolMembers()).find((g) => g.vmid === vmid) ?? null;
  }

  /**
   * The node a guest lives on. Read from the pool rather than configured —
   * membership already carries it, and a second env key could disagree.
   */
  async function nodeFor(vmid: number): Promise<string> {
    const guest = await findGuest(vmid);
    if (!guest) {
      throw new PveApiMissingGuest(vmid, config.pool);
    }
    return guest.node;
  }

  async function soleNode(): Promise<string> {
    const nodes = await listNodes();
    if (nodes.length !== 1) {
      throw new Error(
        `cannot choose a node automatically: the token can see ${nodes.length} ` +
          `(${nodes.join(', ') || 'none'}). Pass one explicitly.`
      );
    }
    return nodes[0]!;
  }

  async function listNodes(): Promise<readonly string[]> {
    const nodes = await request<readonly { node: string }[]>({ method: 'GET', path: '/nodes' });
    return nodes.map((n) => n.node);
  }

  return {
    async version() {
      const v = await request<{ version: string }>({ method: 'GET', path: '/version' });
      return v.version;
    },

    listNodes,
    poolMembers,
    findGuest,

    async guestStatus(vmid) {
      const guest = await findGuest(vmid);
      return guest ? guest.status : 'missing';
    },

    async createGuest(spec) {
      const node = spec.node ?? (await soleNode());
      const base = `/nodes/${node}/qemu`;
      await requestTask(node, {
        method: 'POST',
        path: base,
        body: {
          vmid: spec.vmid,
          name: spec.name,
          pool: config.pool,
          memory: spec.memoryMiB,
          cores: spec.cores,
          // `host` rather than the kvm64 default: a bun --compile binary needs
          // AVX and spins forever without it. Asserted by substrate-doctor.sh.
          cpu: 'host',
          ostype: 'l26',
          scsihw: 'virtio-scsi-single',
          net0: `virtio,bridge=${config.bridge}`,
          // Debian's cloud images expect a serial console; without one a boot
          // failure is invisible.
          serial0: 'socket',
          vga: 'serial0',
          agent: 'enabled=1',
        },
      });

      // Disk import, cloud-init drive and boot order are separate config
      // writes, exactly as the playbook's `qm set` sequence does them.
      await requestTask(node, {
        method: 'PUT',
        path: `${base}/${spec.vmid}/config`,
        body: {
          scsi0: `${config.diskStorage}:0,import-from=${spec.imagePath}`,
          ide2: `${config.diskStorage}:cloudinit`,
          // cicustom replaces user-data only; ipconfig0 still drives
          // network-config and is not optional.
          cicustom: `user=${spec.snippetRef}`,
          ipconfig0: 'ip=dhcp',
          boot: 'order=scsi0',
        },
      });

      await requestTask(node, {
        method: 'PUT',
        path: `${base}/${spec.vmid}/resize`,
        body: { disk: 'scsi0', size: `${spec.diskGiB}G` },
      });
    },

    async start(vmid) {
      const node = await nodeFor(vmid);
      await requestTask(node, {
        method: 'POST',
        path: `/nodes/${node}/qemu/${vmid}/status/start`,
      });
    },

    async stop(vmid, stopOpts = {}) {
      const node = await nodeFor(vmid);
      await requestTask(node, {
        method: 'POST',
        path: `/nodes/${node}/qemu/${vmid}/status/${stopOpts.force ? 'stop' : 'shutdown'}`,
      });
    },

    async destroy(vmid) {
      const node = await nodeFor(vmid);
      await requestTask(node, { method: 'DELETE', path: `/nodes/${node}/qemu/${vmid}` });
    },

    async listSnapshots(vmid) {
      const node = await nodeFor(vmid);
      const snaps = await request<readonly Record<string, unknown>[]>({
        method: 'GET',
        path: `/nodes/${node}/qemu/${vmid}/snapshot`,
      });
      return (
        snaps
          // PVE returns a synthetic `current` entry describing the live state.
          .filter((s) => s['name'] !== 'current')
          .map((s) => ({
            name: String(s['name']),
            description: String(s['description'] ?? ''),
            snaptime: typeof s['snaptime'] === 'number' ? s['snaptime'] : null,
            parent: typeof s['parent'] === 'string' ? s['parent'] : null,
          }))
      );
    },

    async snapshot(vmid, name, description) {
      const node = await nodeFor(vmid);
      await requestTask(node, {
        method: 'POST',
        path: `/nodes/${node}/qemu/${vmid}/snapshot`,
        // No vmstate: a provisioning snapshot is a disk state, and saving RAM
        // would make it a suspended machine rather than a clean boot.
        body: { snapname: name, description, vmstate: 0 },
      });
    },

    async rollback(vmid, name) {
      const node = await nodeFor(vmid);
      await requestTask(node, {
        method: 'POST',
        path: `/nodes/${node}/qemu/${vmid}/snapshot/${encodeURIComponent(name)}/rollback`,
      });
    },

    async deleteSnapshot(vmid, name) {
      const node = await nodeFor(vmid);
      await requestTask(node, {
        method: 'DELETE',
        path: `/nodes/${node}/qemu/${vmid}/snapshot/${encodeURIComponent(name)}`,
      });
    },

    async guestAddresses(vmid) {
      const node = await nodeFor(vmid);
      const result = await request<{
        result?: readonly { 'ip-addresses'?: readonly { 'ip-address'?: string }[] }[];
      }>({
        method: 'GET',
        path: `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`,
      });
      const addresses: string[] = [];
      for (const iface of result.result ?? []) {
        for (const addr of iface['ip-addresses'] ?? []) {
          const ip = addr['ip-address'];
          if (ip && ip !== '127.0.0.1' && ip !== '::1') addresses.push(ip);
        }
      }
      return addresses;
    },
  };
}

/** A VMID that is not a member of the configured pool. */
export class PveApiMissingGuest extends Error {
  readonly vmid: number;
  constructor(vmid: number, pool: string) {
    super(
      `VMID ${vmid} is not a qemu member of pool '${pool}'. The token's ACL is scoped to that ` +
        `pool, so a guest outside it is invisible however correct the grant is — check the ` +
        `PODKIT_PVE_VMID_* value, and that the guest was created with \`--pool ${pool}\`.`
    );
    this.name = 'PveApiMissingGuest';
    this.vmid = vmid;
  }
}

export type { PveApiError };
