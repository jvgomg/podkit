#!/usr/bin/env python3
"""Verify the HashAB signatures of a copied Locations.itdb/.cbk pair and iTunesCDB; read-only, prints JSON."""
import argparse
from contextlib import closing
import ctypes
import hashlib
import hmac
import json
from pathlib import Path
import platform
import sqlite3
import struct
import sys

ROOT = Path(__file__).resolve().parent
FIXED_RANDOM = b"ABCDEFGHIJKLMNOPQRSTUVW"
# HashAB exposes its 23 nonce bytes through this output permutation.
PERMUTATION = (
    21, 28, 6, 12, 7, 26, 5, 19, 8, 25, 3, 1, 45, 30, 16, 49,
    29, 20, 40, 39, 53, 0, 47, 27, 38, 11, 14, 2, 35, 23, 36, 34,
    18, 31, 32, 4, 41, 37, 33, 9, 24, 13, 50, 15, 17, 46, 51, 43,
    48, 42, 54, 10, 44, 52, 22,
)


def guid_bytes(value):
    value = value.removeprefix("0x").removeprefix("0X")
    if len(value) != 16:
        raise ValueError("Nano GUID must contain exactly 16 hexadecimal characters")
    try:
        return bytes.fromhex(value)
    except ValueError as exc:
        raise ValueError("Invalid hexadecimal Nano GUID") from exc


class HashAB:
    def __init__(self, path):
        self.lib = ctypes.CDLL(str(Path(path).resolve()))
        self.calculate = self.lib.calcHashAB
        self.calculate.argtypes = [ctypes.POINTER(ctypes.c_ubyte)] * 4
        self.calculate.restype = None

    def sign(self, sha1, guid, nonce=FIXED_RANDOM):
        if (len(sha1), len(guid), len(nonce)) != (20, 8, 23):
            raise ValueError("Expected SHA1=20, Nano GUID=8, nonce=23 bytes")
        array = ctypes.c_ubyte
        target = (array * 57)()
        self.calculate(target, (array * 20).from_buffer_copy(sha1),
                       (array * 8).from_buffer_copy(guid),
                       (array * 23).from_buffer_copy(nonce))
        result = bytes(target)
        if result[:2] != b"\x03\x00":
            raise ValueError("HashAB calculation failed")
        return result


def signature_nonce(signature):
    if len(signature) != 57 or signature[:2] != b"\x03\x00":
        raise ValueError("Unsupported HashAB signature header")
    nonce = bytearray(23)
    for index, source in enumerate(PERMUTATION):
        if source < 23:
            nonce[source] = signature[index + 2]
    return bytes(nonce)


def block_hashes(data):
    if not data or len(data) % 1024:
        raise ValueError("Expected non-empty SQLite data aligned to 1024 bytes")
    return b"".join(hashlib.sha1(data[i:i + 1024]).digest()
                    for i in range(0, len(data), 1024))


def make_cbk(data, guid, hasher, nonce=FIXED_RANDOM):
    blocks = block_hashes(data)
    master = hashlib.sha1(blocks).digest()
    return hasher.sign(master, guid, nonce) + master + blocks


def verify_cbk(data, cbk, guid, hasher):
    blocks = block_hashes(data)
    if len(cbk) != 77 + len(blocks):
        raise ValueError("CBK length does not match Locations.itdb")
    nonce = signature_nonce(cbk[:57])
    master = hashlib.sha1(blocks).digest()
    checks = {
        "blockHashes": hmac.compare_digest(cbk[77:], blocks),
        "masterHash": hmac.compare_digest(cbk[57:77], master),
        "hashAB": hmac.compare_digest(cbk[:57], hasher.sign(master, guid, nonce)),
    }
    return {"success": all(checks.values()), "checks": checks, "blocks": len(blocks) // 20}


def cdb_sha1(cdb):
    """SHA1 of an iTunesCDB as libgpod 0.8.3 computes it before signing."""
    if len(cdb) < 0xF4 or cdb[:4] != b"mhbd":
        raise ValueError("Expected an iTunesCDB with an mhbd header")
    data = bytearray(cdb)
    struct.pack_into("<H", data, 0x30, 3)  # hashing_scheme: HashAB
    # db_id, hash58, hash72 and hashAB are excluded; unk_0x32 is hashed.
    for offset, length in ((0x18, 8), (0x58, 20), (0x72, 46), (0xAB, 57)):
        data[offset:offset + length] = bytes(length)
    return hashlib.sha1(data).digest()


def verify_cdb(cdb, guid, hasher):
    signature = bytes(cdb[0xAB:0xE4])
    nonce = signature_nonce(signature)
    return {
        "cdbScheme": struct.unpack_from("<H", cdb, 0x30)[0],
        "cdbHashAB": hmac.compare_digest(signature, hasher.sign(cdb_sha1(cdb), guid, nonce)),
    }


def inspect_schema(data):
    # A private in-memory copy avoids opening or journalling the device database.
    with closing(sqlite3.connect(":memory:")) as db:
        db.deserialize(data)
        db.execute("PRAGMA query_only=ON")
        integrity = [row[0] for row in db.execute("PRAGMA integrity_check")]
        schema = [dict(zip(("type", "name", "table", "sql"), row)) for row in
                  db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master "
                             "ORDER BY type,name")]
    return {"integrity": integrity, "schema": schema}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("locations", type=Path, help="Path to copied Locations.itdb")
    parser.add_argument("--guid", required=True, help="16-hex-character FirewireGuid")
    parser.add_argument("--cbk", type=Path, help="Default: Locations.itdb.cbk")
    parser.add_argument("--cdb", type=Path, help="Also verify a copied iTunesCDB")
    suffix = ".dylib" if platform.system() == "Darwin" else ".so"
    parser.add_argument("--library", type=Path,
                        default=ROOT / "build" / ("libhashab" + suffix))
    args = parser.parse_args()
    try:
        data = args.locations.read_bytes()
        cbk = (args.cbk or Path(str(args.locations) + ".cbk")).read_bytes()
        guid, hasher = guid_bytes(args.guid), HashAB(args.library)
        result = verify_cbk(data, cbk, guid, hasher)
        result.update(inspect_schema(data))
        result["success"] = result["success"] and result["integrity"] == ["ok"]
        if args.cdb:
            result.update(verify_cdb(args.cdb.read_bytes(), guid, hasher))
            # libgpod signs with hashing scheme 3; the hash itself is computed with it.
            result["success"] = result["success"] and result["cdbScheme"] == 3 and result["cdbHashAB"]
        print(json.dumps(result, indent=2))
        return 0 if result["success"] else 1
    except (OSError, ValueError, sqlite3.Error, AttributeError) as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
