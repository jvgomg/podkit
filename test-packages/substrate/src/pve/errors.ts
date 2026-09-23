/**
 * Proxmox HTTP failures, diagnosed.
 *
 * 403 is the shape worth engineering for: PVE names the denied
 * `(path, privilege)` in the HTTP reason phrase and puts nothing useful in the
 * body, and those two strings are the arguments to the `pveum acl modify` that
 * fixes it. An ACL denial also tends to surface far from its cause, so the
 * message has to carry them.
 *
 * @module
 */

/** The `(path, privilege)` pair PVE names when an ACL check fails. */
export interface PveDeniedPrivilege {
  /** ACL path the check ran against, e.g. `/vms/9000` or `/storage/local`. */
  readonly path: string;
  /** Privilege the principal did not hold, e.g. `VM.GuestAgent.Unrestricted`. */
  readonly privilege: string;
}

/**
 * PVE's denial phrasing. Tolerates the any-of list form
 * (`… (/vms/9000, ['VM.Audit','VM.Config.Disk'])`).
 */
const DENIAL_RE = /Permission check failed \(([^,)]+),\s*([^)]+)\)/;

/** Extract the denied `(path, privilege)` from a PVE 403, or `null`. */
export function parseDeniedPrivilege(text: string): PveDeniedPrivilege | null {
  const match = DENIAL_RE.exec(text);
  if (!match) return null;
  const path = match[1]!.trim();
  const privilege = match[2]!
    .replaceAll(/[[\]'"]/g, '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' or ');
  if (!path || !privilege) return null;
  return { path, privilege };
}

/** Inputs to {@link pveApiError}. */
export interface PveApiFailure {
  /** HTTP method of the failed request. */
  readonly method: string;
  /** API path, relative to `/api2/json`, e.g. `/pools/podkit`. */
  readonly path: string;
  /** HTTP status code. */
  readonly status: number;
  /** HTTP reason phrase, where the transport preserved one. */
  readonly statusText: string;
  /** Response body as text, truncated by the caller if enormous. */
  readonly body: string;
}

/**
 * A Proxmox API call that came back non-2xx. Carries the facts structurally so
 * a caller branching on "ACL denial" need not re-parse the message.
 */
export class PveApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly method: string;
  readonly path: string;
  readonly body: string;
  /** The denied `(path, privilege)` when this was a parseable 403, else `null`. */
  readonly denied: PveDeniedPrivilege | null;

  constructor(failure: PveApiFailure, message: string, denied: PveDeniedPrivilege | null) {
    super(message);
    this.name = 'PveApiError';
    this.status = failure.status;
    this.statusText = failure.statusText;
    this.method = failure.method;
    this.path = failure.path;
    this.body = failure.body;
    this.denied = denied;
  }
}

/** Narrowing predicate — cross-realm safe, unlike `instanceof`. */
export function isPveApiError(err: unknown): err is PveApiError {
  return err instanceof Error && err.name === 'PveApiError';
}

/**
 * Build the error for a failed call. Each branch answers "what next", which is
 * why 401 and 403 read differently: one is a credential in `.env.local`, the
 * other an ACL on the hypervisor.
 */
export function pveApiError(failure: PveApiFailure): PveApiError {
  const where = `${failure.method} ${failure.path}`;
  const denied = parseDeniedPrivilege(failure.statusText) ?? parseDeniedPrivilege(failure.body);

  if (denied) {
    return new PveApiError(
      failure,
      `PVE denied ${where}: the API token lacks '${denied.privilege}' on '${denied.path}'.\n` +
        `Grant it on the PVE host — e.g. \`pveum acl modify '${denied.path}' ` +
        `--tokens '<user@realm!token>' --roles <role>\` — or re-run ` +
        `test-packages/device-testing/substrate/proxmox/pveum-recipe.sh if the path is one ` +
        `the recipe already covers.\n` +
        `A path outside the pool, the named storages and the bridge means the token is being ` +
        `asked to leave its confinement, which is a bug here rather than a missing grant.`,
      denied
    );
  }

  if (failure.status === 401) {
    return new PveApiError(
      failure,
      `PVE rejected the credentials for ${where} (401 ${failure.statusText}).\n` +
        `Check PODKIT_PVE_TOKEN_ID (it must be the full 'user@realm!tokenname' form) and ` +
        `PODKIT_PVE_TOKEN_SECRET in .env.local. A token secret is printed once at creation and ` +
        `cannot be re-read; rotate it with \`pveum user token remove\` + \`add\` if it is lost.`,
      null
    );
  }

  if (failure.status === 403) {
    return new PveApiError(
      failure,
      `PVE denied ${where} (403 ${failure.statusText}) without naming a privilege.\n` +
        `The usual cause is an object outside the token's pool: the ACL is scoped to one pool, ` +
        `so a VMID that is not a member is invisible to it however correct the grant is. ` +
        `Check the guest is in PODKIT_PVE_POOL.`,
      null
    );
  }

  if (failure.status === 404) {
    return new PveApiError(
      failure,
      `PVE has no ${where} (404 ${failure.statusText}). ` +
        `For a guest path this means the VMID does not exist on that node — check the ` +
        `PODKIT_PVE_VMID_* value in .env.local against \`qm list\` on the host.`,
      null
    );
  }

  const detail = failure.body.trim();
  return new PveApiError(
    failure,
    `PVE failed ${where}: ${failure.status} ${failure.statusText}` + (detail ? `\n${detail}` : ''),
    null
  );
}
