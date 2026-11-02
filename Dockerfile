# Rainmaker: one small container that polls GitHub and runs Claude Code or Codex.
# The agent CLIs are NOT baked in. They're installed on the /data volume at startup,
# so they update independently of this image.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl unzip jq procps fontconfig \
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
