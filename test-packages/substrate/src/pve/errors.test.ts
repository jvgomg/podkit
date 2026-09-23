/**
 * The 403 diagnosis is what this module is for, so it is most of what is pinned
 * here: an ACL denial must arrive naming the privilege and the path.
 */

import { describe, it, expect } from 'bun:test';

import { parseDeniedPrivilege, pveApiError, isPveApiError } from './errors.js';

/** The failure shape every case here varies one field of. */
function failure(overrides: Partial<Parameters<typeof pveApiError>[0]> = {}) {
  return {
    method: 'GET',
    path: '/pools/podkit',
    status: 500,
    statusText: 'internal error',
    body: '',
    ...overrides,
  };
}

describe('parseDeniedPrivilege', () => {
  it('pulls the path and privilege out of PVE 9 denial phrasing', () => {
    // PVE 9 phrasing, verbatim.
    expect(
      parseDeniedPrivilege('Permission check failed (/vms/9000, VM.GuestAgent.Unrestricted)')
    ).toEqual({ path: '/vms/9000', privilege: 'VM.GuestAgent.Unrestricted' });
  });

  it('reads a storage path as readily as a guest path', () => {
    expect(
      parseDeniedPrivilege('Permission check failed (/storage/local, Datastore.Audit)')
    ).toEqual({ path: '/storage/local', privilege: 'Datastore.Audit' });
  });

  it('renders an any-of privilege list as prose rather than as Perl', () => {
    expect(
      parseDeniedPrivilege("Permission check failed (/vms/9000, ['VM.Audit','VM.Config.Disk'])")
    ).toEqual({ path: '/vms/9000', privilege: 'VM.Audit or VM.Config.Disk' });
  });

  it('returns null for text that is not a denial', () => {
    expect(parseDeniedPrivilege('no such file')).toBeNull();
    expect(parseDeniedPrivilege('')).toBeNull();
  });
});

describe('pveApiError', () => {
  it('names the privilege and the ACL path when PVE puts the denial in the reason phrase', () => {
    const err = pveApiError(
      failure({
        method: 'POST',
        path: '/nodes/rae/qemu/9000/agent/exec',
        status: 403,
        statusText: 'Permission check failed (/vms/9000, VM.GuestAgent.Unrestricted)',
      })
    );
    expect(err.message).toContain("lacks 'VM.GuestAgent.Unrestricted'");
    expect(err.message).toContain("on '/vms/9000'");
    expect(err.message).toContain('POST /nodes/rae/qemu/9000/agent/exec');
    expect(err.denied).toEqual({ path: '/vms/9000', privilege: 'VM.GuestAgent.Unrestricted' });
  });

  it('finds the denial in the body when a proxy has flattened the reason phrase', () => {
    const err = pveApiError(
      failure({
        status: 403,
        statusText: 'Forbidden',
        body: '{"data":null,"message":"Permission check failed (/storage/local, Datastore.Audit)"}',
      })
    );
    expect(err.denied).toEqual({ path: '/storage/local', privilege: 'Datastore.Audit' });
  });

  it('sends a 401 to the env file and a 403 to the hypervisor', () => {
    const unauth = pveApiError(failure({ status: 401, statusText: 'authentication failure' }));
    expect(unauth.message).toContain('PODKIT_PVE_TOKEN_SECRET');
    expect(unauth.message).not.toContain('pveum acl modify');

    const forbidden = pveApiError(failure({ status: 403, statusText: 'Forbidden' }));
    expect(forbidden.message).toContain('PODKIT_PVE_POOL');
    expect(forbidden.denied).toBeNull();
  });

  it('points a 404 at the VMID rather than at the token', () => {
    const err = pveApiError(
      failure({ path: '/nodes/rae/qemu/9999/status/current', status: 404, statusText: 'Not Found' })
    );
    expect(err.message).toContain('PODKIT_PVE_VMID_');
  });

  it('keeps the body on an unclassified failure so nothing is silently dropped', () => {
    const err = pveApiError(failure({ status: 500, body: 'unable to open file' }));
    expect(err.message).toContain('unable to open file');
    expect(err.status).toBe(500);
  });

  it('is recognisable without instanceof', () => {
    expect(isPveApiError(pveApiError(failure()))).toBe(true);
    expect(isPveApiError(new Error('nope'))).toBe(false);
  });
});
