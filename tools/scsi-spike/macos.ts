/**
 * macOS IOKit SCSI VPD inquiry spike via koffi.
 *
 * Drives the IOKit SCSITaskUserClient interface entirely from TypeScript.
 * Replaces what `tools/test_scsi_read_xml` (the verified C prototype referenced
 * in documents/device-identification.md) does in C.
 *
 * Algorithm:
 *  1. Find IOService matching com_apple_driver_iPodSBCNub.
 *  2. IOCreatePlugInInterfaceForService(kIOSCSITaskDeviceUserClientTypeID).
 *  3. (*plugin)->QueryInterface(kIOSCSITaskDeviceInterfaceID).
 *  4. (*device)->ObtainExclusiveAccess().
 *  5. For each VPD page:
 *       task = (*device)->CreateSCSITask()
 *       (*task)->SetCommandDescriptorBlock(INQUIRY 0x12 0x01 page 0 0xFC 0)
 *       (*task)->SetScatterGatherEntries(buf, FromTargetToInitiator)
 *       (*task)->SetTimeoutDuration(5000)
 *       (*task)->ExecuteTaskSync()
 *       (*task)->Release()
 *  6. ReleaseExclusiveAccess + Release.
 *
 * Usage: node --import tsx ./macos.ts [out.xml]
 */
import * as fs from 'node:fs';
import koffi from 'koffi';

// ── Frameworks ──────────────────────────────────────────────────────────────

const IOKit = koffi.load('/System/Library/Frameworks/IOKit.framework/IOKit');
const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');

// ── CoreFoundation types ────────────────────────────────────────────────────

// CFUUIDBytes is a 16-byte struct passed by value.
// Registration is a side effect — `'CFUUIDBytes'` is referenced by name below.
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

const CFUUIDCreateFromUUIDBytes = CF.func(
  'void *CFUUIDCreateFromUUIDBytes(void *allocator, CFUUIDBytes bytes)'
);
const CFUUIDGetUUIDBytes = CF.func('CFUUIDBytes CFUUIDGetUUIDBytes(void *uuid)');
const CFRelease = CF.func('void CFRelease(void *)');

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

// ── IOKit symbols ───────────────────────────────────────────────────────────

const IOMainPort = IOKit.func('int IOMainPort(uint32_t bootstrapPort, _Out_ uint32_t *masterPort)');
const IOServiceMatching = IOKit.func('void *IOServiceMatching(const char *name)');
const IOServiceGetMatchingService = IOKit.func(
  'uint32_t IOServiceGetMatchingService(uint32_t mainPort, void *matching)'
);
const IOObjectRelease = IOKit.func('int IOObjectRelease(uint32_t object)');

// IOCreatePlugInInterfaceForService(IOService, plugInType (CFUUIDRef), interfaceType (CFUUIDRef),
//                                   IOCFPlugInInterface ***plugIn, SInt32 *score)
const IOCreatePlugInInterfaceForService = IOKit.func(
  'int IOCreatePlugInInterfaceForService(uint32_t service, void *plugInType, void *interfaceType,' +
    ' _Out_ void ***plugIn, _Out_ int32_t *score)'
);

// ── IUnknown / vtable plumbing ──────────────────────────────────────────────
//
// IUnknownVTbl on macOS:
//   void *_reserved;
//   HRESULT (*QueryInterface)(void *thisPointer, CFUUIDBytes iid, void **ppv);
//   ULONG (*AddRef)(void *thisPointer);
//   ULONG (*Release)(void *thisPointer);
//
// SCSITaskDeviceInterface vtable continues with:
//   UInt16 version, revision;
//   methods (function pointers)...
//
// The vtable is at *(plugInInterface), i.e. plugInInterface is a pointer-to-pointer.
//
// koffi approach: read function pointers as raw void* values from the vtable, then wrap each
// with koffi.decode + a callable proto for invocation.

const QueryInterfaceProto = koffi.proto(
  'int32_t QueryInterface(void *self, CFUUIDBytes iid, _Out_ void **ppv)'
);
const ReleaseProto = koffi.proto('uint32_t Release(void *self)');

// SCSITaskDeviceInterface methods we call (offsets in vtable in slot order):
const ObtainExclusiveAccessProto = koffi.proto('int32_t ObtainExclusiveAccess(void *self)');
const ReleaseExclusiveAccessProto = koffi.proto('int32_t ReleaseExclusiveAccess(void *self)');
const CreateSCSITaskProto = koffi.proto('void **CreateSCSITask(void *self)');

// SCSITaskInterface methods we call:
const SetCommandDescriptorBlockProto = koffi.proto(
  'int32_t SetCommandDescriptorBlock(void *task, uint8_t *cdb, uint8_t size)'
);
// SCSITaskSGElement on LP64 macOS = struct { uint64_t address; uint64_t length; }
// Registration is a side effect — `'SCSITaskSGElement'` is referenced by name below.
koffi.struct('SCSITaskSGElement', {
  address: 'uint64',
  length: 'uint64',
});
const SetScatterGatherEntriesProto = koffi.proto(
  'int32_t SetScatterGatherEntries(void *task, SCSITaskSGElement *list, uint8_t count,' +
    ' uint64_t total, uint8_t direction)'
);
const SetTimeoutDurationProto = koffi.proto('int32_t SetTimeoutDuration(void *task, uint32_t ms)');
const ExecuteTaskSyncProto = koffi.proto(
  'int32_t ExecuteTaskSync(void *task, void *senseBuf, _Out_ uint8_t *outStatus,' +
    ' _Out_ uint64_t *transferred)'
);
const GetRealizedDataTransferCountProto = koffi.proto(
  'uint64_t GetRealizedDataTransferCount(void *task)'
);

// SCSI direction constants from IOKit/scsi/SCSITask.h:
const kSCSIDataTransfer_FromTargetToInitiator = 2;

// ── Vtable layout helpers ───────────────────────────────────────────────────
//
// The interface returned by QueryInterface points to a vtable. Each entry is a
// pointer-sized value at fixed offsets. We read via koffi.decode at the slot.

const PTR = 8; // 64-bit pointers

// IUnknown_C_GUTS = 4 slots: _reserved, QueryInterface, AddRef, Release
// Then SCSITaskDeviceInterface adds:
//   2 bytes UInt16 version, 2 bytes UInt16 revision (= 4 bytes; rounded to 8 for next ptr alignment)
//   then function pointers in declaration order.
//
// NOTE: the version/revision fields are not pointer-sized. They occupy 4 bytes total, but
// the next pointer is naturally aligned to 8 bytes, so there is 4 bytes of padding.
// First method pointer therefore starts at offset (4 slots IUnknown) + 8 bytes (version+padding) = 40.
//
// For SCSITaskDeviceInterface, in declaration order from SCSITaskLib.h:
//   IsExclusiveAccessAvailable  @ slot 5
//   AddCallbackDispatcherToRunLoop @ slot 6
//   RemoveCallbackDispatcherFromRunLoop @ slot 7
//   ObtainExclusiveAccess @ slot 8
//   ReleaseExclusiveAccess @ slot 9
//   CreateSCSITask @ slot 10
//
// (Slot 0..3 = IUnknown; slot 4 = version+revision packed)

const TASK_DEV_OBTAIN_EXCLUSIVE_OFFSET = 8 * PTR;
const TASK_DEV_RELEASE_EXCLUSIVE_OFFSET = 9 * PTR;
const TASK_DEV_CREATE_SCSI_TASK_OFFSET = 10 * PTR;
const IUNKNOWN_RELEASE_OFFSET = 3 * PTR;

// SCSITaskInterface in declaration order from SCSITaskLib.h:
//   IsTaskActive @ slot 5
//   SetTaskAttribute @ 6
//   GetTaskAttribute @ 7
//   SetCommandDescriptorBlock @ 8
//   GetCommandDescriptorBlockSize @ 9
//   GetCommandDescriptorBlock @ 10
//   SetScatterGatherEntries @ 11
//   SetTimeoutDuration @ 12
//   GetTimeoutDuration @ 13
//   SetTaskCompletionCallback @ 14
//   ExecuteTaskAsync @ 15
//   ExecuteTaskSync @ 16
//   AbortTask @ 17
//   GetSCSIServiceResponse @ 18
//   GetTaskState @ 19
//   GetTaskStatus @ 20
//   GetRealizedDataTransferCount @ 21

const TASK_SET_CDB_OFFSET = 8 * PTR;
const TASK_SET_SG_OFFSET = 11 * PTR;
const TASK_SET_TIMEOUT_OFFSET = 12 * PTR;
const TASK_EXECUTE_SYNC_OFFSET = 16 * PTR;
const TASK_GET_REALIZED_OFFSET = 21 * PTR;

/**
 * Dereference plugin (pointer-to-pointer-to-vtable) and return a koffi-wrapped
 * function for the method at the given byte offset within the vtable.
 */
function bindMethod(plugin: any, offset: number, proto: any): any {
  const vtable = koffi.decode(plugin, 'void *');
  const fnPtr = koffi.decode(vtable, offset, 'void *');
  return koffi.decode(fnPtr, proto);
}

// ── Main ────────────────────────────────────────────────────────────────────

function inquiryVpd(taskDevicePlugIn: any, page: number, allocLen = 252): Buffer {
  const CreateSCSITask = bindMethod(
    taskDevicePlugIn,
    TASK_DEV_CREATE_SCSI_TASK_OFFSET,
    CreateSCSITaskProto
  );
  const task = CreateSCSITask(taskDevicePlugIn);
  if (!task) throw new Error('CreateSCSITask returned null');

  try {
    const SetCDB = bindMethod(task, TASK_SET_CDB_OFFSET, SetCommandDescriptorBlockProto);
    const SetSG = bindMethod(task, TASK_SET_SG_OFFSET, SetScatterGatherEntriesProto);
    const SetTimeout = bindMethod(task, TASK_SET_TIMEOUT_OFFSET, SetTimeoutDurationProto);
    const ExecuteSync = bindMethod(task, TASK_EXECUTE_SYNC_OFFSET, ExecuteTaskSyncProto);
    const GetRealized = bindMethod(
      task,
      TASK_GET_REALIZED_OFFSET,
      GetRealizedDataTransferCountProto
    );
    const ReleaseTask = bindMethod(task, IUNKNOWN_RELEASE_OFFSET, ReleaseProto);

    const cdb = Buffer.from([
      0x12,
      0x01,
      page & 0xff,
      (allocLen >> 8) & 0xff,
      allocLen & 0xff,
      0x00,
    ]);
    const data = Buffer.alloc(allocLen);
    const sense = Buffer.alloc(252);

    let rc = SetCDB(task, cdb, cdb.length);
    if (rc !== 0) throw new Error(`SetCDB failed: 0x${rc.toString(16)}`);

    const sg = {
      address: BigInt(koffi.address(data)),
      length: BigInt(data.length),
    };
    rc = SetSG(task, [sg], 1, BigInt(data.length), kSCSIDataTransfer_FromTargetToInitiator);
    if (rc !== 0) throw new Error(`SetScatterGather failed: 0x${rc.toString(16)}`);

    rc = SetTimeout(task, 5000);
    if (rc !== 0) throw new Error(`SetTimeout failed: 0x${rc.toString(16)}`);

    const statusOut = [0];
    const transferredOut = [0n];
    rc = ExecuteSync(task, sense, statusOut, transferredOut);
    if (rc !== 0) {
      throw new Error(
        `ExecuteTaskSync failed for page 0x${page.toString(16)}: 0x${rc.toString(16)}`
      );
    }
    if (statusOut[0] !== 0) {
      throw new Error(`SCSI status non-zero for page 0x${page.toString(16)}: ${statusOut[0]}`);
    }

    void GetRealized;
    void ReleaseTask;

    return data;
  } finally {
    // Always release the task.
    try {
      const ReleaseTask = bindMethod(task, IUNKNOWN_RELEASE_OFFSET, ReleaseProto);
      ReleaseTask(task);
    } catch {
      /* ignore */
    }
  }
}

function main() {
  const [, , outPath] = process.argv;
  const t0 = process.hrtime.bigint();

  // 1. IOMainPort
  const portOut = [0];
  let rc = IOMainPort(0, portOut);
  if (rc !== 0) throw new Error(`IOMainPort failed: 0x${rc.toString(16)}`);
  const masterPort = portOut[0];
  console.error(`[macos-spike] master port = ${masterPort}`);

  // 2. Find IOService
  const matching = IOServiceMatching('com_apple_driver_iPodSBCNub');
  if (!matching) throw new Error('IOServiceMatching returned null');
  // NOTE: IOServiceGetMatchingService consumes a ref on `matching`.
  const service = IOServiceGetMatchingService(masterPort, matching);
  if (service === 0) {
    throw new Error('No iPod SBC service found (is an iPod connected?)');
  }
  console.error(`[macos-spike] service id = ${service}`);

  try {
    // 3. CreatePlugInInterface
    const userClientTypeUUID = CFUUIDCreateFromUUIDBytes(
      null,
      SCSI_TASK_DEVICE_USER_CLIENT_TYPE_UUID
    );
    const plugInIfaceUUID = CFUUIDCreateFromUUIDBytes(null, PLUGIN_INTERFACE_UUID);
    if (!userClientTypeUUID || !plugInIfaceUUID)
      throw new Error('CFUUIDCreateFromUUIDBytes failed');

    const pluginOut = [null];
    const scoreOut = [0];
    rc = IOCreatePlugInInterfaceForService(
      service,
      userClientTypeUUID,
      plugInIfaceUUID,
      pluginOut,
      scoreOut
    );
    CFRelease(userClientTypeUUID);
    CFRelease(plugInIfaceUUID);
    if (rc !== 0 || !pluginOut[0]) {
      throw new Error(`IOCreatePlugInInterfaceForService failed: 0x${rc.toString(16)}`);
    }
    const plugin = pluginOut[0];
    console.error(`[macos-spike] plugin = ${koffi.address(plugin)}`);

    try {
      // 4. QueryInterface for SCSITaskDeviceInterface
      const QueryInterface = bindMethod(plugin, PTR /* slot 1 */, QueryInterfaceProto);
      const taskDeviceUUID = CFUUIDCreateFromUUIDBytes(null, SCSI_TASK_DEVICE_INTERFACE_UUID);
      const taskDeviceUUIDBytes = CFUUIDGetUUIDBytes(taskDeviceUUID);

      const ifaceOut = [null];
      rc = QueryInterface(plugin, taskDeviceUUIDBytes, ifaceOut);
      CFRelease(taskDeviceUUID);
      if (rc !== 0 || !ifaceOut[0]) {
        throw new Error(`QueryInterface(SCSITaskDeviceInterface) failed: 0x${rc.toString(16)}`);
      }
      const taskDevice = ifaceOut[0];
      console.error(`[macos-spike] task device = ${koffi.address(taskDevice)}`);

      try {
        // 5. ObtainExclusiveAccess
        const ObtainExclusive = bindMethod(
          taskDevice,
          TASK_DEV_OBTAIN_EXCLUSIVE_OFFSET,
          ObtainExclusiveAccessProto
        );
        rc = ObtainExclusive(taskDevice);
        if (rc !== 0) {
          throw new Error(
            `ObtainExclusiveAccess failed: 0x${rc.toString(16)} ` +
              `(another process may have the device — quit Finder/Music/iTunes)`
          );
        }

        try {
          // 6. INQUIRY page 0xC0 → list of subpages
          const indexBuf = inquiryVpd(taskDevice, 0xc0);
          const indexLen = indexBuf[3]!;
          const subpages = Array.from(indexBuf.subarray(4, 4 + indexLen));
          console.error(
            `[macos-spike] page 0xC0 returned ${indexLen} subpage ids: ` +
              subpages.map((b) => '0x' + b.toString(16)).join(' ')
          );

          const chunks: Buffer[] = [];
          for (const page of subpages) {
            const buf = inquiryVpd(taskDevice, page);
            const len = buf[3]!;
            chunks.push(Buffer.from(buf.subarray(4, 4 + len)));
          }
          const xml = Buffer.concat(chunks);
          const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
          console.error(
            `[macos-spike] read ${subpages.length} subpages, ${xml.length} bytes total in ${elapsedMs.toFixed(1)}ms`
          );
          if (outPath) {
            fs.writeFileSync(outPath, xml);
            console.error(`[macos-spike] wrote ${outPath}`);
          } else {
            process.stdout.write(xml);
          }
        } finally {
          const ReleaseExclusive = bindMethod(
            taskDevice,
            TASK_DEV_RELEASE_EXCLUSIVE_OFFSET,
            ReleaseExclusiveAccessProto
          );
          ReleaseExclusive(taskDevice);
        }
      } finally {
        const ReleaseIface = bindMethod(taskDevice, IUNKNOWN_RELEASE_OFFSET, ReleaseProto);
        ReleaseIface(taskDevice);
      }
    } finally {
      const ReleasePlugin = bindMethod(plugin, IUNKNOWN_RELEASE_OFFSET, ReleaseProto);
      ReleasePlugin(plugin);
    }
  } finally {
    IOObjectRelease(service);
  }
}

try {
  main();
} catch (err) {
  console.error(`[macos-spike] FAIL:`, err instanceof Error ? err.message : err);
  process.exit(1);
}
