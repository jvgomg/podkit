#!/usr/bin/env python3
"""Build the vendored HashAB signer as a shared library for the checks; installs nothing."""
import os
from pathlib import Path
import platform
import subprocess

ROOT = Path(__file__).resolve().parent


def build(output=None):
    suffix = ".dylib" if platform.system() == "Darwin" else ".so"
    output = Path(output) if output else ROOT / "build" / ("libhashab" + suffix)
    output.parent.mkdir(parents=True, exist_ok=True)
    sources = sorted((ROOT.parent / "prebuild/vendor/hashab/src").glob("*.c"))
    link = "-dynamiclib" if platform.system() == "Darwin" else "-shared"
    subprocess.run([
        os.environ.get("CC", "cc"), "-std=c11", "-fwrapv", "-O2", "-fPIC",
        link, *map(str, sources), "-o", str(output),
    ], check=True)
    return output.resolve()


if __name__ == "__main__":
    print(build())
