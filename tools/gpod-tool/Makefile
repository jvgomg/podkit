# gpod-tool Makefile
#
# Build the gpod-tool CLI utility for libgpod operations.
#
# Requirements:
#   - libgpod (with development headers)
#   - GLib 2.0
#   - pkg-config
#
# On macOS with local libgpod build:
#   export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig:$PKG_CONFIG_PATH"
#   make

CC ?= gcc
CFLAGS ?= -Wall -Wextra -O2
PREFIX ?= /usr/local

# Get flags from pkg-config
PKG_CONFIG ?= pkg-config
LIBGPOD_CFLAGS := $(shell $(PKG_CONFIG) --cflags libgpod-1.0 2>/dev/null)
LIBGPOD_LIBS := $(shell $(PKG_CONFIG) --libs libgpod-1.0 2>/dev/null)

# Path to libgpod source for private headers (itdb_thumb.h, itdb_device.h)
# Required for artwork-dump command which accesses internal thumb structures
LIBGPOD_SRC_DIR ?= $(realpath $(dir $(lastword $(MAKEFILE_LIST)))/../../tools/libgpod-macos/build/libgpod-0.8.3/src)
LIBGPOD_PRIVATE_CFLAGS := $(if $(wildcard $(LIBGPOD_SRC_DIR)/itdb_thumb.h),-I$(LIBGPOD_SRC_DIR),)

# Check if libgpod was found
ifeq ($(LIBGPOD_CFLAGS),)
$(error libgpod not found. Ensure libgpod-1.0 is installed and PKG_CONFIG_PATH is set correctly)
endif

# Source files
SRCS := gpod-tool.c
OBJS := $(SRCS:.c=.o)
TARGET := gpod-tool

# Build rules
.PHONY: all clean install uninstall check

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $^ $(LIBGPOD_LIBS)

%.o: %.c
	$(CC) $(CFLAGS) $(LIBGPOD_CFLAGS) $(LIBGPOD_PRIVATE_CFLAGS) -c -o $@ $<

clean:
	rm -f $(TARGET) $(OBJS)
	rm -rf test-ipod-*

install: $(TARGET)
	install -d $(DESTDIR)$(PREFIX)/bin
	install -m 755 $(TARGET) $(DESTDIR)$(PREFIX)/bin/

uninstall:
	rm -f $(DESTDIR)$(PREFIX)/bin/$(TARGET)

# Run basic tests
check: $(TARGET)
	@echo "=== Testing gpod-tool ==="
	@echo ""
	@echo "--- Testing init ---"
	rm -rf test-ipod-check
	./$(TARGET) init test-ipod-check --model MA147 --name "Check iPod"
	@echo ""
	@echo "--- Testing info ---"
	./$(TARGET) info test-ipod-check
	@echo ""
	@echo "--- Testing add-track ---"
	./$(TARGET) add-track test-ipod-check -t "Test Song" -a "Test Artist" -A "Test Album"
	@echo ""
	@echo "--- Testing tracks ---"
	./$(TARGET) tracks test-ipod-check
	@echo ""
	@echo "--- Testing verify ---"
	./$(TARGET) verify test-ipod-check
	@echo ""
	@echo "--- Testing JSON output ---"
	./$(TARGET) info test-ipod-check --json
	@echo ""
	@echo "--- Cleanup ---"
	rm -rf test-ipod-check
	@echo ""
	@echo "=== All tests passed ==="
