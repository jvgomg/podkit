---
id: doc-056
title: >-
  PRD: Device Access Tiers — Read-Only Support, Provenance & iPod Database
  Format Docs
type: specification
created_date: '2026-07-05 14:11'
tags:
  - prd
  - device-capability
  - read-only
  - discovery
  - shuffle
  - docs
  - formats
  - m-18
---
## Problem Statement

A user connected a mounted iPod shuffle (4th generation) and ran `podkit device archive`. podkit reported the device as **"connected but not mounted"** — even though it was mounted, and even though `podkit device -d "/Volumes/…" music` could read all 89 tracks from it seconds later. Two commands disagreed about the same physical, mounted device.

Investigation revealed this is not one bug but a single design flaw with several symptoms:

1. **podkit's device support is a single boolean** (`IpodGeneration.supported`). Its own doc comment says it means "can read **and** write the iTunesDB," but it is used as an all-or-nothing gate. The domain has three states, not two. The shuffle 3g/4g are marked `supported: false` ("requires iTunes authentication") — which is true only for **writing**. They are perfectly **readable**: they keep a full `iTunesDB` (metadata) alongside the `iTunesSD` (`bdhs`) playback database the hardware actually plays from. Collapsing "can't write" into "unsupported, full stop" throws away the fact that podkit can read and archive these devices.

2. **Auto-detection ("discovery") does not map the mounted volume to the device.** Because the shuffle classifies USB-side as `unsupported`, the reconciliation step never correlates its mounted block volume (unsupported USB entries are never matched to blocks). Discovery reports the device as "USB only," which is why `archive` (which auto-detects) produced a misleading mount error, while path-mode commands (`-d <path>`), which bypass discovery, read it fine.

3. **Error messages are dishonest.** A readable-but-unwritable device is told "not mounted" or nudged toward `doctor`/`sync` operations that cannot succeed, instead of being told the real reason ("this shuffle's playback DB needs iTunes authentication; podkit can read and archive it but cannot sync to it").

4. **The `bdhs` iTunesSD format is undocumented and unparsed**, and more broadly podkit has **no home for knowledge about how iPod models and their on-disk database formats work**. Format knowledge lives implicitly in the `ipod-db` parser code (iTunesDB + ArtworkDB only) and in scattered generation-table comments. There is no place that records "which generation uses which database files, which checksum, and how confident we are — verified on real hardware vs inferred from libgpod tables."

## Solution

Replace the binary `supported` flag with a **tri-state access tier plus an orthogonal verification-provenance axis**, propagate it through discovery and device resolution so read-only devices are handled honestly, and stand up a **growing, tiered documentation corpus** about iPod database formats — seeded with the `bdhs` iTunesSD format reverse-engineered while diagnosing this bug.

**Capability model.** A generation's support becomes `{ access, verified, note }`:
- `access: 'syncable' | 'read-only' | 'none'` — a total order (`none ⊂ read-only ⊂ syncable`; there is no writable-but-unreadable device). **This gates behavior.**
- `verified: 'hardware' | 'inferred'` — whether the claim is confirmed on a real device or inferred from libgpod tables/docs. **This gates nothing** — it drives documentation, `device info` display, and confidence badges. It exists so the codebase is a living support matrix that contributors upgrade (`inferred → hardware`) as real hardware confirms behavior.
- Shuffle 3g/4g → `{ access: 'read-only', verified: 'hardware' }`. nano 6g → `{ access: 'read-only', verified: 'inferred' }` (write known-unsupported; read never tested — read is non-destructive, so we permit the attempt and let reality supply the evidence, rather than forbid a safe read on a guess). iOS devices, nano 7g → `{ access: 'none', verified: 'inferred' }`.

**Discovery.** A `read-only` iPod classifies as `kind: 'ipod'` (it *is* a mounted iPod), so the existing block-correlation path maps its volume automatically — fixing the "USB only" orphaning. `kind: 'unsupported'` shrinks to mean `access: 'none'` (iOS, nano 7g — devices with no mountable volume).

**Enforcement.** Device resolution gains a `requiredAccess: 'read' | 'write'` parameter. Each command declares its intent; the resolver throws a typed `DEVICE_READ_ONLY` before the command body runs — one gate, impossible to forget. Read-ops (`music`, `video`, `info`, `scan`, `archive`) run on read-only devices; write-ops (`sync`, `device init`, `device add`) refuse with the real reason. `doctor` computes intent **per-invocation**: bare `doctor` is read (a read-only shuffle can still be diagnosed), `doctor --repair` is write (refused). When access **cannot be determined** (path-mode on a platform without USB inquiry — Linux/Docker), the gate **fails open** (defaults to `syncable`), because refusing writes there would break the common legitimate case; a **thin backstop at the libgpod write boundary** catches the rare miss so a write to a genuinely unwritable device fails cleanly instead of silently.

**Sync UX.** `sync` targets exactly one device (confirmed — no multi-device sweep exists). A read-only target is a **hard `DEVICE_READ_ONLY` error**; the run fails with a clear reason. No silent skip.

**Documentation (tiered, one spine).** The `GenerationSupport` table exports a serializable support matrix consumed by three surfaces so they cannot drift:
- **Public `docs/`** (`docs/devices/supported-devices.mdx`): the `DeviceCompatibilityTable` component renders a Sync column (Full / Read-only / Unsupported) plus a Confidence badge (Hardware-verified / Inferred, mapping to `verified`). "Unsupported iPods" splits into "Read-only iPods" (shuffle 3g/4g) and true "Unsupported iPods." The "Device Not Mounting" troubleshooting section gains the shuffle read-only story.
- **Contributor `documents/formats/`** (new sibling to `architecture/` and `principles/`): one doc per on-disk format — `itunessd-bdhs.md` (seeded now), with `itunesdb.md` / `artworkdb.md` / `checksums.md` backfilled — plus `generations.md`, the per-generation×format matrix test-pinned to the code table.
- **CLI**: `device info` shows access + confidence ("read-only, hardware-verified").

## User Stories

1. As a user with a mounted iPod shuffle 4g, I want `podkit device archive` to recognize it and archive it, so that I can back up its library even though podkit can't sync to it.
2. As a user with a read-only device, I want `podkit device music`/`video`/`info` to list its contents, so that I can inspect what's on it.
3. As a user who runs `podkit sync` against a read-only device, I want a clear, immediate error explaining exactly why it can't be synced (playback DB needs iTunes authentication), so that I'm not misled into thinking it worked or that the device is broken.
4. As a user, I never want to see "connected but not mounted" for a device that is, in fact, mounted, so that I trust podkit's device reporting.
5. As a user running `podkit device scan`, I want a mounted read-only iPod to appear as a mounted iPod with its volume path, not as an orphaned "USB only" entry, so that I can see and target it.
6. As a user, I want `podkit device info` to tell me whether a device is fully syncable, read-only, or unsupported, and how confident podkit is (verified on hardware vs inferred), so that I understand what I can and can't do with it.
7. As a user with a read-only shuffle, I want `podkit doctor` to still diagnose it, so that I can inspect its health even though I can't repair or sync it.
8. As a user, I want `podkit doctor --repair` to refuse cleanly on a read-only device rather than attempt a repair that can't succeed, so that I don't corrupt or waste time on it.
9. As a user on Linux or Docker (no USB inquiry), I want my normal writable iPod syncs to keep working exactly as before, so that the new gating doesn't regress the common case.
10. As a user who accidentally targets an unwritable device on a platform where podkit couldn't identify it, I want the write to fail cleanly at the last moment rather than silently produce a device that won't play the tracks, so that I'm not left with a broken-looking iPod.
11. As a user browsing the docs, I want the supported-devices page to show read-only devices as a distinct category from unsupported ones, so that I know a shuffle is archivable even if not syncable.
12. As a user, I want the supported-devices matrix to show a confidence level per device, so that I know which support claims are hardware-verified and which are inferred.
13. As a contributor who has just tested a real nano 6g, I want to flip its support from `inferred` to `hardware` (and correct its access if needed) in one place, so that the CLI, public docs, and internal reference all update together.
14. As a contributor investigating the shuffle, I want a written reference for the `bdhs` iTunesSD format (header, track records, path layout), so that I don't have to re-reverse-engineer it.
15. As a contributor, I want a `documents/formats/` corpus that grows one format at a time, with per-field provenance (offset confirmed against a fixture vs inferred), so that format knowledge accumulates and stays honest.
16. As a maintainer, I want the public compatibility table, the internal generations matrix, and the CLI output all fed from one exported support matrix, so that they cannot disagree.
17. As a maintainer, I want a test that fails if the docs matrix drifts from the code table, so that documentation stays correct without manual vigilance.
18. As a developer, I want the access decision (`access` × intent, including fail-open) expressed as a pure, isolated function, so that its truth table is exhaustively testable without a device.
19. As a developer, I want a discovery regression test that reproduces the original bug (mounted read-only shuffle → correlated `kind: 'ipod'`, not orphaned "USB only"), so that this class of bug can't silently return.
20. As a privacy-conscious contributor, I want the `bdhs` test fixture to be anonymized/synthetic, not a real user's device dump, so that no personal library data is committed to the repo.

## Implementation Decisions

**Capability model (`@podkit/devices-ipod`)**
- Replace `IpodGeneration.supported: boolean` with a `GenerationSupport` record: `{ access: 'syncable' | 'read-only' | 'none'; verified: 'hardware' | 'inferred'; note?: string }`. This is a clean break (minor version bump), not a deprecation cycle.
- `access` is a total order and gates runtime behavior; `verified` gates nothing and is provenance/documentation only.
- Pure functions: `resolveGenerationSupport(generation) → GenerationSupport` and `getSupportMatrix() → SupportMatrixRow[]` (serializable; the single source consumed by docs component, internal matrix doc, and CLI).
- Generation assignments: shuffle_3g/4g → `read-only`/`hardware`; nano_6g → `read-only`/`inferred`; nano_7g, iOS (touch/iphone/ipad), and not-in-libgpod-table generations → `none`/`inferred` (or `hardware` where already confirmed). Existing syncable generations → `syncable`, `verified` set to `hardware` where tested, else `inferred`.
- `ReadinessUnsupportedReason` / note strings updated so read-only devices carry a read-only-specific explanation distinct from "unsupported."

**Discovery (`@podkit/core` device discovery)**
- `classifyAsIpod` and `reconcileDiscoveredDevices`: a `read-only` generation classifies as `kind: 'ipod'` so the existing block-correlation path maps its mounted volume. `kind: 'unsupported'` is reserved for `access: 'none'`.
- No new correlation logic is introduced — the fix is upstream misclassification. The existing serial/disk-identifier/block-only matching is unchanged.

**Access gate (`@podkit/core` device resolution)**
- `resolveDevice` / `resolveDevicePath` gain `requiredAccess: 'read' | 'write'`.
- Pure `assertAccess(support, requiredAccess)` encodes the truth table: `write` on `read-only`/`none` → throw `DEVICE_READ_ONLY`; `read` on `none` → throw (no readable DB); everything else passes. Unknown/undeterminable access defaults to `syncable` (fail-open).
- New typed error code `DEVICE_READ_ONLY` with a message carrying the generation-specific reason.
- Path-mode derives access from the USB PID via existing path→USB correlation when available; absent correlation, fail-open.

**Command intent wiring (`podkit-cli`)**
- Each device command declares intent when resolving: read for `music`, `video`, `info`, `scan`, `archive` (including `--dump-only`); write for `sync`, `device init`, `device add`.
- `doctor` computes `requiredAccess` per-invocation from flags: `--repair` → write, otherwise read.

**libgpod write backstop (`@podkit/libgpod-node` or the core write boundary)**
- A thin guard consulted immediately before `itdb_write` that refuses when the resolved generation's access is not `syncable`. The fail-open safety net; not the primary gate.

**Documentation spine**
- `documents/formats/` created (README with section template + corpus map; `itunessd-bdhs.md` seeded from this investigation; `generations.md` matrix).
- `generations.md` and the public `DeviceCompatibilityTable` are both driven by `getSupportMatrix()`; `generations.md` is test-pinned to the table.
- `docs/devices/supported-devices.mdx`: Sync column + Confidence badge; "Read-only iPods" subsection; "Device Not Mounting" troubleshooting addition. Ships via the `docs-live` branch flow (cherry-pick noted).
- Per-field provenance convention inside format docs: each offset/field marked confirmed-against-fixture vs inferred.
- `bdhs` fixture is anonymized/synthetic; a real user's `iTunesSD` is never committed.

**Explicitly not built**
- No `bdhs` parser and no runtime read-trust check (iTunesDB ↔ iTunesSD cross-validation). Reads use `iTunesDB`, which is the only artifact with usable metadata and is sufficient for read commands.

## Testing Decisions

Good tests here assert **external behavior**, not implementation shape: given a generation/support record and an intent, what does the gate decide; given a set of block + USB inputs, what does discovery emit; does the docs matrix equal the code table. None of these need a real device.

Coverage mandated (all four modules + regressions):
- **`GenerationSupport` model + `getSupportMatrix()`** — unit tests over the table; assert each notable generation's `{ access, verified }`; assert the exported matrix shape. Pin the matrix so docs can't drift (test-pins-contract).
- **Access gate (`assertAccess`)** — unit tests over the full `access × intent` truth table, including `none`+read, `read-only`+write, `read-only`+read, and unknown/fail-open. Prior art: existing pure-decision tests in the device/readiness modules.
- **Discovery reclassification** — extend the existing `reconcileDiscoveredDevices` unit tests. The keystone **regression** reproduces the original bug: a mounted read-only shuffle (USB `read-only` + mounted block) reconciles to a single correlated `kind: 'ipod'` record with its mount path, **not** an orphaned "USB only" entry; an `access: 'none'` device stays USB-only `unsupported`. Prior art: current discovery reconcile test suite.
- **libgpod write backstop** — unit test: a write attempt against a non-`syncable` generation throws before `itdb_write`.
- **e2e pair** — `archive` succeeds against a read-only device (read-op passes the gate); `sync` hard-errors with `DEVICE_READ_ONLY`. Prior art: existing device-command e2e tests.
- **Docs drift test** — `documents/formats/generations.md` matches `getSupportMatrix()`.

## Out of Scope

- Parsing or writing the `bdhs` iTunesSD format (documentation only).
- Any attempt to actually sync to a shuffle 3g/4g (would require reproducing iTunes' authentication — a separate, much larger investigation, if ever).
- Runtime `iTunesDB` ↔ `iTunesSD` divergence/read-trust validation (user decided against it).
- Multi-device sync behavior (does not exist; `sync` is single-device).
- Backfilling `itunesdb.md` / `artworkdb.md` / `checksums.md` in this pass (seed `itunessd-bdhs.md` now; backfill later — the others are preserved in working parser code).
- Verifying nano 6g on real hardware (its `verified: 'inferred'` status is precisely the placeholder that invites this later).
- Graduating the internal formats corpus into the public docs site beyond the supported-devices matrix update.

## Further Notes

- The `bdhs` structural map recovered while diagnosing the reported bug (header magic `bdhs`, 64-byte header, track count matching `iTunesDB`, `hths` section, ~372-byte `rths` records each holding a `/iPod_Control/Music/FXX/XXXX.mp3` path plus playback flags, tail order-arrays) is the seed content for `itunessd-bdhs.md` and one of the few public references for the 3g/4g shuffle format. Capture it before it is lost.
- The `verified` axis is deliberately orthogonal to `access` so the safety gate stays a clean tri-state while epistemics ("have we actually touched one?") ride alongside without ever branching logic. This is the mechanism that makes the codebase a self-correcting support matrix.
- This work sits under the m-18 device-capability architecture (ADR-014). An accompanying ADR should record the tri-state + provenance decision, the discovery reclassification, the resolver gate + fail-open + write backstop, and the single-device hard-error, superseding the binary `supported` framing.
- The original report also surfaced that path-mode `device info` shows a correct model ("iPod shuffle (4th Generation)") but "Unknown Generation" capabilities when SysInfo is absent; access resolution should key off the USB PID (which is available) rather than SysInfo, so read-only is correctly asserted in path-mode.
