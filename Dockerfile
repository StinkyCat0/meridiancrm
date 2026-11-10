# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:22-slim AS builder

# Prisma needs OpenSSL at generate/runtime; git is not required.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies from the workspace lockfile (includes dev deps needed to build).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN npm ci

# Copy sources and build API + web.
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
ENV DATABASE_URL="file:./dev.db"
RUN npm run db:generate -w @meridian/api \
  && npm run build -w @meridian/api \
  && npm run build -w @meridian/web

# ---------- runtime ----------
FROM node:22-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && install -d -m 700 -o node -g node /data

ENV NODE_ENV=production \
    SERVE_WEB=1 \
    PORT=4000 \
    HOST=0.0.0.0 \
    WEB_DIST_PATH=/app/apps/web/dist \
    DATABASE_URL=file:/data/meridian.db

# Runtime node_modules include the Prisma CLI, which runs migrations on boot.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/contracts ./packages/contracts
COPY --from=builder /app/packages/api-client ./packages/api-client
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/src ./apps/api/src
COPY --from=builder /app/apps/web/dist ./apps/web/dist

WORKDIR /app/apps/api
USER node

VOLUME ["/data"]
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD umask 077 && npx --no-install prisma migrate deploy --schema prisma/schema.prisma && node dist/server.js
