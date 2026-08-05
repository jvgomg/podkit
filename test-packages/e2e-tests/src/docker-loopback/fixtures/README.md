# docker-loopback fixtures

## `sysinfo-extended.xml`

Authoritative on-disk identity (SysInfoExtended) for the trust-disk verification
test. Copied verbatim from the **iPod nano 3rd generation (8GB Black)** persona:

    test-packages/device-testing/src/personas/ipod-nano-3g-black/raw/sysinfo-extended.xml

Checked in here (rather than imported from `@podkit/device-testing`) to keep the
docker-loopback surface self-contained — it must not pull the VM harness's Lima
runners into an e2e test that only needs a block of XML. If the persona capture
is re-sourced, refresh this copy.

The test seeds this file at `iPod_Control/Device/SysInfoExtended` on a loopback
FAT to represent an iPod carrying valid on-disk identity (the `--no-verify`
"trust-disk" tier trusts it and proceeds without a USB firmware inquiry).
