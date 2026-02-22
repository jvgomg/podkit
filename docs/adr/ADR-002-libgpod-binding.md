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
- Compatibility with Bun (see ADR-001)

## Options Considered

### Option A: ffi-napi

Use `ffi-napi` to call C functions directly without writing native code.

**Pros:**
- Fastest initial development
- No C/C++ code needed
- No compilation step for binding code
- Dynamic loading

**Cons:**
- Complex struct handling (GLib types)
- Manual memory management
- Runtime overhead
- Fragile with complex APIs
- Limited async support

**Complexity:** Low initial, High ongoing

**Example:**
```typescript
import ffi from 'ffi-napi';

const libgpod = ffi.Library('libgpod', {
  'itdb_parse': ['pointer', ['string', 'pointer']],
  'itdb_write': ['bool', ['pointer', 'pointer']],
});
```

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
- Platform-specific compilation

**Complexity:** Medium

**Example:**
```cpp
#include <napi.h>
#include <gpod/itdb.h>

Napi::Value Parse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string mountpoint = info[0].As<Napi::String>();

    GError* error = nullptr;
    Itdb_iTunesDB* db = itdb_parse(mountpoint.c_str(), &error);

    if (error) {
        Napi::Error::New(env, error->message).ThrowAsJavaScriptException();
        g_error_free(error);
        return env.Null();
    }

    // Wrap and return
}
```

### Option C: Rust + napi-rs

Write a Rust wrapper for libgpod, exposed to Node via napi-rs.

**Pros:**
- Memory safety guarantees
- Modern build system (cargo)
- Cross-compilation support
- Works with Bun

**Cons:**
- Requires Rust knowledge
- FFI overhead at Rust-C boundary
- Additional toolchain dependency
- Rust bindings for libgpod may not exist

**Complexity:** Medium-High

**Example:**
```rust
use napi_derive::napi;

#[napi]
pub fn parse(mountpoint: String) -> napi::Result<Database> {
    unsafe {
        let mut error: *mut GError = std::ptr::null_mut();
        let db = itdb_parse(mountpoint.as_ptr(), &mut error);
        // Handle result
    }
}
```

### Option D: Hybrid (ffi-napi prototype, N-API production)

Start with ffi-napi for rapid prototyping, migrate to N-API for production.

**Pros:**
- Fast initial validation
- Production-quality final result
- Learn API before investing in C++

**Cons:**
- Double the development effort
- Two codebases during transition

## Decision

**Option B: N-API (node-addon-api) directly**

Skip the ffi-napi prototype phase and implement N-API bindings from the start.

### Rationale

1. **GLib complexity** - ffi-napi struggles with GLib types (GList, GError, opaque structs); we'd fight the tooling instead of learning libgpod
2. **Small API surface** - libgpod has ~20 functions we need; not enough to justify throwaway prototype code
3. **Existing references** - gtkpod and Strawberry source code show libgpod usage patterns
4. **Cross-runtime** - N-API stable ABI works with both Node and Bun
5. **Async support** - N-API AsyncWorker provides proper non-blocking I/O

## Architecture

Two-layer design separating native marshaling from TypeScript API:

### Layer 1: C++ Bindings (thin)

Minimal C++ that wraps libgpod and handles GLib memory:

```cpp
// src/native/binding.cc - ~300-500 lines total
class DatabaseWrapper : public Napi::ObjectWrap<DatabaseWrapper> {
    Itdb_iTunesDB* db_;
    // Constructor, destructor handle GLib memory
};

// Async worker for I/O operations
class ParseWorker : public Napi::AsyncWorker {
    void Execute() override { db_ = itdb_parse(path_.c_str(), &error_); }
    void OnOK() override { /* wrap and resolve */ }
};
```

### Layer 2: TypeScript API (rich)

Clean async interface with full types and error handling:

```typescript
// src/index.ts
export class Database {
  static async open(mountpoint: string): Promise<Database>;
  async save(): Promise<void>;
  close(): void;

  readonly tracks: ReadonlyArray<Track>;
  readonly playlists: ReadonlyArray<Playlist>;

  addTrack(track: TrackInput): Track;
  removeTrack(track: Track): void;
  copyTrackToDevice(track: Track, sourcePath: string): Promise<void>;
}

export class LibgpodError extends Error {
  readonly code: ErrorCode;
  readonly operation: string;
}
```

### Build Configuration

```javascript
// binding.gyp
{
  "targets": [{
    "target_name": "libgpod_native",
    "sources": ["src/native/binding.cc"],
    "include_dirs": [
      "<!@(pkg-config --cflags-only-I gpod-1.0 glib-2.0 | sed 's/-I//g')"
    ],
    "libraries": ["<!@(pkg-config --libs gpod-1.0 glib-2.0)"]
  }]
}
```

## Consequences

### Positive

- Production-quality bindings from day one
- Proper async support via N-API AsyncWorker
- Clean TypeScript API with full type safety
- No throwaway prototype code
- Cross-platform and cross-runtime support

### Negative

- Steeper initial learning curve (C++ required)
- node-gyp build complexity for contributors
- Must distribute prebuilt binaries for easy installation

### Mitigations

- Keep C++ layer minimal (~300-500 lines) - just marshaling
- Use prebuildify for binary distribution
- Document build setup clearly in DEVELOPMENT.md

## Related Decisions

- ADR-001: Runtime choice (Bun/Node) - N-API chosen for compatibility
- ADR-003: Transcoding backend - Independent of binding choice

## References

- [ffi-napi Documentation](https://github.com/node-ffi-napi/node-ffi-napi)
- [node-addon-api Documentation](https://github.com/nodejs/node-addon-api)
- [napi-rs Documentation](https://napi.rs/)
- [libgpod API Documentation](http://www.gtkpod.org/libgpod/docs/)
