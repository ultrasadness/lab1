# The Pi container (ADR 0001): pinned Pi and our extension, nothing else. It holds no token. Its only model
# endpoint is the bot's forwarder, and the bot starts each run in it with `docker exec … pi-run`.
# Build from the repo root: docker build -f pi/Dockerfile -t assistant-pi .
FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

WORKDIR /opt/assistant
# Pi at the exact versions package-lock.json pins. The bot's own code needs no npm package, so Pi is the only one.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY pi/extension ./pi/extension
COPY pi/pi-run /usr/local/bin/pi-run

ENV PI_BIN=/opt/assistant/node_modules/.bin/pi \
    ASSISTANT_PI_EXTENSION=/opt/assistant/pi/extension/index.ts \
    PI_CODING_AGENT_DIR=/home/node/.pi/agent

# Pi's machine-local files stay empty by construction: no settings, models, skills or extensions of its own.
USER node
RUN mkdir -p /home/node/.pi/agent /home/node/work
WORKDIR /home/node/work
CMD ["sleep", "infinity"]
