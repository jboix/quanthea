# syntax=docker/dockerfile:1
# The querent image: the Bun server, run from source, serving the built SPA.
# Build from the repository root:
#   docker build -t querent .
#   docker run -p 3000:3000 -v querent-data:/data querent
#
# Every RUN happens in stages on the build platform. Their output is JavaScript
# and the built SPA, the same on every CPU, so the runner stage needs no RUN and
# `docker buildx build --platform linux/amd64,linux/arm64` needs no emulation.
# A dependency with native code would break this; keep them pure JavaScript.

# ---- build: install every workspace and build the SPA ----
FROM --platform=$BUILDPLATFORM oven/bun:1.3.14-slim AS build
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY dev/package.json dev/package.json
# The root prepare script installs git hooks, which an image has no use for.
RUN bun install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN bun run --filter @querent/web build

# ---- deps: the server's production dependencies, and the data directory ----
FROM --platform=$BUILDPLATFORM oven/bun:1.3.14-slim AS deps
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY dev/package.json dev/package.json
RUN bun install --frozen-lockfile --ignore-scripts --production --filter @querent/server
RUN mkdir -p /volume/data && chown 1000:1000 /volume/data && chmod 700 /volume/data

# ---- runner: server and shared sources, their dependencies, and the SPA ----
FROM oven/bun:1.3.14-slim AS runner
LABEL org.opencontainers.image.title="querent" \
      org.opencontainers.image.description="Describe a dashboard in a chat, an agent builds it against your data sources, pin the good ones." \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    QUERENT_PORT=3000 \
    QUERENT_DATA_DIR=/data
COPY --from=deps /volume/ /
COPY --from=deps /repo/node_modules node_modules
COPY --from=deps /repo/apps/server/node_modules apps/server/node_modules
COPY --from=deps /repo/packages/shared/node_modules packages/shared/node_modules
COPY package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/shared/src packages/shared/src
COPY apps/server/package.json apps/server/package.json
COPY apps/server/src apps/server/src
COPY --from=build /repo/apps/web/dist apps/web/dist
USER bun
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["bun", "-e", "fetch('http://localhost:' + process.env.QUERENT_PORT + '/api/health').then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "apps/server/src/main.ts"]
