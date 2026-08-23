/**
 * Unit tests for the typed VM registry. Asserts the external contract: every
 * VM is looked up by id OR instance name, unknown lookups fail loudly, ids are
 * clean identifiers, instance names keep the `podkit-` prefix, and exactly one
 * VM is baseline-tracked (the device-synthesis harness).
 */

import { describe, it, expect } from 'bun:test';

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

  it('keeps the current (pre-rename) instance names', () => {
    const byId = (id: string): VmDefinition => getVm(id);
    expect(byId('device').instanceName).toBe('podkit-device-harness');
    expect(byId('builderGlibc').instanceName).toBe('podkit-linux-builder');
    expect(byId('builderMusl').instanceName).toBe('podkit-musl-builder');
    expect(byId('testGlibc').instanceName).toBe('podkit-tests-debian-glibc');
    expect(byId('testMusl').instanceName).toBe('podkit-tests-alpine-musl');
    expect(byId('demo').instanceName).toBe('podkit-virtual-ipod');
    expect(byId('abiVerify').instanceName).toBe('podkit-abi-verify');
  });

  it('exposes the device harness via the deviceVm() convenience', () => {
    expect(deviceVm().id).toBe('device');
  });
});
