# HashAB source provenance

Source: https://github.com/dstaley/hashab
Commit: f80d46432204c6238cad7d8ca3b3dd52ea66836b
License: The Unlicense (see LICENSE)

`src/*.c`, `src/*.h`, `LICENSE` and `test-data.json` are copied unmodified
from that commit. The prebuilt `libhashab32.so` and the WASM/Zig build files
of the upstream repository are not included. Upstream compiles with
`-fwrapv`.

`calcHashAB` signs with the eight-byte FireWire GUID of an iPod nano; it is
not a signer for iOS device identifiers.
