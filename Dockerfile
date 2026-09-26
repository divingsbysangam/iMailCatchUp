# syntax=docker/dockerfile:1

# ---------- Build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain only needed if better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- Runtime ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATABASE_PATH=/data/app.db \
    WEB_ROOT=/app/web/dist
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/dist/index.js"]
