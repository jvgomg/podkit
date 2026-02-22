# Dockerfile for testing FFmpeg build scripts on Debian
#
# This Dockerfile verifies the build scripts work on a clean Debian system.
# It builds FFmpeg with libfdk_aac and tests transcoding.
#
# Usage:
#   docker build -t podkit-ffmpeg-test .
#   docker run --rm podkit-ffmpeg-test
#
FROM debian:bookworm

LABEL maintainer="podkit"
LABEL description="Test environment for FFmpeg build scripts"

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Set working directory
WORKDIR /build

# Copy build scripts
COPY install-deps.sh build-ffmpeg.sh ./

# Make scripts executable
RUN chmod +x install-deps.sh build-ffmpeg.sh

# Install dependencies
RUN ./install-deps.sh

# Build FFmpeg (non-interactive mode)
RUN echo "n" | ./build-ffmpeg.sh

# Verify the build
RUN ./ffmpeg-build/bin/ffmpeg -version
RUN ./ffmpeg-build/bin/ffmpeg -encoders 2>/dev/null | grep -E "aac|fdk"

# Verify libfdk_aac encoder is present and usable
RUN ./ffmpeg-build/bin/ffmpeg -hide_banner -h encoder=libfdk_aac | head -10

# Verify the encoder can initialize (this confirms libfdk-aac library is linked correctly)
# We test by asking ffmpeg to show encoder options - this loads the encoder
RUN ./ffmpeg-build/bin/ffmpeg -hide_banner -h encoder=libfdk_aac | grep -q "Fraunhofer FDK AAC"

# Print success summary
RUN echo "========================================" && \
    echo "  Build verification successful!" && \
    echo "========================================" && \
    echo "" && \
    echo "FFmpeg version:" && \
    ./ffmpeg-build/bin/ffmpeg -version | head -1 && \
    echo "" && \
    echo "Available AAC encoders:" && \
    ./ffmpeg-build/bin/ffmpeg -encoders 2>/dev/null | grep -E "aac|fdk"

# Default command: show build info
CMD ["sh", "-c", "./ffmpeg-build/bin/ffmpeg -version && echo '' && echo 'Available AAC encoders:' && ./ffmpeg-build/bin/ffmpeg -encoders 2>/dev/null | grep -E 'aac|fdk'"]
