# Rainmaker: one small container that polls GitHub and runs Claude Code or Codex.
# The agent CLIs are NOT baked in. They're installed on the /data volume at startup,
# so they update independently of this image.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl unzip jq procps fontconfig python3 \
  && rm -rf /var/lib/apt/lists/*

# Screenshots. Agents run without root, so the system pieces live in the image:
# - a virtual display and software OpenGL (llvmpipe), for `xvfb-run -a godot --rendering-driver opengl3`
#   (Godot loads the X11 libraries itself, so they're listed by name);
# - the libraries Playwright's Chromium needs (`npx playwright install chromium` then works without install-deps);
# - numpy and Pillow, which screenshot and colour-check scripts commonly use.
# Big, versioned downloads (Godot export templates, Playwright browsers) are left to each run and cached under HOME.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb xauth libgl1 libglx-mesa0 libgl1-mesa-dri \
    libx11-6 libx11-xcb1 libxcursor1 libxinerama1 libxext6 libxrandr2 libxrender1 libxi6 libxfixes3 libxkbcommon0 \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 \
    libglib2.0-0 libpango-1.0-0 libcairo2 libasound2 libxcomposite1 libxdamage1 libxcb1 fonts-liberation \
    python3-numpy python3-pil \
  && rm -rf /var/lib/apt/lists/*

# mise installs per-repo runtimes (Node, Python, ...) on demand from version files.
RUN curl -fsSL https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh \
  && mise --version

WORKDIR /app
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOME=/data/home \
    PORT=3000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PATH=/data/tools/npm/bin:$PATH

RUN mkdir -p /data/home && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD curl -fsS http://localhost:3000/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
