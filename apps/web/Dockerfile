# PropVerify web — Next.js 14 (App Router), standalone output.

# ── build ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /repo

# Manifests first so an unchanged dependency set reuses the install layer.
# Install and build share a stage: npm workspaces nests some dependencies under
# apps/*/node_modules, and copying only the root one leaves those behind.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN npm ci

COPY . .

# NEXT_PUBLIC_* is inlined into the client bundle at BUILD time, so the API
# URL has to be known here — it cannot be supplied at run time. Rebuild the
# image if the API moves to a different host.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build -w @propverify/shared
RUN npm run build -w @propverify/web

# ── runtime ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `standalone` emits a minimal server plus only the traced dependencies;
# static/ and public/ are not traced and have to be copied alongside it.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# no public/ directory in this project — add a COPY for it if one is ever added

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
