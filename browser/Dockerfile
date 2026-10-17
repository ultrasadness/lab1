# The browser service (ADR 0006). Chrome for Testing comes with the image and updates only with Playwright.
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-fund --no-audit && npm cache clean --force

# Managed policies: no password saving, autofill, downloads, permission prompts or Google sign-in in any context.
COPY chrome-policies.json /etc/opt/chrome_for_testing/policies/managed/lab1.json
COPY src ./src

USER pwuser
ENV HOME=/home/pwuser NODE_ENV=production
CMD ["node", "src/main.ts"]
