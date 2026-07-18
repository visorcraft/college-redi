# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    DATABASE_MODE=embedded \
    MONGRELDB_PATH=/data/db \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
# Native modules, copied explicitly in case the standalone tracer misses them.
COPY --from=deps /app/node_modules/@visorcraft ./node_modules/@visorcraft
COPY --from=deps /app/node_modules/argon2 ./node_modules/argon2
COPY --from=deps /app/node_modules/pdfjs-dist/build/pdf.worker.mjs ./.next/server/chunks/pdf.worker.mjs
COPY scripts/bootstrap-env.sh ./scripts/bootstrap-env.sh
RUN chmod +x ./scripts/bootstrap-env.sh && mkdir -p /data && chown node:node /data

EXPOSE 3000
VOLUME ["/data"]

USER node
ENTRYPOINT ["/bin/sh", "-c", "./scripts/bootstrap-env.sh && exec node server.js"]
