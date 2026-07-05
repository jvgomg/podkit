---
title: "ADR-024: Device Support Is a Tri-State Access Tier With Orthogonal Verification Provenance"
description: Replace the binary IpodGeneration.supported flag with a three-state access tier (syncable / read-only / none) that gates behavior, plus an orthogonal verified axis (hardware / inferred) that gates nothing and documents confidence. Read-only devices are discovered, read, and archived; only writes are refused.
sidebar:
  order: 25
---

# ADR-024: Device Support Is a Tri-State Access Tier With Orthogonal Verification Provenance

## Status

**Accepted** (2026-07-05)

Extends the m-18 device-capability architecture of [ADR-014](/developers/adr/adr-014-device-capability-architecture) and the structured-identity fields of [ADR-020](/developers/adr/adr-020-ipod-identity-structured-fields). Supersedes the binary `IpodGeneration.supported` framing. Specified by **doc-056 (PRD: Device Access Tiers)**.

## Context

A user connected a **mounted** iPod shuffle (4th generation) and ran `podkit device archive`. podkit reported it as **"connected but not mounted"** — yet seconds later `podkit device -d "/Volumes/…" music` read all 89 tracks from it. Two commands disagreed about one physical, mounted device.

Investigation traced every symptom to a single modeling defect: **device support is a boolean** (`IpodGeneration.supported`), and its own doc comment defines it as "whether libgpod can read **and** write the iTunesDB." The domain has three states, not two, and the boolean collapses them:

- The shuffle 3g/4g are marked `supported: false` with reason *"requires iTunes authentication."* That is true only for **writing**. On real hardware they keep a full, libgpod-readable `iTunesDB` (metadata) **alongside** the `iTunesSD` (`bdhs` format) playback database the firmware actually plays from. Writing a valid `iTunesSD` needs the iTunes authentication hash libgpod cannot produce; **reading is entirely fine.** Collapsing "can't write" into "unsupported" discards the fact that podkit can read and archive these devices.
- Because the shuffle classifies USB-side as `unsupported`, discovery's reconciliation step never correlates its mounted block volume to the device (unsupported USB entries are never matched to blocks). Discovery reports "USB only," so `archive` (which auto-detects) produced the misleading mount error — while path-mode commands (`-d <path>`), which bypass discovery, read it fine.
- The user is then told "not mounted," or nudged toward `doctor` / `sync` operations that cannot succeed, instead of the real reason.

The same boolean muddies other generations: nano 6g ("format libgpod cannot write") and nano 7g / iOS ("not in table" / "no disk mode") are all `false`, but for materially different reasons — some readable, some not, some never even mounting.

## Decision drivers

- **Never silently degrade; be honest about what podkit can and can't do.** A readable device must not be reported as absent, unmounted, or flatly unsupported.
- **Reads are safe; writes are dangerous.** The gate must protect the destructive direction without forbidding the non-destructive one.
- **Model the domain faithfully.** Three states exist; encode three states. Avoid illegal states by construction.
- **Don't regress the common case.** Linux/Docker sync to normal iPods by path with no USB inquiry all the time; new gating must not break them.
- **The codebase should be a living, self-correcting support matrix.** What we've confirmed on real hardware vs inferred from libgpod tables must be recorded and cheaply upgradable.
- **Clean-breaking, no deprecation cycle** (minor bump), consistent with project convention.

## Decision

### 1. Two orthogonal axes replace `supported: boolean`

A generation's support becomes a record `{ access, verified, note? }`:

- **`access: 'syncable' | 'read-only' | 'none'`** — a **total order**: `none ⊂ read-only ⊂ syncable`. There is no writable-but-unreadable device (libgpod reads before it writes), which is exactly why a single tri-state enum — not two booleans — is the faithful model: the two-boolean shape admits an illegal `readable:false, writable:true` state the domain cannot produce. **`access` gates runtime behavior.**
- **`verified: 'hardware' | 'inferred'`** — whether the claim is confirmed on a real device or inferred from libgpod tables / reverse-engineering. **`verified` gates nothing.** It feeds documentation, `device info` display, and confidence badges only. It exists so a contributor who plugs in a real device flips `inferred → hardware` (and corrects `access` if reality disagrees) in **one place**.

Keeping the two axes orthogonal is deliberate: the safety gate stays a clean tri-state, while the epistemics ("have we actually touched one?") ride alongside without ever branching logic.

### 2. Generation assignments

| Generation | `access` | `verified` |
|---|---|---|
| Classic / nano (1g–5g) / mini / video — existing syncable | `syncable` | `hardware` where tested, else `inferred` |
| **Shuffle 3g / 4g** | **`read-only`** | `hardware` |
| **nano 6g** | **`read-only`** | `inferred` — write known-unsupported; read never tested |
| nano 7g, iPod touch / iPhone / iPad, not-in-libgpod-table | `none` | `inferred` (or `hardware` where confirmed) |

nano 6g is `read-only`, not `none`, on purpose: its write is confidently unsupported but its read is merely **untested**, and a read is non-destructive. Permitting the read attempt lets reality supply the missing evidence (success or a clean failure) rather than forbidding a safe operation on a guess.

### 3. Discovery classifies read-only as a real iPod

A `read-only` generation classifies as **`kind: 'ipod'`** — it *is* a mounted iPod — so the existing block-correlation path maps its volume automatically. `kind: 'unsupported'` shrinks to mean **`access: 'none'`** (iOS, nano 7g — devices with no mountable volume to orphan). **No new correlation logic is added**; the "USB only" bug was upstream misclassification, and fixing the classification fixes the mapping.

### 4. Access is enforced once, at device resolution

Device resolution gains a **`requiredAccess: 'read' | 'write'`** parameter. Each command declares its intent; the resolver throws a typed **`DEVICE_READ_ONLY`** (carrying the generation-specific reason) before the command body runs — a single choke point, impossible to forget. This directly answers the class of bug that produced the report: the scattered "each command re-checks for itself" approach is what let `archive` fail with the wrong message.

- **Read-ops** (`music`, `video`, `info`, `scan`, `archive` incl. `--dump-only`) run on `read-only`.
- **Write-ops** (`sync`, `device init`, `device add`) refuse on `read-only` / `none`.
- **`doctor`** computes intent **per-invocation**: bare `doctor` is read (a read-only shuffle can still be diagnosed); `doctor --repair` is write (refused).

### 5. Fail open on unknown access, with a write-boundary backstop

When access **cannot be determined** — path-mode on a platform without USB inquiry (Linux/Docker) — the gate **fails open** (treats access as `syncable`). Failing closed would break every legitimate no-USB sync to punish a rare case. To catch the rare miss, a **thin backstop immediately before `itdb_write`** refuses when the resolved generation's access is not `syncable`, converting a silent bad write into a clean late error. The resolver gate is primary; the backstop is the net under the fail-open hole.

Access in path-mode is derived from the **USB product ID** (available via path→USB correlation), **not** from SysInfo — so a shuffle is correctly identified as read-only even when SysInfo is absent.

### 6. `sync` is single-device; read-only is a hard error

`sync` resolves exactly one device (there is no multi-device sweep). A `read-only` target produces a **hard `DEVICE_READ_ONLY`** — the run fails with a clear reason. No silent skip, consistent with "never silently degrade."

### 7. One support matrix, three surfaces

The generation table exports a serializable matrix (`getSupportMatrix()`) consumed by the public docs compatibility component, the internal `documents/formats/generations.md` reference, and the CLI `device info` output. A test pins the docs matrix to the table so they cannot drift. This is the mechanism that turns the `verified` axis into a genuinely living record.

## Consequences

**Positive**

- The reported bug is fixed at its root: a mounted read-only iPod is discovered, mapped to its volume, readable, and archivable; only writes are refused, with an honest reason.
- Illegal states are unrepresentable; the gate logic is a small pure truth table, exhaustively testable without hardware.
- The codebase records not just *what* is supported but *how well we know it*, and makes hardware verification a one-line upgrade.
- No regression for no-USB platforms (fail-open), with a safety net for the rare misidentification.

**Negative / costs**

- A clean break of `IpodGeneration.supported` (minor bump); all readers must migrate to `access`.
- `verified: 'inferred'` entries (notably nano 6g) are explicit admissions of untested behavior — correct, but they surface uncertainty that the boolean hid.
- Every device command must now declare its access intent at the resolution seam.

## Alternatives considered

- **Two booleans (`readable` / `writable`).** Rejected: admits the illegal `readable:false, writable:true` state; the domain is a total order, so a tri-state enum is the faithful encoding.
- **Per-command capability checks (no central gate).** Rejected: this scattering is precisely what produced the `archive` "not mounted" bug; a resolver-level gate makes the check impossible to forget.
- **Fail closed on unknown access.** Rejected: breaks legitimate Linux/Docker path-mode syncs to normal iPods to catch a rare edge; fail-open + write backstop covers the edge without the regression.
- **Runtime `iTunesDB` ↔ `iTunesSD` read-trust validation.** Deferred out of scope: reads use `iTunesDB` (the only artifact with usable metadata), which is sufficient; cross-validation adds surface without a demonstrated need.
- **A `bdhs` parser.** Out of scope: podkit reads `iTunesDB`, not `iTunesSD`; the `bdhs` format is *documented* (see `documents/formats/itunessd-bdhs.md`), not parsed.

## References

- doc-056 — PRD: Device Access Tiers (specification)
- [ADR-014](/developers/adr/adr-014-device-capability-architecture) — Device Capability Architecture (m-18)
- [ADR-020](/developers/adr/adr-020-ipod-identity-structured-fields) — iPod Identity Structured Fields
- `documents/formats/itunessd-bdhs.md` — the `bdhs` iTunesSD format reference seeded by this investigation
