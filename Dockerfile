# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    DATABASE_MODE=embedded \
    MONGRELDB_PATH=/data/db \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Native modules, copied explicitly in case the standalone tracer misses them.
COPY --from=deps /app/node_modules/@visorcraft ./node_modules/@visorcraft
COPY --from=deps /app/node_modules/argon2 ./node_modules/argon2
COPY scripts/bootstrap-env.sh ./scripts/bootstrap-env.sh
RUN chmod +x ./scripts/bootstrap-env.sh && mkdir -p /data

EXPOSE 3000
VOLUME ["/data"]

ENTRYPOINT ["/bin/sh", "-c", "./scripts/bootstrap-env.sh && exec node server.js"]
