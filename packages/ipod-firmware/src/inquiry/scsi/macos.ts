/**
 * SCSI transport — macOS IOKit SCSITaskUserClient via koffi.
 *
 * Drives the IOKit SCSITaskUserClient interface entirely from TypeScript,
 * matching the algorithm validated by the P0 spike against a real iPod
 * nano 2G.
 *
 * Algorithm (one-time per session):
 *  1. `IOMainPort()` to obtain a master port.
 *  2. `IOServiceGetMatchingService(com_apple_driver_iPodSBCNub)` —
 *     fails with `kext-missing` if iPodDriver.kext is not loaded.
 *  3. `IOCreatePlugInInterfaceForService(kIOSCSITaskDeviceUserClientTypeID)`.
 *  4. `(*plugin)->QueryInterface(kIOSCSITaskDeviceInterfaceID)`.
 *  5. Assert `taskDevice->version` matches `EXPECTED_VTABLE_VERSION`.
 *  6. `(*device)->ObtainExclusiveAccess()`.
 *  7. Cache bound `CreateSCSITask`, `ReleaseExclusive`, `Release`, `ReleaseDevice`
 *     so the per-VPD-read syscall does not re-bind on every call (risk 4).
 *
 * Per VPD read:
 *  - `task = (*device)->CreateSCSITask()`
 *  - bind + cache the SCSI task interface methods on this task pointer
 *  - `SetCommandDescriptorBlock` / `SetScatterGatherEntries` /
 *    `SetTimeoutDuration` / `ExecuteTaskSync`.
 *  - inspect `outStatus`; if CHECK CONDITION, no sense buffer is plumbed
 *    by the kSCSI_TaskMode interface here (the spike used a 252-byte
 *    sense buf passed to ExecuteTaskSync — we wire it through and surface
 *    parsed sense via the shared loop, closing risk 1).
 *
 * Session teardown releases exclusive access and unwinds the COM/IOKit
 * refcount chain, in order.
 *
 * @module
 */

import type { UsbFingerprint } from '@podkit/device-types';
import { ScsiError } from './errors.js';
import {
  SCSI_STATUS_CHECK_CONDITION,
  SCSI_STATUS_GOOD,
  buildVpdCdb,
  type ScsiSyscall,
  type ScsiSyscallResult,
} from './types.js';

// =============================================================================
// IOKit / CoreFoundation symbols + UUIDs
// =============================================================================

/** SCSI direction constant from `<IOKit/scsi/SCSITask.h>`. */
const kSCSIDataTransfer_FromTargetToInitiator = 2;

/**
 * Expected `SCSITaskDeviceInterface->version` value. The spike confirmed
 * this against the IOKit shipping in macOS 15 (arm64). If Apple bumps the
 * vtable layout in a future release this assertion fires before any SCSI
 * call lands. (Risk 5.)
 *
 * `kIOCFPlugInInterfaceID` is version 1; `SCSITaskDeviceInterface`
 * extends it and uses version 1 too. Treated as a constant so test
 * harnesses can override via {@link openMacosScsiSyscall}'s opts.
 */
const EXPECTED_VTABLE_VERSION = 1;

/** Pointer size on LP64 macOS. */
const PTR = 8;

// SCSITaskDeviceInterface vtable slot offsets (in bytes).
// FINDINGS confirms slots 8/9/10 for ObtainExclusive/ReleaseExclusive/CreateSCSITask.
// Slot 4 holds (UInt16 version, UInt16 revision) packed into 4 bytes
// followed by 4 bytes alignment padding.
const TASK_DEV_VERSION_OFFSET = 4 * PTR;
const TASK_DEV_OBTAIN_EXCLUSIVE_OFFSET = 8 * PTR;
const TASK_DEV_RELEASE_EXCLUSIVE_OFFSET = 9 * PTR;
const TASK_DEV_CREATE_SCSI_TASK_OFFSET = 10 * PTR;
const IUNKNOWN_QUERY_INTERFACE_OFFSET = 1 * PTR;
const IUNKNOWN_RELEASE_OFFSET = 3 * PTR;

// SCSITaskInterface vtable slot offsets (in bytes).
const TASK_SET_CDB_OFFSET = 8 * PTR;
const TASK_SET_SG_OFFSET = 11 * PTR;
const TASK_SET_TIMEOUT_OFFSET = 12 * PTR;
const TASK_EXECUTE_SYNC_OFFSET = 16 * PTR;

// =============================================================================
// Type-erased opaque pointer types for koffi values
// =============================================================================

type Opaque = unknown;

interface MacosBinding {
  IOMainPort: (...args: unknown[]) => number;
  IOServiceMatching: (name: string) => Opaque;
  IOServiceGetMatchingService: (port: number, matching: Opaque) => number;
  IOObjectRelease: (obj: number) => number;
  IOCreatePlugInInterfaceForService: (...args: unknown[]) => number;
  CFUUIDCreateFromUUIDBytes: (alloc: Opaque, bytes: Record<string, number>) => Opaque;
  CFUUIDGetUUIDBytes: (uuid: Opaque) => Record<string, number>;
  CFRelease: (obj: Opaque) => void;
  // koffi runtime helpers we need:
  decode: (...args: unknown[]) => unknown;
  address: (buf: Buffer) => bigint | number;
  // Prototypes for vtable methods.
  protos: {
    QueryInterface: unknown;
    Release: unknown;
    ObtainExclusiveAccess: unknown;
    ReleaseExclusiveAccess: unknown;
    CreateSCSITask: unknown;
    SetCommandDescriptorBlock: unknown;
    SetScatterGatherEntries: unknown;
    SetTimeoutDuration: unknown;
    ExecuteTaskSync: unknown;
  };
}

let cachedBinding: MacosBinding | null = null;

/**
 * Load IOKit + CoreFoundation via koffi and return a binding object.
 * Lazy + cached for the lifetime of the process — koffi is the only
 * heavyweight cost in the SCSI path on macOS.
 *
 * Exported for tests that want to short-circuit / inject.
 */
export async function loadMacosBinding(): Promise<MacosBinding> {
  if (cachedBinding) return cachedBinding;
  const koffiMod = (await import('koffi')) as unknown as {
    default?: typeof import('koffi');
  } & typeof import('koffi');
  const koffi = koffiMod.default ?? koffiMod;

  const IOKit = koffi.load('/System/Library/Frameworks/IOKit.framework/IOKit');
  const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');

  // 16-byte CFUUIDBytes value passed by value through CFUUIDCreateFromUUIDBytes.
  koffi.struct('CFUUIDBytes', {
    byte0: 'uint8',
    byte1: 'uint8',
    byte2: 'uint8',
    byte3: 'uint8',
    byte4: 'uint8',
    byte5: 'uint8',
    byte6: 'uint8',
    byte7: 'uint8',
    byte8: 'uint8',
    byte9: 'uint8',
    byte10: 'uint8',
    byte11: 'uint8',
    byte12: 'uint8',
    byte13: 'uint8',
    byte14: 'uint8',
    byte15: 'uint8',
  });
  // SCSITaskSGElement on LP64 macOS = struct { uint64_t address; uint64_t length; }
  koffi.struct('SCSITaskSGElement', {
    address: 'uint64',
    length: 'uint64',
  });

  // FINDINGS gotcha #2: pass `proto` directly to koffi.decode for callable-from-pointer;
  // do NOT wrap with koffi.pointer.
  const QueryInterface = koffi.proto(
    'int32_t QueryInterface(void *self, CFUUIDBytes iid, _Out_ void **ppv)'
  );
  const Release = koffi.proto('uint32_t Release(void *self)');
  const ObtainExclusiveAccess = koffi.proto('int32_t ObtainExclusiveAccess(void *self)');
  const ReleaseExclusiveAccess = koffi.proto('int32_t ReleaseExclusiveAccess(void *self)');
  const CreateSCSITask = koffi.proto('void **CreateSCSITask(void *self)');
  const SetCommandDescriptorBlock = koffi.proto(
    'int32_t SetCommandDescriptorBlock(void *task, uint8_t *cdb, uint8_t size)'
  );
  const SetScatterGatherEntries = koffi.proto(
    'int32_t SetScatterGatherEntries(void *task, SCSITaskSGElement *list, uint8_t count,' +
      ' uint64_t total, uint8_t direction)'
  );
  const SetTimeoutDuration = koffi.proto('int32_t SetTimeoutDuration(void *task, uint32_t ms)');
  const ExecuteTaskSync = koffi.proto(
    'int32_t ExecuteTaskSync(void *task, void *senseBuf, _Out_ uint8_t *outStatus,' +
      ' _Out_ uint64_t *transferred)'
  );

  cachedBinding = {
    IOMainPort: IOKit.func(
      'int IOMainPort(uint32_t bootstrapPort, _Out_ uint32_t *masterPort)'
    ) as MacosBinding['IOMainPort'],
    IOServiceMatching: IOKit.func(
      'void *IOServiceMatching(const char *name)'
    ) as MacosBinding['IOServiceMatching'],
    IOServiceGetMatchingService: IOKit.func(
      'uint32_t IOServiceGetMatchingService(uint32_t mainPort, void *matching)'
    ) as MacosBinding['IOServiceGetMatchingService'],
    IOObjectRelease: IOKit.func(
      'int IOObjectRelease(uint32_t object)'
    ) as MacosBinding['IOObjectRelease'],
    IOCreatePlugInInterfaceForService: IOKit.func(
      'int IOCreatePlugInInterfaceForService(uint32_t service, void *plugInType, void *interfaceType,' +
        ' _Out_ void ***plugIn, _Out_ int32_t *score)'
    ) as MacosBinding['IOCreatePlugInInterfaceForService'],
    CFUUIDCreateFromUUIDBytes: CF.func(
      'void *CFUUIDCreateFromUUIDBytes(void *allocator, CFUUIDBytes bytes)'
    ) as MacosBinding['CFUUIDCreateFromUUIDBytes'],
    CFUUIDGetUUIDBytes: CF.func(
      'CFUUIDBytes CFUUIDGetUUIDBytes(void *uuid)'
    ) as MacosBinding['CFUUIDGetUUIDBytes'],
    CFRelease: CF.func('void CFRelease(void *)') as MacosBinding['CFRelease'],
    decode: koffi.decode as MacosBinding['decode'],
    address: koffi.address as MacosBinding['address'],
    protos: {
      QueryInterface,
      Release,
      ObtainExclusiveAccess,
      ReleaseExclusiveAccess,
      CreateSCSITask,
      SetCommandDescriptorBlock,
      SetScatterGatherEntries,
      SetTimeoutDuration,
      ExecuteTaskSync,
    },
  };
  return cachedBinding;
}

// =============================================================================
// CFUUIDBytes literals
// =============================================================================

function uuidBytes(...b: number[]): Record<string, number> {
  if (b.length !== 16) throw new Error('uuidBytes expects 16 bytes');
  return Object.fromEntries(b.map((v, i) => [`byte${i}`, v]));
}

const PLUGIN_INTERFACE_UUID = uuidBytes(
  0xc2,
  0x44,
  0xe8,
  0x58,
  0x10,
  0x9c,
  0x11,
  0xd4,
  0x91,
  0xd4,
  0x00,
  0x50,
  0xe4,
  0xc6,
  0x42,
  0x6f
);
const SCSI_TASK_DEVICE_USER_CLIENT_TYPE_UUID = uuidBytes(
  0x7d,
  0x66,
  0x67,
  0x8e,
  0x08,
  0xa2,
  0x11,
  0xd5,
  0xa1,
  0xb8,
  0x00,
  0x30,
  0x65,
  0x7d,
  0x05,
  0x2a
);
const SCSI_TASK_DEVICE_INTERFACE_UUID = uuidBytes(
  0x1b,
  0xbc,
  0x41,
  0x32,
  0x08,
  0xa5,
  0x11,
  0xd5,
  0x90,
  0xed,
  0x00,
  0x30,
  0x65,
  0x7d,
  0x05,
  0x2a
);

// =============================================================================
// Public session API
// =============================================================================

/** Options for {@link openMacosScsiSyscall}. */
export interface MacosSessionOptions {
  /** Per-VPD-read timeout in milliseconds. */
  timeoutMs: number;
  /**
   * Override the expected vtable version. Tests use this to verify the
   * mismatch path; production should never set it.
   */
  expectedVtableVersion?: number;
}

/** Handle to an open macOS SCSI session. */
export interface MacosScsiSession {
  syscall: ScsiSyscall;
  close: () => void;
}

/**
 * Open the IOKit SCSI session for the iPod identified by `fp`. On macOS
 * the IOKit kext handles per-device matching internally — we look up the
 * `com_apple_driver_iPodSBCNub` IOService. (Multi-iPod selection by
 * vendor/product/serial is a future task; today there's at most one
 * matching service.)
 *
 * Closes risk 5 (vtable version assertion) and risk 4 (per-task method
 * binding cache).
 */
export async function openMacosScsiSyscall(
  fp: UsbFingerprint,
  opts: MacosSessionOptions
): Promise<MacosScsiSession> {
  void fp; // see TODO above; we currently match the only iPod IOService.
  const expectedVtableVersion = opts.expectedVtableVersion ?? EXPECTED_VTABLE_VERSION;
  const b = await loadMacosBinding();

  // 1. Master port.
  const portOut = [0];
  let rc = b.IOMainPort(0, portOut);
  if (rc !== 0) {
    throw new ScsiError({ kind: 'iokit', rc, where: 'IOMainPort' });
  }
  const masterPort = portOut[0]!;

  // 2. Find the iPod SBC nub.
  const matching = b.IOServiceMatching('com_apple_driver_iPodSBCNub');
  if (!matching) {
    throw new ScsiError({ kind: 'kext-missing' });
  }
  // IOServiceGetMatchingService consumes a ref on `matching`.
  const service = b.IOServiceGetMatchingService(masterPort, matching);
  if (service === 0) {
    throw new ScsiError({ kind: 'kext-missing' });
  }

  // 3. Plug-in interface.
  let plugin: Opaque = null;
  let taskDevice: Opaque = null;
  let exclusiveAcquired = false;

  const cleanup = (() => {
    return () => {
      try {
        if (taskDevice) {
          if (exclusiveAcquired) {
            try {
              const ReleaseExclusive = bindMethod(
                b,
                taskDevice,
                TASK_DEV_RELEASE_EXCLUSIVE_OFFSET,
                b.protos.ReleaseExclusiveAccess
              ) as (s: Opaque) => number;
              ReleaseExclusive(taskDevice);
            } catch {
              /* ignore */
            }
          }
          try {
            const ReleaseDevice = bindMethod(
              b,
              taskDevice,
              IUNKNOWN_RELEASE_OFFSET,
              b.protos.Release
            ) as (s: Opaque) => number;
            ReleaseDevice(taskDevice);
          } catch {
            /* ignore */
          }
        }
        if (plugin) {
          try {
            const ReleasePlugin = bindMethod(
              b,
              plugin,
              IUNKNOWN_RELEASE_OFFSET,
              b.protos.Release
            ) as (s: Opaque) => number;
            ReleasePlugin(plugin);
          } catch {
            /* ignore */
          }
        }
      } finally {
        b.IOObjectRelease(service);
      }
    };
  })();

  try {
    const userClientTypeUUID = b.CFUUIDCreateFromUUIDBytes(
      null,
      SCSI_TASK_DEVICE_USER_CLIENT_TYPE_UUID
    );
    const plugInIfaceUUID = b.CFUUIDCreateFromUUIDBytes(null, PLUGIN_INTERFACE_UUID);
    if (!userClientTypeUUID || !plugInIfaceUUID) {
      throw new ScsiError({
        kind: 'iokit',
        rc: 0,
        where: 'CFUUIDCreateFromUUIDBytes',
      });
    }
    const pluginOut: Opaque[] = [null];
    const scoreOut = [0];
    rc = b.IOCreatePlugInInterfaceForService(
      service,
      userClientTypeUUID,
      plugInIfaceUUID,
      pluginOut,
      scoreOut
    );
    b.CFRelease(userClientTypeUUID);
    b.CFRelease(plugInIfaceUUID);
    if (rc !== 0 || !pluginOut[0]) {
      throw new ScsiError({ kind: 'iokit', rc, where: 'IOCreatePlugInInterfaceForService' });
    }
    plugin = pluginOut[0];

    // 4. QueryInterface for SCSITaskDeviceInterface.
    const QueryInterface = bindMethod(
      b,
      plugin,
      IUNKNOWN_QUERY_INTERFACE_OFFSET,
      b.protos.QueryInterface
    ) as (self: Opaque, iid: Record<string, number>, ppv: Opaque[]) => number;
    const taskDeviceUUID = b.CFUUIDCreateFromUUIDBytes(null, SCSI_TASK_DEVICE_INTERFACE_UUID);
    const taskDeviceUUIDBytes = b.CFUUIDGetUUIDBytes(taskDeviceUUID);
    const ifaceOut: Opaque[] = [null];
    rc = QueryInterface(plugin, taskDeviceUUIDBytes, ifaceOut);
    b.CFRelease(taskDeviceUUID);
    if (rc !== 0 || !ifaceOut[0]) {
      throw new ScsiError({
        kind: 'iokit',
        rc,
        where: 'QueryInterface(SCSITaskDeviceInterface)',
      });
    }
    taskDevice = ifaceOut[0];

    // 5. Risk 5 — vtable version assertion.
    assertVtableVersion(b, taskDevice, expectedVtableVersion);

    // 6. Obtain exclusive access.
    const ObtainExclusive = bindMethod(
      b,
      taskDevice,
      TASK_DEV_OBTAIN_EXCLUSIVE_OFFSET,
      b.protos.ObtainExclusiveAccess
    ) as (s: Opaque) => number;
    rc = ObtainExclusive(taskDevice);
    if (rc !== 0) {
      throw new ScsiError({
        kind: 'ebusy',
        message:
          'ObtainExclusiveAccess failed — another process may have the device ' +
          '(quit Finder/Music/iTunes)',
        rc,
      });
    }
    exclusiveAcquired = true;

    // 7. Risk 4 — bind device-level methods once and cache them.
    const CreateSCSITask = bindMethod(
      b,
      taskDevice,
      TASK_DEV_CREATE_SCSI_TASK_OFFSET,
      b.protos.CreateSCSITask
    ) as (s: Opaque) => Opaque;

    const syscall = makeMacosSyscall({
      binding: b,
      taskDevice,
      createSCSITask: CreateSCSITask,
      timeoutMs: opts.timeoutMs,
    });

    return {
      syscall,
      close: cleanup,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

// =============================================================================
// Per-VPD syscall — caches the per-task method bindings.
// =============================================================================

interface MacosSyscallParams {
  binding: MacosBinding;
  taskDevice: Opaque;
  createSCSITask: (s: Opaque) => Opaque;
  timeoutMs: number;
}

/**
 * Build the {@link ScsiSyscall} closure for macOS. Each VPD read creates
 * a fresh task (per IOKit lifecycle requirements) but the per-task method
 * pointers are bound once and reused across SetCDB / SetSG / SetTimeout /
 * ExecuteTaskSync within that task — closing risk 4.
 *
 * Exported for tests that pass a stub `binding`.
 */
export function makeMacosSyscall(params: MacosSyscallParams): ScsiSyscall {
  const { binding: b, taskDevice, createSCSITask, timeoutMs } = params;
  return (page: number, allocLen: number): ScsiSyscallResult => {
    const task = createSCSITask(taskDevice);
    if (!task) {
      return { ok: false, kind: 'iokit', rc: 0, where: 'CreateSCSITask returned null' };
    }
    // Bind per-task methods once. (Risk 4.)
    const SetCDB = bindMethod(b, task, TASK_SET_CDB_OFFSET, b.protos.SetCommandDescriptorBlock) as (
      t: Opaque,
      cdb: Buffer,
      size: number
    ) => number;
    const SetSG = bindMethod(b, task, TASK_SET_SG_OFFSET, b.protos.SetScatterGatherEntries) as (
      t: Opaque,
      list: { address: bigint; length: bigint }[],
      count: number,
      total: bigint,
      direction: number
    ) => number;
    const SetTimeout = bindMethod(
      b,
      task,
      TASK_SET_TIMEOUT_OFFSET,
      b.protos.SetTimeoutDuration
    ) as (t: Opaque, ms: number) => number;
    const ExecuteSync = bindMethod(b, task, TASK_EXECUTE_SYNC_OFFSET, b.protos.ExecuteTaskSync) as (
      t: Opaque,
      sense: Buffer,
      statusOut: number[],
      transferredOut: bigint[]
    ) => number;
    const ReleaseTask = bindMethod(b, task, IUNKNOWN_RELEASE_OFFSET, b.protos.Release) as (
      t: Opaque
    ) => number;

    const cdb = Buffer.from(buildVpdCdb(page, allocLen));
    const data = Buffer.alloc(allocLen);
    const sense = Buffer.alloc(252);

    try {
      let rc = SetCDB(task, cdb, cdb.length);
      if (rc !== 0) {
        return { ok: false, kind: 'iokit', rc, where: 'SetCommandDescriptorBlock' };
      }
      const addr = b.address(data);
      const sg = [
        {
          address: typeof addr === 'bigint' ? addr : BigInt(addr),
          length: BigInt(data.length),
        },
      ];
      rc = SetSG(task, sg, 1, BigInt(data.length), kSCSIDataTransfer_FromTargetToInitiator);
      if (rc !== 0) {
        return { ok: false, kind: 'iokit', rc, where: 'SetScatterGatherEntries' };
      }
      rc = SetTimeout(task, timeoutMs);
      if (rc !== 0) {
        return { ok: false, kind: 'iokit', rc, where: 'SetTimeoutDuration' };
      }
      const statusOut = [0];
      const transferredOut = [0n];
      rc = ExecuteSync(task, sense, statusOut, transferredOut);
      // ExecuteTaskSync returns kIOReturnTimeout for timeouts (0xE00002D6).
      if (rc === 0xe00002d6) {
        return { ok: false, kind: 'timeout' };
      }
      if (rc !== 0) {
        return { ok: false, kind: 'iokit', rc, where: 'ExecuteTaskSync' };
      }
      const status = statusOut[0]!;
      if (status === SCSI_STATUS_CHECK_CONDITION) {
        return {
          ok: false,
          kind: 'check-condition',
          sense: new Uint8Array(sense.buffer, sense.byteOffset, sense.length),
          status,
        };
      }
      if (status !== SCSI_STATUS_GOOD) {
        return {
          ok: false,
          kind: 'other',
          message: `SCSI status 0x${status.toString(16)} (non-GOOD, no CHECK CONDITION)`,
        };
      }
      return { ok: true, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
    } finally {
      try {
        ReleaseTask(task);
      } catch {
        /* ignore */
      }
    }
  };
}

// =============================================================================
// Vtable plumbing
// =============================================================================

/**
 * Read the SCSITaskDeviceInterface vtable's `version` field at slot 4
 * (a UInt16 immediately followed by `revision` and 4 bytes of pointer
 * alignment padding) and throw if it does not match the value observed
 * during the spike. Closes risk 5.
 *
 * Exported for tests.
 */
export function assertVtableVersion(
  b: Pick<MacosBinding, 'decode'>,
  iface: Opaque,
  expected: number
): void {
  const vtable = b.decode(iface, 'void *');
  const got = b.decode(vtable, TASK_DEV_VERSION_OFFSET, 'uint16') as number;
  if (got !== expected) {
    throw new ScsiError({
      kind: 'vtable-version-mismatch',
      got,
      expected,
    });
  }
}

/**
 * Read a function pointer from an interface vtable and wrap it in a koffi
 * callable using `proto`. See FINDINGS.md "What worked > triple decode"
 * and "Gotchas P1 must know" for why this is the right shape.
 */
function bindMethod(b: MacosBinding, iface: Opaque, offset: number, proto: unknown): unknown {
  const vtable = b.decode(iface, 'void *');
  const fnPtr = b.decode(vtable, offset, 'void *');
  // FINDINGS gotcha #2: pass `proto` directly — NO koffi.pointer wrapper.
  return b.decode(fnPtr, proto);
}
