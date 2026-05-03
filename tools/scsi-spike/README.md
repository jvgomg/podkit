# SCSI Inquiry Spike (P0)

Throwaway code validating that `koffi` can drive SCSI inquiry against an iPod
on macOS (IOKit SCSITaskUserClient) and Linux (SG_IO ioctl) end-to-end.

This directory will be removed at the end of P1. See backlog/docs/doc-031 for
the full spec and `FINDINGS.md` (written when the spike completes) for the
go/no-go recommendation that informs P1.

## Run

Both Node 24+ and Bun 1.3+ work — koffi prebuilds load under either runtime.

```
# Linux (no sudo if 91-podkit-ipod-scsi.rules is installed and user is in plugdev)
node --import tsx ./linux.ts /dev/sg3 out.xml
bun ./linux.ts /dev/sg3 out.xml

# macOS (no sudo, no entitlements)
node --import tsx ./macos.ts out.xml
bun ./macos.ts out.xml
```

If `/dev/sg3` permission denied, install the udev rule (see `91-podkit-ipod-scsi.rules`) then unplug/replug the device.

## Devices used

- nano 2G — macOS, USB inquiry fails (SCSI-only path validates the most)
- nano 4G — linka (Debian), USB inquiry works (byte parity comparison)

Captured XML for byte-comparison lives in `documents/sysinfo-captures/`.
