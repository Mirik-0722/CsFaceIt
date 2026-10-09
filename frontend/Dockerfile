# syntax=docker/dockerfile:1

# ---- Build stage: type-check and bundle the SPA ----
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies in their own layer so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage: Nginx serves the bundle and proxies /api/ to the backend ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
