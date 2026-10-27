# syntax=docker/dockerfile:1
FROM node:22-bookworm AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

FROM node:22-bookworm AS server
WORKDIR /server
COPY server/package.json server/package-lock.json* ./
RUN npm ci || npm install
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# sqlite3 CLI is for backup.sh (.backup); curl is for the healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends sqlite3 curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data WEB_DIR=/app/public MIGRATIONS_DIR=/app/migrations
COPY --from=server /server/node_modules ./node_modules
COPY --from=server /server/dist ./dist
COPY server/migrations ./migrations
COPY --from=web /web/dist ./public
USER node
EXPOSE 8530
CMD ["node", "dist/index.js"]
