---
id: TASK-115
title: Implement BufferReader and BufferWriter binary primitives
status: To Do
assignee: []
created_date: '2026-03-12 10:53'
labels:
  - phase-1
  - binary
milestone: ipod-db Core (libgpod replacement)
dependencies:
  - TASK-114
references:
  - doc-003
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the core binary I/O primitives that all record parsers/writers depend on.

**BufferReader** — Stateful cursor over a Buffer:
- `readUInt32()`, `readInt32()`, `readUInt16()`, `readInt16()` — LE by default, BE when `reversed=true`
- `readUInt64()`, `readInt64()` — returns `bigint`
- `readTag()` — 4 ASCII bytes as string
- `readBytes(n)` — zero-copy `subarray()`
- `readUtf16le(byteLen)`, `readUtf16be(byteLen)` — string decode
- `offset` getter, `seek(pos)`, `skip(n)`
- Constructor takes `Buffer` and optional `reversed: boolean` for big-endian iPods

**BufferWriter** — Growable buffer with backpatching:
- Mirror of reader methods for writing
- `patchUInt32(offset, val)` — backpatch for header_len/total_len fixup (write placeholder, fill in later)
- `toBuffer()` — combine chunks into final Buffer
- Constructor takes optional `reversed: boolean`

**ParseError** — Error class with binary context:
- `offset: number` — byte position where error occurred
- `expected?: string`, `actual?: string` — for tag/size mismatches
- `recordPath?: string[]` — breadcrumb trail (e.g., `['mhbd', 'mhsd[0]', 'mhlt', 'mhit[42]']`)

**Design notes:**
- Use Node.js `Buffer` directly, zero external dependencies
- BufferWriter should pre-allocate in 1.5MB chunks (matching libgpod's WCONTENTS_STEPSIZE) and grow as needed
- All methods advance the cursor automatically
- Include bounds checking (throw ParseError if reading past end)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 BufferReader reads all integer types in both LE and BE modes
- [ ] #2 BufferWriter writes all integer types with correct endianness
- [ ] #3 patchUInt32 correctly overwrites previously written values
- [ ] #4 readBytes returns zero-copy subarray (shares underlying ArrayBuffer)
- [ ] #5 UTF-16LE and UTF-16BE string round-trip correctly
- [ ] #6 ParseError includes offset, expected/actual, and recordPath
- [ ] #7 Bounds checking throws ParseError on read/write past end
- [ ] #8 Unit tests cover all methods including edge cases (empty buffer, max values, zero-length strings)
<!-- AC:END -->
