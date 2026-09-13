/**
 * Unit tests for the typed substrate registry. Asserts the external contract:
 * every substrate is looked up by id OR instance name, unknown lookups fail
 * loudly, ids are clean identifiers, instance names keep the `podkit-` prefix,
 * every Lima yaml really exists on disk, an `ssh` entry carries an alias and no
 * path at all, and exactly one substrate is baseline-tracked (the Lima
 * device-synthesis harness).
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { repoRoot } from './paths.js';
import {
  listVms,
  getVm,
  deviceVm,
  isLimaVm,
  isSshVm,
  LIMA_VM_IDS,
  LIMA_DEVICE_HARNESS_VM_NAME,
  type VmDefinition,
} from './registry.js';

/** Where the Lima provisioner keeps its declarative specs. */
const LIMA_VMS_DIR = path.join(repoRoot(), 'test-packages', 'lima', 'vms');

describe('substrate registry', () => {
  it('lists every substrate with clean ids and podkit- instance names', () => {
    const vms = listVms();
    expect(vms).toHaveLength(8);
    for (const vm of vms) {
      expect(vm.id).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect(vm.instanceName).toMatch(/^podkit-/);
    }
  });

  it('has unique ids and unique instance names', () => {
    const vms = listVms();
    expect(new Set(vms.map((v) => v.id)).size).toBe(vms.length);
    expect(new Set(vms.map((v) => v.instanceName)).size).toBe(vms.length);
  });

  it('looks a substrate up by id', () => {
    const vm = getVm('device');
    expect(vm.instanceName).toBe(LIMA_DEVICE_HARNESS_VM_NAME);
    expect(vm.category).toBe('device');
  });

  it('looks the same substrate up by instance name', () => {
    const byId = getVm('device');
    const byInstance = getVm(LIMA_DEVICE_HARNESS_VM_NAME);
    expect(byInstance).toEqual(byId);
  });

  it('throws a descriptive error for an unknown substrate', () => {
    expect(() => getVm('does-not-exist')).toThrow(/no VM registered for 'does-not-exist'/);
    expect(() => getVm('does-not-exist')).toThrow(/Known VMs:/);
  });

  it('tracks exactly the Lima device-synthesis harness for baseline drift', () => {
    const tracked = listVms().filter((v) => v.trackedForBaseline);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.id).toBe('device');
  });

  it('maps each id to its provisioner-facing instance name', () => {
    const byId = (id: string): VmDefinition => getVm(id);
    expect(byId('device').instanceName).toBe('podkit-device');
    expect(byId('builderGlibc').instanceName).toBe('podkit-builder-glibc');
    expect(byId('builderMusl').instanceName).toBe('podkit-builder-musl');
    expect(byId('testGlibc').instanceName).toBe('podkit-test-glibc');
    expect(byId('testMusl').instanceName).toBe('podkit-test-musl');
    expect(byId('virtualIpod').instanceName).toBe('podkit-virtual-ipod');
    expect(byId('abiVerify').instanceName).toBe('podkit-abi-verify');
    expect(byId('deviceRemote').instanceName).toBe('podkit-device-remote');
  });
});

describe('provisioner discriminator', () => {
  it('gives every substrate exactly one provisioner', () => {
    for (const vm of listVms()) {
      expect(['lima', 'ssh']).toContain(vm.provisioner);
      expect(isLimaVm(vm)).toBe(vm.provisioner === 'lima');
      expect(isSshVm(vm)).toBe(vm.provisioner === 'ssh');
    }
  });

  it('keeps LIMA_VM_IDS in step with the registry', () => {
    // The type-level narrowing `getVm('device').yamlPath` relies on this list
    // being the truth. If it drifts, callers get a compile-time promise the
    // registry does not keep.
    const actual = listVms()
      .filter(isLimaVm)
      .map((vm) => vm.id);
    expect([...LIMA_VM_IDS] as string[]).toEqual(actual);
  });

  it('resolves every Lima yaml to a file that exists under the Lima vms/ directory', () => {
    for (const vm of listVms().filter(isLimaVm)) {
      expect(vm.yamlPath).toBe(path.join(LIMA_VMS_DIR, `${vm.instanceName}.yaml`));
      expect(fs.existsSync(vm.yamlPath)).toBe(true);
    }
  });

  it('exposes yamlPath as an accessor so no path is resolved at module load', () => {
    // Load-bearing: this registry is re-exported into a single-file bundle
    // whose `import.meta.url` has no source-tree marker for the repo-root
    // anchor to latch onto. Turning `yamlPath` into a plain field would move
    // the resolution to import time and crash that bundle on startup.
    for (const vm of listVms().filter(isLimaVm)) {
      const descriptor = Object.getOwnPropertyDescriptor(vm, 'yamlPath');
      expect(typeof descriptor?.get).toBe('function');
      expect(descriptor?.value).toBeUndefined();
    }
  });

  it('gives an ssh substrate an alias and no yaml path of any kind', () => {
    const ssh = listVms().filter(isSshVm);
    expect(ssh.length).toBeGreaterThan(0);
    for (const vm of ssh) {
      expect(vm.sshAlias).toMatch(/^[A-Za-z0-9._-]+$/);
      // Not "resolves to undefined" — absent. An optional field that reads as
      // undefined invites `vm.yamlPath!` at a call site; a missing one does not
      // type-check there at all.
      expect('yamlPath' in vm).toBe(false);
      expect(Object.getOwnPropertyDescriptor(vm, 'yamlPath')).toBeUndefined();
    }
  });

  it('keeps every hostname out of an ssh entry', () => {
    // The repo declares capability; the machine declares connection. An alias
    // that looks like an address is the exact mistake this rule exists to stop,
    // and it would be invisible in review once a second entry is added.
    for (const vm of listVms().filter(isSshVm)) {
      expect(vm.sshAlias).not.toMatch(/\./);
      expect(vm.sshAlias).not.toMatch(/@/);
      expect(vm.sshAlias).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    }
  });
});

describe('registry conveniences', () => {
  it('derives the device-harness constant from the registry', () => {
    expect(LIMA_DEVICE_HARNESS_VM_NAME).toBe(deviceVm().instanceName);
  });

  it('exposes the Lima device harness via the deviceVm() convenience', () => {
    expect(deviceVm().id).toBe('device');
    expect(deviceVm().provisioner).toBe('lima');
  });
});
