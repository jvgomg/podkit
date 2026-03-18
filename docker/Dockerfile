# podkit Docker image
#
# Syncs music collections to iPod devices.
# Follows LinuxServer.io conventions for PUID/PGID, volumes, and env vars.
#
# Multi-arch: linux/amd64, linux/arm64
# Pre-built musl binaries are copied in per-architecture from CI artifacts.
#
# Usage:
#   docker run -v ./config:/config -v /path/to/music:/music:ro -v /media/ipod:/ipod \
#     -e PUID=1000 -e PGID=1000 ghcr.io/jvgomg/podkit:latest sync
#

FROM alpine:3.21

ARG BUILD_DATE
ARG VERSION
ARG TARGETARCH

LABEL org.opencontainers.image.title="podkit" \
      org.opencontainers.image.description="Sync music collections to iPod devices" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/jvgomg/podkit" \
      org.opencontainers.image.url="https://jvgomg.github.io/podkit" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT"

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
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy pre-built musl binary for this architecture
# CI organizes binaries as: bin/<arch>/podkit
#   amd64 -> bin/amd64/podkit
#   arm64 -> bin/arm64/podkit
COPY bin/${TARGETARCH}/podkit /usr/local/bin/podkit
RUN chmod +x /usr/local/bin/podkit

VOLUME /config

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sync"]
