#!/bin/bash
# Add a real --without-libusb opt-out to a libgpod configure.ac.
#
# Stock libgpod 0.8.3 unconditionally probes for libusb-1.0 via pkg-config and
# defines HAVE_LIBUSB whenever it is present, pulling libusb into the library
# and/or tools (itdb_usb.c / ipod-usb.c) and, on macOS, linking the Homebrew
# libusb-1.0.0.dylib into the resulting binaries.
#
# podkit never calls itdb_read_sysinfo_extended_from_usb -- USB SysInfoExtended
# reads live entirely in @podkit/ipod-firmware (via the `usb` npm package). So we
# turn the unconditional probe into a proper AC_ARG_WITH([libusb]) guard and pass
# --without-libusb at configure time to keep libusb out of every build we control.
#
# Idempotent: safe to run more than once (no-op if the guard is already present).
set -e

CONFIGURE_AC="${1:?usage: disable-libgpod-libusb.sh <path/to/configure.ac>}"

if grep -q 'AC_ARG_WITH(\[libusb\]' "$CONFIGURE_AC"; then
  echo "==> $CONFIGURE_AC already has the --without-libusb opt-out, skipping"
  exit 0
fi

if ! grep -q 'PKG_CHECK_MODULES(LIBUSB, libusb-1.0, have_libusb=yes, have_libusb=no)' "$CONFIGURE_AC"; then
  echo "ERROR: expected libusb PKG_CHECK_MODULES line not found in $CONFIGURE_AC" >&2
  echo "       (libgpod source layout changed -- update disable-libgpod-libusb.sh)" >&2
  exit 1
fi

perl -0pi -e 's/PKG_CHECK_MODULES\(LIBUSB, libusb-1\.0, have_libusb=yes, have_libusb=no\)/AC_ARG_WITH([libusb],\n  [AS_HELP_STRING([--without-libusb], [disable libusb-based SysInfoExtended USB reads])],\n  [with_libusb=\$withval], [with_libusb=yes])\nAS_IF([test "x\$with_libusb" = "xyes"],\n  [PKG_CHECK_MODULES(LIBUSB, libusb-1.0, have_libusb=yes, have_libusb=no)],\n  [have_libusb=no])/' "$CONFIGURE_AC"

echo "==> Added --without-libusb opt-out to $CONFIGURE_AC"
