# syntax = docker/dockerfile:1

ARG NODE_VERSION=22.21.0
FROM node:${NODE_VERSION}-slim as base

# Set production environment
ENV NODE_ENV="production"
ENV ADAPTER="node"

# 1. Build Stage
FROM base as build
WORKDIR /app
RUN npm install -g pnpm

# Install system dependencies
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 wget

# Copy entire repo (excludes .dockerignore files)
COPY . .

# Install deps & Build
RUN pnpm install --frozen-lockfile
RUN pnpm run build:compute

# Deploy only the compute app to a clean folder
RUN pnpm deploy --filter=@selva/compute-app --prod /app/deploy --legacy

# 2. Runtime Stage
FROM base
WORKDIR /app

# Copy deployed app + dependencies
COPY --from=build /app/deploy .

# Copy the build output (pnpm deploy doesn't include build artifacts usually)
COPY --from=build /app/packages/compute-app/build ./build

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0

CMD [ "node", "build/index.js" ]
