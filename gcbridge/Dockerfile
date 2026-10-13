# syntax=docker/dockerfile:1

# The bridge to the CS2 game coordinator (see README.md). It is plain JavaScript, so there is nothing to build: the image
# is the dependencies and the source.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install the dependencies in their own layer so a source-only change does not install them again.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# What the Steam library keeps between restarts lives in /data. It belongs to the unprivileged user of the image, and a
# volume that is mounted there when it is still empty starts with the same owner.
RUN mkdir /data && chown node:node /data
ENV BRIDGE_DATA_DIR=/data PORT=8090
USER node
EXPOSE 8090

# 200 only while Steam and the game coordinator are both up: the container is unhealthy while it signs in, and while the
# account is refused. busybox's wget fails on a 503, which is what makes this work.
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=3 \
    CMD wget -q --spider "http://127.0.0.1:${PORT}/health" || exit 1

# Node itself and not a shell, so that the SIGTERM of `docker stop` reaches the program, which signs out of Steam.
CMD ["node", "src/server.js"]
