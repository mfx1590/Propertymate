#!/bin/sh
set -e

# Migrations run on boot rather than as a separate deploy step: this is a
# single-container API, so there is no window where two versions race, and it
# means `docker compose up -d` is the whole deploy.
#
# `migrate deploy` only applies committed migrations — it never generates or
# resets, so it is safe to run on every start.
echo "→ applying database migrations"
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

# Seeding is deliberately NOT automatic: it is idempotent, but a production
# database should be seeded once, on purpose. See docs/deployment.md.
if [ "$SEED_ON_BOOT" = "true" ]; then
  echo "→ SEED_ON_BOOT=true, running seed"
  npm run db:seed -w apps/api
fi

echo "→ starting API"
exec "$@"
