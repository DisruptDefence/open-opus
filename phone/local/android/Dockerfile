# Runs the Android emulator headless. The SDK and the virtual device are mounted from the host, not baked in.
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libpulse0 libnss3 libnspr4 libx11-6 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 \
      libxi6 libxrender1 libxtst6 libxkbfile1 libxkbcommon0 libasound2t64 libdbus-1-3 libdrm2 libgbm1 libfontconfig1 \
      libbsd0 libc++1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/sdk/emulator/emulator"]
