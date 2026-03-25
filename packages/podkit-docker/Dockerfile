# podkit Docker image
#
# Syncs music collections to iPod devices.
# Follows LinuxServer.io conventions for PUID/PGID, volumes, and env vars.
#
# Multi-arch: linux/amd64, linux/arm64
# Pre-built musl binaries are copied in per-architecture from CI artifacts.
#
# Usage (CLI — default):
#   docker run -v ./config:/config -v /path/to/music:/music:ro -v /media/ipod:/ipod \
#     -e PUID=1000 -e PGID=1000 ghcr.io/jvgomg/podkit:latest sync
#
# Usage (daemon — opt-in, auto-detects and syncs iPods on plug-in):
#   docker run -v ./config:/config -v /path/to/music:/music:ro \
#     --device /dev/bus/usb -e PUID=1000 -e PGID=1000 \
#     ghcr.io/jvgomg/podkit:latest daemon
#
# Usage (daemon with mass-storage device support):
#   docker run -v ./config:/config -v /path/to/music:/music:ro \
#     -v /mnt/device:/mnt/device -e PODKIT_MASS_STORAGE_PATHS=/mnt/device \
#     -e PUID=1000 -e PGID=1000 ghcr.io/jvgomg/podkit:latest daemon
#

FROM alpine:3.21

ARG BUILD_DATE
ARG VERSION
ARG CLI_VERSION
ARG DAEMON_VERSION
ARG TARGETARCH

LABEL org.opencontainers.image.title="podkit" \
      org.opencontainers.image.description="Sync music collections to iPod devices" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/jvgomg/podkit" \
      org.opencontainers.image.url="https://jvgomg.github.io/podkit" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT" \
      io.podkit.cli.version="${CLI_VERSION}" \
      io.podkit.daemon.version="${DAEMON_VERSION}"

# Runtime environment
ENV PUID=1000 \
    PGID=1000 \
    TZ=Etc/UTC \
    PODKIT_CONFIG=/config/config.toml \
    PODKIT_TIPS=false

RUN echo "**** install runtime dependencies ****" && \
    apk add --no-cache \
      bash \
      ffmpeg \
      lsblk \
      su-exec \
      shadow \
      tzdata && \
    echo "**** create directories ****" && \
    mkdir -p /config /music /ipod && \
    echo "**** cleanup ****" && \
    rm -rf /tmp/*

# Copy entrypoint
COPY --chmod=755 packages/podkit-docker/entrypoint.sh /entrypoint.sh

# Copy pre-built musl binaries for this architecture
# CI organizes binaries as: bin/<arch>/podkit, bin/<arch>/podkit-daemon
#   amd64 -> bin/amd64/podkit, bin/amd64/podkit-daemon
#   arm64 -> bin/arm64/podkit, bin/arm64/podkit-daemon
COPY --chmod=755 bin/${TARGETARCH}/podkit /usr/local/bin/podkit
COPY --chmod=755 bin/${TARGETARCH}/podkit-daemon /usr/local/bin/podkit-daemon
RUN printf '{"docker":"%s","cli":"%s","daemon":"%s"}\n' \
      "${VERSION}" "${CLI_VERSION}" "${DAEMON_VERSION}" \
      > /usr/local/share/podkit-versions.json

VOLUME /config

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sync"]
