# syntax=docker/dockerfile:1

# This image is for the fake recording mode only: it makes a test pattern with ffmpeg. The recorder that drives the game
# runs on a Windows machine and is not started from here (see README.md).

# ---- Build stage: compile the TypeScript ----
FROM node:22-alpine AS build
WORKDIR /app

# Install the dependencies in their own layer so a source-only change does not install them again.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: the compiled program and ffmpeg ----
FROM node:22-alpine

# ffmpeg makes the test pattern, takes the thumbnail and probes the result. The DejaVu fonts are what its drawtext
# filter writes the clip, the player and the tick on the frames with.
RUN apk add --no-cache ffmpeg font-dejavu

WORKDIR /app
# The program has no dependencies of its own, so there is no node_modules to carry over; package.json is read for the
# version it reports.
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist

# The demo cache and the scratch directories of the clips live in /work. It belongs to the unprivileged user of the
# image, and a volume mounted there starts with the same owner.
RUN mkdir /work && chown node:node /work
ENV WORK_DIR=/work
USER node

# Node itself and not a shell, so that the SIGTERM of `docker stop` reaches the program, which gives its clip back.
CMD ["node", "dist/main.js"]
