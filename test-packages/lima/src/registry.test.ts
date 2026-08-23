/**
 * Unit tests for the typed VM registry. Asserts the external contract: every
 * VM is looked up by id OR instance name, unknown lookups fail loudly, ids are
 * clean identifiers, instance names keep the `podkit-` prefix, every yaml
 * really exists under the package's `vms/` directory, and exactly one VM is
 * baseline-tracked (the device-synthesis harness).
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { limaPackageRoot } from './paths.js';
import {
  listVms,
  getVm,
  deviceVm,
  LIMA_DEVICE_HARNESS_VM_NAME,
  type VmDefinition,
} from './registry.js';

describe('VM registry', () => {
  it('lists all seven VMs with clean ids and podkit- instance names', () => {
    const vms = listVms();
    expect(vms).toHaveLength(7);
    for (const vm of vms) {
      expect(vm.id).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect(vm.instanceName).toMatch(/^podkit-/);
      expect(vm.yamlPath.endsWith('.yaml')).toBe(true);
    }
  });

  it('has unique ids and unique instance names', () => {
    const vms = listVms();
    expect(new Set(vms.map((v) => v.id)).size).toBe(vms.length);
    expect(new Set(vms.map((v) => v.instanceName)).size).toBe(vms.length);
  });

  it('looks a VM up by id', () => {
    const vm = getVm('device');
    expect(vm.instanceName).toBe(LIMA_DEVICE_HARNESS_VM_NAME);
    expect(vm.category).toBe('device');
  });

  it('looks the same VM up by instance name', () => {
    const byId = getVm('device');
    const byInstance = getVm(LIMA_DEVICE_HARNESS_VM_NAME);
    expect(byInstance).toEqual(byId);
  });

  it('throws a descriptive error for an unknown VM', () => {
    expect(() => getVm('does-not-exist')).toThrow(/no VM registered for 'does-not-exist'/);
    expect(() => getVm('does-not-exist')).toThrow(/Known VMs:/);
  });

  it('tracks exactly the device-synthesis harness for baseline drift', () => {
    const tracked = listVms().filter((v) => v.trackedForBaseline);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.id).toBe('device');
  });

  it('maps each id to its Lima instance name', () => {
    const byId = (id: string): VmDefinition => getVm(id);
    expect(byId('device').instanceName).toBe('podkit-device');
    expect(byId('builderGlibc').instanceName).toBe('podkit-builder-glibc');
    expect(byId('builderMusl').instanceName).toBe('podkit-builder-musl');
    expect(byId('testGlibc').instanceName).toBe('podkit-test-glibc');
    expect(byId('testMusl').instanceName).toBe('podkit-test-musl');
    expect(byId('virtualIpod').instanceName).toBe('podkit-virtual-ipod');
    expect(byId('abiVerify').instanceName).toBe('podkit-abi-verify');
  });

  it('resolves every yaml to a file that exists under the package vms/ directory', () => {
    for (const vm of listVms()) {
      expect(vm.yamlPath).toBe(path.join(limaPackageRoot(), 'vms', `${vm.instanceName}.yaml`));
      expect(fs.existsSync(vm.yamlPath)).toBe(true);
    }
  });

  it('exposes yamlPath as an accessor so no path is resolved at module load', () => {
    // Load-bearing: this registry is re-exported into a single-file bundle
    // whose `import.meta.url` has no source-tree marker for the repo-root
    // anchor to latch onto. Turning `yamlPath` into a plain field would move
    // the resolution to import time and crash that bundle on startup.
    for (const vm of listVms()) {
      const descriptor = Object.getOwnPropertyDescriptor(vm, 'yamlPath');
      expect(typeof descriptor?.get).toBe('function');
      expect(descriptor?.value).toBeUndefined();
    }
  });

  it('derives the device-harness constant from the registry', () => {
    expect(LIMA_DEVICE_HARNESS_VM_NAME).toBe(deviceVm().instanceName);
  });

  it('exposes the device harness via the deviceVm() convenience', () => {
    expect(deviceVm().id).toBe('device');
  });
});
