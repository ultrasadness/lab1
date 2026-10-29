# The browser service (ADR 0006). Chrome for Testing comes with the image and updates only with Playwright.
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS node-runtime

FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f

# Replace the NodeSource binary too: both absolute paths and npm's env shebang must use the patched runtime.
# The browser binaries and their matching playwright-core stay at 1.64.0.
COPY --from=node-runtime /usr/local/bin/node /usr/bin/node
RUN ln -sfn /usr/bin/node /usr/local/bin/node

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-fund --no-audit && npm cache clean --force

# Managed policies: no password saving, autofill, downloads, permission prompts or Google sign-in in any context.
COPY chrome-policies.json /etc/opt/chrome_for_testing/policies/managed/lab1.json
COPY src ./src

USER pwuser
ENV HOME=/home/pwuser NODE_ENV=production
RUN test "$(command -v node)" = /usr/local/bin/node \
    && test "$(node --version)" = v24.22.1 \
    && test "$(/usr/bin/node --version)" = v24.22.1
CMD ["node", "src/main.ts"]
