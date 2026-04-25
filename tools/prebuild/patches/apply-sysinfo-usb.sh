#!/bin/bash
# Apply SysInfoExtended USB read patch to libgpod source tree.
#
# The upstream libgpod 0.8.3 configure.ac already checks for libusb-1.0
# and sets HAVE_LIBUSB + LIBUSB_CFLAGS/LIBUSB_LIBS. However, the release
# tarball only uses this in tools/Makefile.am (for the standalone binary).
#
# This patch:
# 1. Copies itdb_usb.c into src/ (the library implementation)
# 2. Adds HAVE_LIBUSB conditional to src/Makefile.am (compile + link into libgpod.a)
# 3. Adds public declaration to src/itdb.h
#
# Run from within the libgpod-0.8.3 directory.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Copy itdb_usb.c into src/
if [ ! -f src/itdb_usb.c ]; then
  cp "$SCRIPT_DIR/itdb_usb.c" src/itdb_usb.c
  echo "  Copied itdb_usb.c into src/"
else
  echo "  itdb_usb.c already present in src/"
fi

# 2. Patch src/Makefile.am — add HAVE_LIBUSB block after HAVE_LIBIMOBILEDEVICE
if ! grep -q 'HAVE_LIBUSB' src/Makefile.am; then
  # Find the endif that closes HAVE_LIBIMOBILEDEVICE and append after it
  sed -i.bak '/^if HAVE_LIBIMOBILEDEVICE/,/^endif/{
    /^endif/a\
\
if HAVE_LIBUSB\
libgpod_la_SOURCES += itdb_usb.c\
LIBS+=$(LIBUSB_LIBS)\
libgpod_la_CFLAGS+=$(LIBUSB_CFLAGS)\
endif
  }' src/Makefile.am
  rm -f src/Makefile.am.bak
  echo "  Patched src/Makefile.am with HAVE_LIBUSB block"
else
  echo "  src/Makefile.am already has HAVE_LIBUSB"
fi

# 3. Patch src/itdb.h — add declaration before G_END_DECLS
if ! grep -q 'itdb_read_sysinfo_extended_from_usb' src/itdb.h; then
  sed -i.bak '/^G_END_DECLS/i\
/* Read SysInfoExtended XML from iPod firmware via USB vendor control transfer.\
 * Requires libusb. Returns XML string (caller must g_free) or NULL on failure.\
 * bus_number and device_address identify the USB device. */\
#ifdef HAVE_LIBUSB\
gchar *itdb_read_sysinfo_extended_from_usb (guint bus_number, guint device_address);\
#endif\
' src/itdb.h
  rm -f src/itdb.h.bak
  echo "  Patched src/itdb.h with USB function declaration"
else
  echo "  src/itdb.h already has USB function declaration"
fi
