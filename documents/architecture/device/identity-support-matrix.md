# Device identity: USB/SCSI support matrix

Status: settled (m-18 research + m-22 Docker alignment). Last reviewed: 2026-07-08.

## 1. Map

This doc is the source of truth for **which devices can be identified by which
transport**, and therefore which onboarding lane each device falls into — on
the host and inside the Docker container. It answers three questions:

1. When does an iPod's identity resolve from the **mounted volume alone**
   (the path baseline — no USB, works in any container)?
2. When is the **one-time USB setup** needed, and for which generations does
   USB inquiry actually work?
3. Which generations need the **SCSI fallback** — and are therefore not
   settable-up inside a container today?

It does *not* own the identity data itself: the generation tables, checksum
types, and access tiers live in `@podkit/devices-ipod` (see §7). When this doc
and the tables disagree, the tables win — fix this doc.

## 2. The identity cascade

`assessIpodIdentity` (packages/podkit-core/src/device/ipod-identity.ts)
collects the on-disk and USB facts into one bag; `resolveIpodModel`
(@podkit/devices-ipod, resolve.ts) then resolves most-specific-first:

| # | Source | Read from | Requires |
|---|--------|-----------|----------|
| 1 | `modelNumStr` — SysInfoExtended, falling back to the classic SysInfo `ModelNumStr` line | `iPod_Control/Device/SysInfoExtended`, `iPod_Control/Device/SysInfo` | mounted volume only |
| 2 | Serial-number suffix table (`serialNumber`, last 3 chars) | SysInfoExtended | mounted volume only |
| 3 | USB product ID fingerprint | live USB descriptor | USB connection visible to libusb |
| 4 | FamilyID table | SysInfoExtended | mounted volume only |

(A separate `libgpodGeneration` fallback exists in the resolver but is only
exercised by the open-device path, not by `assessIpodIdentity`.)

Sources 1, 2 and 4 are the **path baseline**: when the on-disk files carry the
model, the device identifies from the volume alone. Only #3 needs live
hardware access.

## 3. Who writes the on-disk identity

| Era | Generations | On-disk identity out of the box |
|-----|-------------|--------------------------------|
| Pre mid-2006 | iPod 1G–4G, Photo, mini 1G–2G, nano 1G | **Yes** — firmware writes a populated `SysInfo` on format |
| Post mid-2006 | nano 2G+, video 5.5G+, classic, shuffle 2G+ | **No** — firmware creates an *empty* `SysInfo`; identity lives in firmware until something writes `SysInfoExtended` |

`SysInfoExtended` writers: **iTunes** (historically, after its own firmware
inquiry) and **podkit** — `podkit device add` during setup, or
`podkit doctor --repair sysinfo-extended` in place. Consequence: any iPod that
has ever been managed by iTunes or set up with podkit already sits in the path
baseline; only wiped/restored/never-set-up post-2006 devices need the one-time
setup.

## 4. Firmware inquiry transport support (the matrix)

Firmware inquiry reads `SysInfoExtended` out of the device firmware over one
of two transports. USB is preferred (richer payload from the nano 5G on); SCSI
is the fallback on USB *transport* error
(packages/ipod-firmware/src/inquiry/selection.ts).

| Model | USB inquiry | SCSI inquiry | Effective setup lane |
|-------|-------------|--------------|----------------------|
| iPod 1G–3G | no | no | Pre-2006: on-disk identity from firmware; no inquiry exists or is needed |
| iPod 4G / Photo | no | **yes** | SCSI (host only) — but pre-2006 on-disk identity usually present |
| iPod video 5G / 5.5G | **no (does not respond)** | **yes** | SCSI (host only) |
| iPod classic 6G / 7G | **yes** | yes | USB |
| iPod mini 1G–2G | no | **yes** | SCSI (host only) — pre-2006 on-disk identity usually present |
| iPod nano 1G–2G | **no (2G does not respond; 1G untested)** | **yes** | SCSI (host only) |
| iPod nano 3G | **yes** (first USB-capable) | untested | USB |
| iPod nano 4G–5G | **yes** | yes | USB |
| iPod nano 6G | yes (inquiry) | yes | Inquiry works but the generation is **read-only** (iTunesDB format podkit cannot write) |
| iPod nano 7G | yes (inquiry) | yes | Inquiry works but access is **none** (hashAB, not in libgpod's table) |
| iPod shuffle 1G–2G | no | **yes** | SCSI (host only) |
| iPod shuffle 3G–4G | yes | yes | Inquiry works but sync is **refused** (iTunes-auth iTunesSD; read-only tier) |
| iPod touch / iPhone / iPad | no | no | No disk mode at all — out of scope |

Transport runtime requirements:

- **USB**: libusb (the `usb` npm package) + the device's bus/devnum. In Docker:
  `--device /dev/bus/usb` (or `--privileged`).
- **SCSI**: macOS — IOKit SCSITaskUserClient via koffi; Linux — `SG_IO` ioctl on
  the matching `/dev/sg*` node via koffi. In Docker: **not supported today** —
  the `/dev/sg*` + cgroup-rule + security story is backlog (TASK-296).

## 5. What this means per environment

| Device state | Host (macOS/Linux) | Docker container |
|--------------|--------------------|------------------|
| Identity on disk (SysInfoExtended or populated SysInfo) | syncs — path only | syncs — bind the volume at `/ipod`, nothing else |
| Blank post-2006 device, USB-capable generation (nano 3G+, classic 6G/7G) | one-time `device add` over USB | one-time `device add` with `--device /dev/bus/usb`, then path-only forever |
| Blank post-2006 device, SCSI-only generation (video 5G/5.5G, nano 1G–2G, mini, 4G/Photo, shuffle 1G–2G) | one-time `device add` over SCSI | **cannot be set up in-container** — set it up once on a host (or let iTunes have touched it once, ever), then the container path lane works |
| Mass-storage player (Echo Mini, Rockbox, generic) | declared preset — no inquiry, no identity files | same: `[devices.<name>]` with `type` + `path`, or the ENV declaration (`PODKIT_DEVICE_*`) |

Sync refuses (typed `UNKNOWN_IPOD_MODEL`) rather than degrading to a "generic
iPod" when no source resolves a model — see
`documents/architecture/sync/error-handling.md` §6. A blank-but-identified
device gets `IPOD_NEEDS_INIT` instead (run `podkit device init`).

## 6. Conventions

- Never hand-copy generation rows into user docs — link the supported-devices
  page, which renders from the same tables.
- A change to `generations.ts` support tiers or `unsupported.ts` reasons must
  be reflected here in §4 if it moves a device between lanes.
- New transports (e.g. SCSI-in-container) update §4/§5 and
  `docs/getting-started/docker.md`'s onboarding section together.

## 7. References

- `documents/device-identification.md` — m-18 research journal (full sweep data,
  strategy comparison; the empirical basis for §4)
- `documents/test-devices.md` — real-hardware inventory with inquiry results
- `packages/devices-ipod/src/tables/generations.ts` — authoritative per-generation
  metadata (checksum type, access tier, capabilities)
- `packages/devices-ipod/src/tables/unsupported.ts` — unsupported USB PIDs + reasons
- `packages/podkit-core/src/device/ipod-identity.ts` — the cascade implementation
- `packages/ipod-firmware/src/inquiry/` — USB + SCSI transports, selection policy
- `adr/adr-020-ipod-identity-structured-fields.md`, `adr/adr-024-device-access-tiers.md`
- `backlog/docs/doc-052 - PRD-podkit-docker-alignment.md` — the Docker alignment PRD
  this matrix serves
