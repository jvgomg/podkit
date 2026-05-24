# dummy-hcd-daemon

FunctionFS userspace daemon that synthesises iPod-shaped USB devices on
Linux `dummy_hcd` for Tier 3 tests. See [ADR-016](../../../adr/adr-016-linux-vm-test-harness.md)
for the full architecture.

The daemon runs inside the `podkit-device-harness` Lima VM
(`tools/device-testing/lima/podkit-device-harness.yaml`). It is delivered as a single
self-contained binary produced by `bun build --compile`; the test VM has
no Bun, no Node, no source tree.

## Layout

```
tools/device-testing/dummy-hcd/
├── package.json            # private; @podkit/dummy-hcd (NOT a workspace)
├── tsconfig.json
├── README.md               # you are here
├── dummy-hcd-daemon@.service   # systemd instance template
├── scripts/
│   └── build.sh            # bun build --compile invocation
├── src/
│   ├── main.ts             # entry — argv → sidecar → gadget → ep0 loop
│   ├── cli.ts              # tiny zero-dep argv parser
│   ├── protocol.ts         # pure wire-protocol logic (testable on macOS)
│   ├── gadget.ts           # configfs gadget tree setup + teardown
│   ├── functionfs.ts       # ep0 SETUP-packet event loop (scaffold)
│   └── __tests__/          # unit tests (run on macOS)
└── dist/                   # compiled binaries (gitignored)
```

`package.json` does **not** declare a `@podkit/device-testing` workspace
dependency. The daemon's source imports `parseSidecar` directly from
`packages/device-testing/src/personas/sidecar.ts` via a relative path —
this keeps the dummy-hcd tree free of `node_modules` and lets `bun
build --compile` bundle everything into a single binary without resolving
a workspace symlink.

## Wire-level vendor control transfer

The daemon serves the SysInfoExtended XML payload of the loaded persona
over a USB vendor control transfer. The wire shape mirrors libgpod
0.8.3's `itdb_read_sysinfo_extended_from_usb` (and is matched on the
client side by `packages/ipod-firmware/src/inquiry/usb.ts`):

| Field | Value | Notes |
| --- | --- | --- |
| `bmRequestType` | `0xC0` | device → host, vendor, device |
| `bRequest` | `0x40` | iPod-specific vendor read |
| `wValue` | `0x02` | SysInfoExtended selector |
| `wIndex` | `0..N` | page index, iterates from 0 upward |
| `wLength` | `0x1000` (`4096`) | max bytes per page; daemon honours smaller |
| **Response** | up to 4096 bytes | concatenated across pages = the XML payload |

A short read (fewer than 4096 bytes) terminates iteration. If the XML
length is an exact multiple of 4096, the daemon emits one final empty
page as the terminator. See `src/protocol.ts` for the canonical
implementation.

## JSON sidecar format

The `lima-test-vm` runner (TASK-322.04) writes the persona registry to a
JSON file at `/var/device-testing/personas.json` during `prepare()`. The
daemon loads this file at startup. The schema is fully described in
`packages/device-testing/src/personas/sidecar.ts`.

Shape:

```json
{
  "schemaVersion": 1,
  "personas": {
    "ipod-video-5g-iflash-1tb": {
      "id": "ipod-video-5g-iflash-1tb",
      "description": "iPod 5G Video iFlash 1TB mod (TERAPOD)",
      "usbDescriptor": {
        "vendorId": "0x05ac",
        "productId": "0x1209",
        "serial": "000A27001605D1A0"
      },
      "sysInfoExtendedXml": "<?xml version='1.0'?>…"
    },
    "echo-mini": {
      "id": "echo-mini",
      "description": "FiiO Snowsky Echo Mini",
      "usbDescriptor": {
        "vendorId": "0x071b",
        "productId": "0x3203"
      },
      "massStorageBackingFile": {
        "vmPath": "/var/device-testing/echo-mini-backing.img",
        "resetStrategy": "copy"
      }
    }
  }
}
```

Personas without a `sysInfoExtendedXml` are mass-storage-only; the daemon
will configure `usb_f_mass_storage` but skip FunctionFS. Personas without
a `massStorageBackingFile` are iPod-style; the daemon will configure
FunctionFS but skip mass storage.

## Building

From the repo root:

```bash
bash tools/device-testing/dummy-hcd/scripts/build.sh           # auto-detect target
bash tools/device-testing/dummy-hcd/scripts/build.sh linux-x64 # explicit
bash tools/device-testing/dummy-hcd/scripts/build.sh all       # both
```

Output: `tools/device-testing/dummy-hcd/dist/dummy-hcd-daemon-linux-{x64,arm64}`.

The build script invokes `bun build --compile --target=bun-linux-<arch>`.
Bun supports cross-compiling from macOS to Linux, so the same script
works on a dev mac without needing to drop into the builder VM. CI uses
the builder VM via the turbo task `@podkit/dummy-hcd#build`.

## Deploying into the test VM

The compiled binary is transferred via the existing `transferBinary`
machinery in `@podkit/device-testing`:

```ts
import { transferBinary } from '@podkit/device-testing';
await transferBinary({
  vmName: 'podkit-device-harness',
  binaryPath: 'tools/device-testing/dummy-hcd/dist/dummy-hcd-daemon-linux-arm64',
  vmPath: '/usr/local/bin/dummy-hcd-daemon',
});
```

The systemd unit (`dummy-hcd-daemon@.service`) lives at
`/etc/systemd/system/` in the VM. The runner installs both the binary
and the unit file during `prepare()`.

## Process supervision (systemd)

The daemon is run as a **systemd instance unit** — one logical service per
persona, parameterised by the `%i` instance specifier. The runner starts
and stops these units between tests:

```
systemctl start dummy-hcd-daemon@ipod-video-5g-iflash-1tb.service
… run tests …
systemctl stop dummy-hcd-daemon@ipod-video-5g-iflash-1tb.service
```

SIGTERM triggers the daemon's signal handler, which tears down the
gadget tree, unmounts FunctionFS, and exits 0. systemd waits up to 10 s
before escalating to SIGKILL.

## Mass-storage backing file: daemon vs runner boundary

The daemon **only configures** the `usb_f_mass_storage` function with
`lun0/file = <backing path>`. The backing file's lifecycle is owned by
the runner:

| Step | Owner |
| --- | --- |
| Stage FAT32 image to the test VM | Runner (`prepare()`) |
| Configure gadget to point at the image | Daemon |
| Reset the image between tests (copy/swap) | Runner |
| Tear down the gadget on test exit | Daemon (SIGTERM) |
| Delete the image after the test group | Runner (cleanup) |

This split keeps the daemon stateless: the file at `backing.vmPath` is
truth, and the daemon's only job is to hand the kernel a pointer to it.

## Adding a new persona handler

Most personas need **no daemon changes** — they slot into the existing
machinery just by being added to `packages/device-testing/src/personas/`.
The daemon will pick the new entry up from the sidecar.

Cases that DO require daemon changes:

1. **A non-standard USB descriptor shape.** Add the new fields to
   `SidecarUsbDescriptor` in `packages/device-testing/src/personas/sidecar.ts`,
   update `validateSidecarPersona` to accept them, and apply them in
   `gadget.ts:createGadget`.

2. **A different vendor control transfer.** Add the new request to
   `protocol.ts:classifyRequest` and write a matching `getPagePayload`
   function. Wire it into `functionfs.ts`'s SETUP dispatcher.

3. **A new gadget function** (e.g. HID, network). Add it to `gadget.ts`
   alongside the existing FunctionFS and mass-storage paths, with a
   matching feature flag in `GadgetBindOpts`.

When bumping `SIDECAR_SCHEMA_VERSION`, update every persona in the
registry in the same commit (see ADR-017 §"Schema versioning").

## Tests

```
bun test tools/device-testing/dummy-hcd/src/__tests__/
```

The tests run on macOS without kernel modules:

| File | Coverage |
| --- | --- |
| `protocol.test.ts` | SETUP-packet decoding, request classification, paging, short-read termination, client/server iteration round-trip |
| `cli.test.ts` | argv parsing, default values, error paths |
| `main.test.ts` | daemon smoke tests: missing persona, missing sidecar, malformed schema, `--dry-run` happy path |

Tier 3 integration tests (configfs/FunctionFS against `dummy_hcd`) run
inside the test VM and live in `@podkit/device-testing`.

## Implementation status

| Component | Status |
| --- | --- |
| CLI parser | Complete |
| Sidecar parse + validate | Complete |
| configfs gadget setup | Complete (mirrors `virtual-ipod-server/src/gadget.ts`) |
| Mass-storage function | Complete (configures `usb_f_mass_storage/lun.0/file`) |
| FunctionFS mount | Complete (shells out to `mount -t functionfs`) |
| ep0 SETUP read loop | **Scaffold** — reads packets, classifies, writes pages |
| ep0 descriptor handshake | **Deferred** to follow-up task with live VM |
| ioctl-based STALL | **Deferred** — Bun does not issue arbitrary ioctls |
| SIGINT/SIGTERM teardown | Complete |
| systemd instance unit | Complete |
| `bun build --compile` build script | Complete |

The descriptor handshake is the only piece between "the daemon starts
and STALLs every SETUP" and "the daemon answers SETUPs correctly". It is
opaque byte-packing that only matters when verified against a live
`dummy_hcd`, and is best landed in a follow-up task with a working test
VM. See `functionfs.ts` for the TODO marker.
