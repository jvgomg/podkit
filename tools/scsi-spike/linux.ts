/**
 * Linux SG_IO SCSI VPD inquiry spike via koffi.
 *
 * Reads VPD page 0xC0 (subpage index) from an iPod's SCSI generic device,
 * then reads each subpage and concatenates the data fields to reconstruct
 * the SysInfoExtended XML.
 *
 * Algorithm matches libgpod's tools/ipod-scsi.c:read_sysinfo_extended,
 * but bypasses sgutils — talks to SG_IO directly via ioctl.
 *
 * Usage: sudo node --import tsx ./linux.ts /dev/sg3 [out.xml]
 */
import * as fs from 'node:fs';
import koffi from 'koffi';

// ── ioctl SG_IO ─────────────────────────────────────────────────────────────
//
// SG_IO = _IOWR('S', 0x85, struct sg_io_hdr) = 0x2285
const SG_IO = 0x2285;
const SG_DXFER_FROM_DEV = -3;
const SG_INTERFACE_ID = 'S'.charCodeAt(0); // 0x53

// koffi struct mirroring <scsi/sg.h> sg_io_hdr_t (Linux x86_64).
// Registration is a side effect — `'sg_io_hdr'` is referenced by name in the ioctl proto.
koffi.struct('sg_io_hdr', {
  interface_id: 'int',
  dxfer_direction: 'int',
  cmd_len: 'uint8',
  mx_sb_len: 'uint8',
  iovec_count: 'uint16',
  dxfer_len: 'uint32',
  dxferp: 'uint8 *',
  cmdp: 'uint8 *',
  sbp: 'uint8 *',
  timeout: 'uint32',
  flags: 'uint32',
  pack_id: 'int32',
  usr_ptr: 'uint8 *',
  status: 'uint8',
  masked_status: 'uint8',
  msg_status: 'uint8',
  sb_len_wr: 'uint8',
  host_status: 'uint16',
  driver_status: 'uint16',
  resid: 'int32',
  duration: 'uint32',
  info: 'uint32',
});

const libc = koffi.load('libc.so.6');
const ioctl = libc.func('int ioctl(int fd, unsigned long request, _Inout_ sg_io_hdr *argp)');
const __errno_location = libc.func('int *__errno_location()');

function errno(): number {
  const ptr = __errno_location();
  // koffi returns an opaque pointer for `int *`. Decode it as a length-1 int32 array.
  return koffi.decode(ptr, 'int32');
}

// ── INQUIRY VPD ─────────────────────────────────────────────────────────────

function inquiryVpd(fd: number, page: number, allocLen = 252): Buffer {
  const cdb = Buffer.from([0x12, 0x01, page & 0xff, (allocLen >> 8) & 0xff, allocLen & 0xff, 0x00]);
  const data = Buffer.alloc(allocLen);
  const sense = Buffer.alloc(32);

  const hdr = {
    interface_id: SG_INTERFACE_ID,
    dxfer_direction: SG_DXFER_FROM_DEV,
    cmd_len: cdb.length,
    mx_sb_len: sense.length,
    iovec_count: 0,
    dxfer_len: data.length,
    dxferp: data,
    cmdp: cdb,
    sbp: sense,
    timeout: 5000,
    flags: 0,
    pack_id: 0,
    usr_ptr: null,
    status: 0,
    masked_status: 0,
    msg_status: 0,
    sb_len_wr: 0,
    host_status: 0,
    driver_status: 0,
    resid: 0,
    duration: 0,
    info: 0,
  };

  const rc = ioctl(fd, SG_IO, hdr);
  if (rc !== 0) {
    const e = errno();
    const hint =
      e === 1
        ? ' (EPERM — capability missing or kernel rejected SCSI passthrough)'
        : e === 13
          ? ' (EACCES — install udev rule or run with sudo)'
          : e === 16
            ? ' (EBUSY — another process holds the device)'
            : '';
    throw new Error(`ioctl(SG_IO) failed for VPD page 0x${page.toString(16)}: errno=${e}${hint}`);
  }
  if (hdr.status !== 0 || hdr.host_status !== 0 || hdr.driver_status !== 0) {
    throw new Error(
      `SG status non-zero for VPD page 0x${page.toString(16)}: ` +
        `status=${hdr.status} host=${hdr.host_status} driver=${hdr.driver_status}`
    );
  }
  return data;
}

// ── Main ────────────────────────────────────────────────────────────────────

function permissionAdvice(devicePath: string): string {
  return [
    `Permission denied accessing ${devicePath}.`,
    ``,
    `podkit needs SCSI access to read iPod device identity. To fix:`,
    ``,
    `  1. Install the podkit udev rule (recommended):`,
    `       sudo cp 91-podkit-ipod-scsi.rules /etc/udev/rules.d/`,
    `       sudo udevadm control --reload && sudo udevadm trigger`,
    `       (then unplug and replug your iPod)`,
    ``,
    `  2. Or, run with sudo as a one-off:`,
    `       sudo node --import tsx ./linux.ts ${devicePath}`,
    ``,
  ].join('\n');
}

function main() {
  const [, , devicePath = '/dev/sg3', outPath] = process.argv;
  console.error(`[linux-spike] device=${devicePath}`);

  let fd: number;
  try {
    fd = fs.openSync(devicePath, fs.constants.O_RDONLY);
  } catch (err: any) {
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      throw new Error(permissionAdvice(devicePath));
    }
    throw err;
  }
  console.error(`[linux-spike] fd=${fd}`);

  try {
    const t0 = process.hrtime.bigint();

    // Page 0xC0 — index of subpages.
    const indexBuf = inquiryVpd(fd, 0xc0);
    // VPD response header: byte[3] = page length, payload starts at byte[4].
    const indexLen = indexBuf[3]!;
    const subpages = Array.from(indexBuf.subarray(4, 4 + indexLen));
    console.error(
      `[linux-spike] page 0xC0 returned ${indexLen} subpage ids: ` +
        subpages.map((b) => '0x' + b.toString(16)).join(' ')
    );

    // Each subpage's data field contributes a chunk of the XML.
    const chunks: Buffer[] = [];
    for (const page of subpages) {
      const buf = inquiryVpd(fd, page);
      const len = buf[3]!;
      chunks.push(Buffer.from(buf.subarray(4, 4 + len)));
    }

    const xml = Buffer.concat(chunks);
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    console.error(
      `[linux-spike] read ${subpages.length} subpages, ${xml.length} bytes total in ${elapsedMs.toFixed(1)}ms`
    );

    if (outPath) {
      fs.writeFileSync(outPath, xml);
      console.error(`[linux-spike] wrote ${outPath}`);
    } else {
      process.stdout.write(xml);
    }
  } finally {
    fs.closeSync(fd);
  }
}

try {
  main();
} catch (err) {
  console.error(`[linux-spike] FAIL:`, err instanceof Error ? err.message : err);
  process.exit(1);
}
