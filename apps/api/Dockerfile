# PropVerify API — NestJS + Prisma.
#
# Debian slim rather than alpine on purpose: Prisma's query engine and sharp
# both ship prebuilt glibc binaries, and the musl variants are a recurring
# source of "works locally, dies in the container".

# ── build ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /repo

# Manifests first so an unchanged dependency set reuses the install layer.
# npm workspaces needs every workspace's package.json present before `npm ci`
# will resolve the tree.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN npm ci

COPY . .

# the client is generated from the schema, so it must exist before tsc runs
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build -w @propverify/shared
RUN npm run build -w @propverify/api

# ── runtime ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# openssl is a Prisma runtime requirement and is not in the slim base
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# The whole tree is copied rather than a hand-picked subset: npm workspaces
# hoists most dependencies to the root but nests some under apps/*/node_modules,
# and cherry-picking those is how you get a container that boots and then fails
# on one missing module. Costs image size, buys certainty — a fair trade here.
COPY --from=build /repo ./

COPY apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]
