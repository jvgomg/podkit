---
title: "ADR-002: libgpod Binding Approach"
description: Decision to use N-API (node-addon-api) for libgpod bindings.
sidebar:
  order: 3
---

# ADR-002: libgpod Binding Approach

## Status

**Accepted** (2026-02-22)

## Context

podkit requires Node.js bindings for libgpod, a C library for iPod database management. Several approaches exist for creating native bindings in Node.js.

## Decision Drivers

- Development effort and complexity
- Runtime performance
- Memory safety
- Cross-platform build support
- Maintenance burden
- Compatibility with Bun (see [ADR-001](/developers/adr/adr-001-runtime))

## Options Considered

### Option A: ffi-napi

Use `ffi-napi` to call C functions directly without writing native code.

**Pros:**
- Fastest initial development
- No C/C++ code needed
- Dynamic loading

**Cons:**
- Complex struct handling (GLib types)
- Manual memory management
- Runtime overhead
- Limited async support

### Option B: node-addon-api (N-API)

Write a C++ addon using the stable Node.js N-API.

**Pros:**
- Full control over memory management
- Best performance
- Stable ABI across Node versions
- Proper GLib integration
- Works with Bun

**Cons:**
- Requires C++ development
- node-gyp build complexity

### Option C: Rust + napi-rs

Write a Rust wrapper for libgpod, exposed to Node via napi-rs.

**Pros:**
- Memory safety guarantees
- Modern build system (cargo)
- Works with Bun

**Cons:**
- Requires Rust knowledge
- FFI overhead at Rust-C boundary
- Additional toolchain dependency

## Decision

**Option B: N-API (node-addon-api) directly**

Skip the ffi-napi prototype phase and implement N-API bindings from the start.

### Rationale

1. **GLib complexity** - ffi-napi struggles with GLib types
2. **Small API surface** - libgpod has ~20 functions we need
3. **Existing references** - gtkpod and Strawberry source code show patterns
4. **Cross-runtime** - N-API stable ABI works with both Node and Bun
5. **Async support** - N-API AsyncWorker provides proper non-blocking I/O

## Architecture

Two-layer design separating native marshaling from TypeScript API:

### Layer 1: C++ Bindings (thin)

Minimal C++ that wraps libgpod and handles GLib memory (~300-500 lines total).

### Layer 2: TypeScript API (rich)

Clean async interface with full types and error handling:

```typescript
export class Database {
  static async open(mountpoint: string): Promise<Database>;
  async save(): Promise<void>;
  close(): void;

  readonly tracks: ReadonlyArray<Track>;
  readonly playlists: ReadonlyArray<Playlist>;

  addTrack(track: TrackInput): Track;
  removeTrack(track: Track): void;
}
```

## Consequences

### Positive

- Production-quality bindings from day one
- Proper async support via N-API AsyncWorker
- Clean TypeScript API with full type safety
- Cross-platform and cross-runtime support

### Negative

- Steeper initial learning curve (C++ required)
- node-gyp build complexity for contributors
- Must distribute prebuilt binaries for easy installation

## Related Decisions

- [ADR-001](/developers/adr/adr-001-runtime): Runtime choice - N-API chosen for compatibility
- [ADR-003](/developers/adr/adr-003-transcoding): Transcoding backend - Independent of binding choice

## References

- [node-addon-api Documentation](https://github.com/nodejs/node-addon-api)
- [libgpod API Documentation](http://www.gtkpod.org/libgpod/docs/)
