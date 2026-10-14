# PROTOTYPE, throwaway: Takeover shapes rig for "Which Takeover shape works from the iPhone?" (issue #21).
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f

RUN apt-get update \
 && apt-get install -y --no-install-recommends x11vnc websockify \
 && rm -rf /var/lib/apt/lists/*

ADD https://github.com/novnc/noVNC/archive/refs/tags/v1.7.0.tar.gz /tmp/novnc.tgz
RUN mkdir -p /opt/novnc && tar -xzf /tmp/novnc.tgz -C /opt/novnc --strip-components=1 && rm /tmp/novnc.tgz

WORKDIR /app
RUN npm init -y >/dev/null && npm install --silent playwright@1.64.0
COPY rig.mjs form.html launcher.html ./

USER pwuser
ENV HOME=/home/pwuser
CMD ["node", "rig.mjs"]
