# ADR-002: libgpod Binding Approach

## Status

**Proposed**

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

**Option D: Hybrid approach (Recommended)**

### Phase 1: ffi-napi Prototype
- Validate libgpod API usage
- Test with real iPod devices
- Identify edge cases and requirements

### Phase 2: N-API Implementation
- Port to node-addon-api
- Proper async operations
- Memory-safe GLib handling

### Rationale

1. **Risk reduction** - Prototype validates approach before C++ investment
2. **Learning curve** - Understand libgpod API in familiar language first
3. **Production quality** - N-API provides best performance and stability
4. **Cross-runtime** - N-API stable ABI works with both Node and Bun

## Implementation Plan

### Phase 1 Deliverables (ffi-napi)

```typescript
// Minimal viable bindings
interface LibgpodFFI {
  itdb_parse(mountpoint: string): Promise<Database>;
  itdb_write(db: Database): Promise<void>;
  itdb_free(db: Database): void;
  itdb_track_new(): Track;
  itdb_track_add(db: Database, track: Track, pos: number): void;
  itdb_cp_track_to_ipod(track: Track, filename: string): Promise<boolean>;
}
```

### Phase 2 Deliverables (N-API)

```cpp
// binding.gyp
{
  "targets": [{
    "target_name": "libgpod_node",
    "sources": ["src/binding.cc"],
    "include_dirs": [
      "<!@(pkg-config --cflags-only-I gpod-1.0 glib-2.0 | sed 's/-I//g')"
    ],
    "libraries": [
      "<!@(pkg-config --libs gpod-1.0 glib-2.0)"
    ]
  }]
}
```

## Consequences

### Positive

- Validated approach before major investment
- Production-quality native bindings
- Cross-platform and cross-runtime support

### Negative

- Longer total development time
- Must maintain ffi-napi code during prototype phase
- C++ expertise required for Phase 2

### Migration Path

1. Keep ffi-napi and N-API implementations behind same TypeScript interface
2. Feature flag to switch implementations
3. Deprecate ffi-napi once N-API is stable

## Related Decisions

- ADR-001: Runtime choice (Bun/Node) - N-API chosen for compatibility
- ADR-003: Transcoding backend - Independent of binding choice

## References

- [ffi-napi Documentation](https://github.com/node-ffi-napi/node-ffi-napi)
- [node-addon-api Documentation](https://github.com/nodejs/node-addon-api)
- [napi-rs Documentation](https://napi.rs/)
- [libgpod API Documentation](http://www.gtkpod.org/libgpod/docs/)
