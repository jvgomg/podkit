---
id: TASK-332
title: >-
  DevicePersona schema v2: USB descriptor hierarchy, partition LUN, nullable
  serial
status: To Do
assignee: []
created_date: '2026-05-13 22:31'
labels:
  - testing
  - vm-coverage
  - schema
  - fixtures
milestone: m-19
dependencies:
  - TASK-321.02
documentation:
  - packages/device-testing/src/personas/types.ts
  - adr/adr-017-device-persona-fixtures.md
  - documents/persona-capture-playbook.md
priority: medium
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three schema gaps surfaced during the TASK-321.02 persona-capture pass. All are coordinated changes to `DevicePersona` (and the v1 → v2 migration of the 14 committed personas), best landed as one ticket. Block TASK-322.05 (FunctionFS daemon) on this — the daemon needs the full USB descriptor hierarchy to synthesize a credible gadget.

## Gap 1 — `usbDescriptor` is flat; FunctionFS needs the full hierarchy

The current schema only covers the **device descriptor** (vendor/product/serial + top-level class/subclass/protocol). A real USB device descriptor also declares:

- `bNumConfigurations` (Linux sysfs surfaced this for iPod nano 3G as `2`; Mac ioreg reported `1` because it shows only the active config — both correct, descriptor-vs-active distinction)
- One or more **configuration descriptors** (each with `bConfigurationValue`, `bNumInterfaces`, attributes, max power)
- For each configuration, one or more **interface descriptors** (each with `bInterfaceNumber`, `bInterfaceClass`/`SubClass`/`Protocol` — this is where Mass Storage Class `0x08` actually lives, NOT on the device-level fields)
- For each interface, one or more **endpoint descriptors** (bulk IN/OUT for MSC; control transfers for iAP)
- **String descriptor table** (vendor name, product name, serial, by index)

ADR-017's reviewer flagged this gap during the original review — see `adr-017-device-persona-fixtures.md` §"Schema versioning" and the reviewer note about FunctionFS daemons needing more than vendor/product/serial. The flat schema can describe a device exists; it cannot drive `tools/device-testing/lima/builder.yaml` to synthesise a believable gadget.

**Suggested shape** (illustrative; let the implementer choose final structure):

```ts
usbDescriptor: {
  vendorId: number;
  productId: number;
  deviceSerial: string | null;          // see Gap 3
  deviceClass: number;
  deviceSubclass: number;
  deviceProtocol: number;
  bMaxPacketSize0: number;
  bcdUSB: number;
  bcdDevice: number;
  bNumConfigurations: number;
  configurations: Array<{
    bConfigurationValue: number;
    bNumInterfaces: number;
    bmAttributes: number;
    bMaxPower: number;
    interfaces: Array<{
      bInterfaceNumber: number;
      bAlternateSetting: number;
      bInterfaceClass: number;
      bInterfaceSubClass: number;
      bInterfaceProtocol: number;
      endpoints: Array<{
        bEndpointAddress: number;
        bmAttributes: number;
        wMaxPacketSize: number;
        bInterval: number;
      }>;
    }>;
  }>;
  stringDescriptors: Record<number, string>; // index → string
};
```

**Capture-side note:** The Linux session for the 4 reconciled personas already captured most of this via `udevadm info` + `cat /sys/bus/usb/devices/<n>/<id>:...interface_descriptor`. Sony Walkman + iPod 5G Video Mac ioreg dumps also include config descriptors. The data exists in `raw/` for many personas already — the schema migration is mostly transcription.

## Gap 2 — `partitionLayout.partitions[]` has no LUN field

`echo-mini` is a dual-LUN device:
- LUN 0 (`/dev/disk4`): internal FAT32 `ECHO MINI` (7.53 GB)
- LUN 1 (`/dev/disk5`): SD-card slot ExFAT `Echo SD` (126 GB)

The current schema flattens both LUNs into a single `partitions[]` array with a comment apologising for the gap. A future multi-LUN device (some Sony Walkmans, certain SD-card-plus-internal DAPs) will hit the same issue.

**Suggested shape:**

```ts
partitionLayout: {
  luns: Array<{
    lun: number;                  // 0-indexed LUN, default 0 for single-LUN devices
    partitions: Array<{
      index: number;
      type: string;
      sizeMiB: number;
      mountpoint?: string;
    }>;
  }>;
}
```

Migration: every existing persona becomes `luns: [{ lun: 0, partitions: [...existingArray] }]` — mechanical, except `echo-mini` gets two entries.

## Gap 3 — `deviceSerial: string` should be `string | null`

Sony NW-HD5 advertises `iSerialNumber = 0` on USB (no serial-descriptor index assigned). Current schema requires `deviceSerial: string`; the NW-HD5 persona uses an empty string `''` as a workaround. Empty-string-as-null is the kind of subtle thing that bites runtime assertions later (`if (persona.deviceSerial) ...` evaluates false for `''` — correct here, but only by accident).

**Fix:** make it nullable. Migrate `''` in `sony-nw-hd5` to `null`; leave non-empty serials untouched in the other 13 personas.

## Out of scope

- Tier 3 FunctionFS daemon implementation (TASK-322.05). This ticket only enables it by providing the schema.
- Re-running hardware captures. All raw probe data is already on disk under each persona's `raw/` — the migration reads from those, not from re-plugged hardware.

## Impact

- Bump `schemaVersion` on every existing persona (1 → 2). ADR-017 §"Schema versioning" says breaking schema changes are coordinated commits across the whole registry — this ticket is exactly that.
- Update `packages/device-testing/src/personas/types.ts` + every persona file.
- Update `documents/persona-capture-playbook.md` to instruct future captures to populate the richer schema.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `DevicePersona.usbDescriptor` extended to model the full device descriptor tree: device-level fields + configurations[] + interfaces[] + endpoints[] + stringDescriptors. `bNumConfigurations` exposed.
- [ ] #2 `DevicePersona.partitionLayout` reshaped to `{ luns: Array<{ lun, partitions: Array<...> }> }`; `echo-mini` updated to expose both LUNs distinctly
- [ ] #3 `DevicePersona.usbDescriptor.deviceSerial` type changed to `string | null`; `sony-nw-hd5` migrated from `''` to `null`
- [ ] #4 `schemaVersion` bumped from 1 to 2 on every persona in the registry; the bump is the breaking-migration signal per ADR-017
- [ ] #5 All 14 existing personas migrate cleanly: extract richer USB descriptor data from each persona's `raw/sysfs-usb.txt` + `raw/ioreg.txt` + `raw/udev.txt` where available; flag any persona that lacks the needed raw data and document a follow-up capture
- [ ] #6 `packages/device-testing/src/personas/types.ts` updated with full TSDoc on the new fields
- [ ] #7 `documents/persona-capture-playbook.md` updated to instruct future captures to populate the richer schema (which `cat /sys/...` commands surface which fields, etc.)
- [ ] #8 `bun run build --filter @podkit/device-testing` + `bun run typecheck --filter @podkit/device-testing` + existing tests pass; no behavioural regression
- [ ] #9 ADR-017 either updated in place (recommended — single source of truth) or supplemented with an addendum documenting the v2 schema
- [ ] #10 TASK-322.05 (FunctionFS daemon) becomes implementable against the new schema — cross-link this ticket from there
<!-- AC:END -->
