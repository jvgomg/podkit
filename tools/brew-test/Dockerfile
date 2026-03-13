# syntax=docker/dockerfile:1

# ── Stage 1: Debian base with Homebrew installed ──────────────────────────────
# Cached as long as apt packages and the Homebrew install script don't change.
# Takes ~2-3 minutes cold; subsequent builds are instant.
FROM debian:bookworm-slim AS brew-base

# https://docs.brew.sh/Homebrew-on-Linux#requirements
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        file \
        git \
        procps \
    && rm -rf /var/lib/apt/lists/*

# Homebrew refuses to run as root
RUN useradd -m linuxbrew
USER linuxbrew
WORKDIR /home/linuxbrew

RUN NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:$PATH"

# ── Stage 2: pre-install ffmpeg ───────────────────────────────────────────────
# ffmpeg is the heavy transitive dependency. Cache it separately so the smoke
# test only needs to download and install the podkit binary itself.
FROM brew-base AS brew-with-ffmpeg

RUN brew install ffmpeg

# ── Stage 3: smoke test ───────────────────────────────────────────────────────
# brew install podkit and the assertions run as CMD (container startup), not as
# RUN steps, so they always execute fresh regardless of the build cache.
FROM brew-with-ffmpeg AS smoke-test

ENV PODKIT_TAP=jvgomg/podkit

CMD bash -c "set -euo pipefail && \
    echo '=== tapping ${PODKIT_TAP} ===' && \
    brew tap \"${PODKIT_TAP}\" && \
    echo '=== installing podkit ===' && \
    brew install podkit && \
    echo '=== podkit --version ===' && \
    podkit --version && \
    echo '=== podkit --help ===' && \
    podkit --help && \
    echo '=== SMOKE TEST PASSED ==='"
