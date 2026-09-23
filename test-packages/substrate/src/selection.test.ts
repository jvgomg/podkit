/**
 * Unit tests for substrate selection. Asserts the decision, not the route to
 * it: which substrate comes back, whether the fallback announced itself, and
 * that an unconfigured machine with no Lima gets an error naming the step it
 * skipped rather than a confusing failure three layers down.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  resolveSubstrateSelection,
  selectSubstrate,
  commandOnPath,
  SubstrateSelectionError,
  SUBSTRATE_ENV_VAR,
  declaredSubstrateMachine,
  type SubstrateSelectionInput,
} from './selection.js';
import { listVms, type VmDefinition } from './registry.js';

/**
 * A registry stand-in. Selection is tested against fixtures rather than the
 * real registry so the "no Lima device substrate at all" and "two of them"
 * branches are reachable — neither is a state the real registry can be in, and
 * both are states the resolver has to answer for.
 */
const LIMA_DEVICE: VmDefinition = {
  id: 'device',
  instanceName: 'podkit-device',
  provisioner: 'lima',
  yamlPath: '/anywhere/podkit-device.yaml',
  category: 'device',
  archRelevance: 'agnostic',
  trackedForBaseline: true,
};

const SSH_DEVICE: VmDefinition = {
  id: 'deviceRemote',
  instanceName: 'podkit-device-remote',
  provisioner: 'ssh',
  sshAlias: 'podkit-substrate',
  targetArch: 'x64',
  category: 'device',
  archRelevance: 'agnostic',
  trackedForBaseline: false,
};

const BUILDER: VmDefinition = {
  id: 'builderGlibc',
  instanceName: 'podkit-builder-glibc',
  provisioner: 'lima',
  yamlPath: '/anywhere/podkit-builder-glibc.yaml',
  category: 'builder',
  archRelevance: 'glibc',
  trackedForBaseline: false,
};

function input(overrides: Partial<SubstrateSelectionInput> = {}): SubstrateSelectionInput {
  return {
    env: {},
    substrates: [LIMA_DEVICE, BUILDER, SSH_DEVICE],
    limactlAvailable: true,
    ...overrides,
  };
}

describe('substrate selection — configured', () => {
  it('selects the substrate named by the environment, with nothing to announce', () => {
    const selection = resolveSubstrateSelection(
      input({ env: { [SUBSTRATE_ENV_VAR]: 'deviceRemote' } })
    );
    expect(selection.substrate.id).toBe('deviceRemote');
    expect(selection.source).toBe('configured');
    expect(selection.announcement).toBeNull();
  });

  it('accepts the instance name as well as the id', () => {
    const selection = resolveSubstrateSelection(
      input({ env: { [SUBSTRATE_ENV_VAR]: 'podkit-device-remote' } })
    );
    expect(selection.substrate.id).toBe('deviceRemote');
  });

  it('honours an explicit Lima selection over the fallback path', () => {
    // Same substrate the fallback would have picked, but the source differs —
    // and so does whether anything is announced. A deliberate choice is not a
    // default, and conflating them is how the announcement would rot into noise.
    const selection = resolveSubstrateSelection(input({ env: { [SUBSTRATE_ENV_VAR]: 'device' } }));
    expect(selection.substrate.id).toBe('device');
    expect(selection.source).toBe('configured');
    expect(selection.announcement).toBeNull();
  });

  it('tolerates surrounding whitespace, which a hand-edited env file collects', () => {
    const selection = resolveSubstrateSelection(
      input({ env: { [SUBSTRATE_ENV_VAR]: '  deviceRemote  ' } })
    );
    expect(selection.substrate.id).toBe('deviceRemote');
  });

  it('treats an empty value as unset rather than as an unknown substrate', () => {
    const selection = resolveSubstrateSelection(input({ env: { [SUBSTRATE_ENV_VAR]: '   ' } }));
    expect(selection.source).toBe('lima-fallback');
  });

  it('rejects an unknown id and lists what it could have been', () => {
    expect(() =>
      resolveSubstrateSelection(input({ env: { [SUBSTRATE_ENV_VAR]: 'nope' } }))
    ).toThrow(SubstrateSelectionError);
    expect(() =>
      resolveSubstrateSelection(input({ env: { [SUBSTRATE_ENV_VAR]: 'nope' } }))
    ).toThrow(/device \(lima\), deviceRemote \(ssh\)/);
  });

  it('rejects a substrate that cannot host the device harness', () => {
    // A builder VM is a legitimate registry entry and a nonsense answer here.
    // Accepting it would fail much later, inside the harness, as a missing
    // kernel module.
    expect(() =>
      resolveSubstrateSelection(input({ env: { [SUBSTRATE_ENV_VAR]: 'builderGlibc' } }))
    ).toThrow(/does not name a device substrate/);
  });
});

describe('substrate selection — fallback', () => {
  it('falls back to the Lima substrate when limactl is present, and says so', () => {
    const selection = resolveSubstrateSelection(input({ limactlAvailable: true }));
    expect(selection.substrate.id).toBe('device');
    expect(selection.source).toBe('lima-fallback');
    expect(selection.announcement).toContain(SUBSTRATE_ENV_VAR);
    expect(selection.announcement).toContain('podkit-device');
    expect(selection.announcement).toContain('.env.local');
  });

  it('errors, naming the configuration step, when limactl is absent', () => {
    let thrown: unknown;
    try {
      resolveSubstrateSelection(input({ limactlAvailable: false }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SubstrateSelectionError);
    const message = (thrown as Error).message;
    expect(message).toContain(SUBSTRATE_ENV_VAR);
    expect(message).toContain('.env.local');
    expect(message).toContain('.env.example');
    expect(message).toContain('deviceRemote');
  });

  it('refuses to guess when the registry has no Lima device substrate', () => {
    expect(() => resolveSubstrateSelection(input({ substrates: [SSH_DEVICE, BUILDER] }))).toThrow(
      /expected exactly 1/
    );
  });

  it('refuses to guess when the registry has two Lima device substrates', () => {
    const second: VmDefinition = { ...LIMA_DEVICE, id: 'deviceTwo', instanceName: 'podkit-two' };
    expect(() => resolveSubstrateSelection(input({ substrates: [LIMA_DEVICE, second] }))).toThrow(
      /expected exactly 1/
    );
  });
});

describe('substrate selection — platform independence', () => {
  it('never branches on process.platform', () => {
    // Asserted against the source because the behaviour cannot be asserted from
    // the outside: a `darwin` branch would be correct on the machine that wrote
    // it and silently different everywhere else, so no runtime assertion any
    // one developer can run would catch it. The capability check
    // (`limactlAvailable`) is the whole of what platform was ever standing in
    // for — see this module's header.
    const source = fs.readFileSync(path.join(import.meta.dir, 'selection.ts'), 'utf8');
    // Comments stripped first: this module's own header argues at length about
    // why platform is the wrong question, and a naive substring scan would
    // convict it of the thing it explains.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toContain('process.platform');
    expect(code).not.toContain('os.platform');
  });
});

describe('commandOnPath', () => {
  it('finds an executable on a synthesised PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-path-'));
    try {
      const bin = path.join(dir, 'limactl');
      fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
      expect(commandOnPath('limactl', { PATH: dir })).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not count a non-executable file of the right name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-path-'));
    try {
      fs.writeFileSync(path.join(dir, 'limactl'), 'not a program', { mode: 0o644 });
      expect(commandOnPath('limactl', { PATH: dir })).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports false for an empty or missing PATH rather than throwing', () => {
    expect(commandOnPath('limactl', {})).toBe(false);
    expect(commandOnPath('limactl', { PATH: '' })).toBe(false);
  });
});

describe('selectSubstrate', () => {
  it('reads the real registry and honours an explicit selection', () => {
    const selection = selectSubstrate({ [SUBSTRATE_ENV_VAR]: 'deviceRemote', PATH: '' });
    expect(selection.substrate.id).toBe('deviceRemote');
    expect(selection.substrate.provisioner).toBe('ssh');
    // Proof it went through the real registry rather than a fixture.
    expect(listVms().map((vm) => vm.id)).toContain(selection.substrate.id);
  });

  it('probes PATH for limactl when nothing is configured', () => {
    // No PATH at all → no limactl → the onboarding error, on every platform.
    expect(() => selectSubstrate({ PATH: '' })).toThrow(SubstrateSelectionError);
  });

  // The retired override named a Lima instance for two driver scripts and for
  // nothing else. Ignoring a variable a developer still has exported is the
  // silent-default failure this module exists to refuse, so it is refused
  // loudly — and the message has to name the variable that replaced it, or the
  // error is a dead end.
  it('refuses to run when the retired VM-name override is still exported', () => {
    let caught: unknown;
    try {
      selectSubstrate({
        PODKIT_DEVICE_HARNESS_VM_NAME: 'podkit-device',
        [SUBSTRATE_ENV_VAR]: 'device',
        PATH: '',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SubstrateSelectionError);
    expect((caught as Error).message).toContain('PODKIT_DEVICE_HARNESS_VM_NAME');
    expect((caught as Error).message).toContain(SUBSTRATE_ENV_VAR);
  });
});

describe('declaredSubstrateMachine', () => {
  // The whole point: an ssh substrate's architecture is knowable without
  // talking to it, so the value that decides what gets built can be resolved
  // by an entry point that must not probe — before the substrate is even up.
  it('returns the machine type an ssh substrate declares', () => {
    expect(declaredSubstrateMachine(SSH_DEVICE)).toBe('x64');
  });

  // A Lima substrate is created from this machine's image, so it has no
  // declaration to make: its architecture IS the host's, which is what the
  // caller falls back to.
  it('returns null for a Lima substrate, which declares nothing', () => {
    expect(declaredSubstrateMachine(LIMA_DEVICE)).toBeNull();
  });
});

describe('SubstrateSelectionError.unconfigured', () => {
  // The flag exists for callers that have to tell "this machine has nothing
  // set up", which is an ordinary state, from "somebody set the variable and
  // got it wrong", which is not. A caller that cannot tell them apart has to
  // treat both as benign, and a typo then falls back silently.
  it('is set when nothing is configured and there is no Lima to fall back to', () => {
    let caught: unknown;
    try {
      resolveSubstrateSelection(input({ env: {}, limactlAvailable: false }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SubstrateSelectionError);
    expect((caught as SubstrateSelectionError).unconfigured).toBe(true);
  });

  it('is NOT set when the configured id names nothing', () => {
    let caught: unknown;
    try {
      resolveSubstrateSelection(input({ env: { [SUBSTRATE_ENV_VAR]: 'nosuchbox' } }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SubstrateSelectionError);
    expect((caught as SubstrateSelectionError).unconfigured).toBe(false);
  });

  // An ambiguous registry is a defect in the repo, not a machine that has not
  // been set up — falling back silently would hide it.
  it('is NOT set when the registry itself is ambiguous', () => {
    let caught: unknown;
    try {
      resolveSubstrateSelection(input({ env: {}, substrates: [LIMA_DEVICE, LIMA_DEVICE] }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SubstrateSelectionError);
    expect((caught as SubstrateSelectionError).unconfigured).toBe(false);
  });
});
