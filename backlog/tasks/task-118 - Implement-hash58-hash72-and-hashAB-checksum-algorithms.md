---
id: TASK-118
title: 'Implement hash58, hash72, and hashAB checksum algorithms'
status: To Do
assignee: []
created_date: '2026-03-12 10:54'
labels:
  - phase-2
  - hash
  - security
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-117
references:
  - doc-003
documentation:
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_hash58.c
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_hash72.c
  - tools/libgpod-macos/build/libgpod-0.8.3/src/itdb_hashAB.c
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement all three iPod database checksum algorithms, plus the device-to-algorithm selection logic.

**hash58 (HMAC-SHA1 with FireWire GUID key):**
1. Extract FireWire GUID (8 bytes) from SysInfo
2. Compute LCM of byte pairs, lookup in two fixed AES S-box-derived tables (tables from itdb_hash58.c lines 45-113)
3. SHA-1 hash of fixed 18-byte constant + 16-byte intermediate → 64-byte key
4. Zero out db_id (8 bytes), unk_0x32 (20 bytes), and hash58 (20 bytes) in the database buffer
5. HMAC-SHA1 of entire database buffer with the derived key
6. Write 20-byte hash at offset 0x58

Implementation: `crypto.createHmac('sha1', key)` and `crypto.createHash('sha1')`.

**hash72 (SHA-1 + AES-128-CBC):**
1. Read HashInfo file from `iPod_Control/Device/HashInfo` (54 bytes: "HASHv0" + UUID + random_bytes + IV)
2. Validate UUID matches device's FireWire GUID
3. Zero out db_id, hash58, and hash72 fields in database buffer
4. SHA-1 of entire database buffer (plain, not HMAC)
5. AES-128-CBC encrypt (SHA-1 + random_bytes) with fixed key and device IV
6. Write 46-byte signature at offset 0x72: [0x01, 0x00] + random_bytes[12] + encrypted[32]

Implementation: `crypto.createHash('sha1')` and `crypto.createCipheriv('aes-128-cbc', fixedKey, iv)`.
Fixed AES key: `[0x61, 0x8c, 0xa1, 0x0d, 0xc7, 0xf5, 0x7f, 0xd3, 0xb4, 0x72, 0x3e, 0x08, 0x15, 0x74, 0x63, 0xd7]`

**hashAB (external library wrapper):**
Same approach as libgpod — the actual algorithm is in a proprietary external binary:
1. SHA-1 of database buffer (zeroing db_id, hash58, hash72, hashAB fields)
2. Attempt to load `libhashab` at runtime (via N-API addon or FFI)
3. Call `calcHashAB(target[57], sha1[20], uuid[20], rnd_bytes[23])`
4. Write 57-byte signature at offset 0xAB
5. If library unavailable, throw descriptive error

**Hash selection logic (`hash/index.ts`):**
- Read device generation from SysInfo/model table
- Map to checksum type: NONE, HASH58, HASH72, or HASHAB
- Decision tree matches libgpod's `itdb_device_get_checksum_type()`:
  - No hash: 1st-4th gen, Photo, Mini, Shuffle, Nano 1-2, Video
  - hash58: Nano 3-4, Classic 1-3
  - hash72: Nano 5, Touch 1-3, iPhone 1-3
  - hashAB: Touch 4, iPhone 4, iPad 1, Nano 6
- SysInfoExtended DBVersion takes priority if available
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 hash58 produces correct output for known FireWire GUID + database pairs
- [ ] #2 hash72 reads HashInfo file and produces correct AES-encrypted signature
- [ ] #3 hash72 validates UUID match between HashInfo and device
- [ ] #4 hashAB wrapper attempts to load external library and calls calcHashAB if available
- [ ] #5 hashAB returns clear error message when library is unavailable
- [ ] #6 Hash selection logic correctly maps all device generations to hash types
- [ ] #7 SysInfoExtended DBVersion takes precedence over generation-based selection
- [ ] #8 All hash fields correctly zeroed before computation
- [ ] #9 Hash written at correct offset (0x58, 0x72, or 0xAB)
- [ ] #10 Unit tests with known test vectors for hash58 and hash72
<!-- AC:END -->
