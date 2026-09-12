#!/bin/sh
# Startup sequence for the local API container: install -> push schema ->
# seed -> serve. Postgres readiness is handled by docker-compose's
# `depends_on: condition: service_healthy`, not here.
set -e

cd /workspace

echo "==> Installing dependencies (frozen lockfile)..."
if ! pnpm install --frozen-lockfile; then
  echo "==> Frozen install was rejected under the pinned pnpm version; falling back to a non-frozen install so the lockfile can self-heal..." >&2
  pnpm install --no-frozen-lockfile
fi

echo "==> Pushing the Drizzle schema to Postgres..."
pnpm --filter @workspace/db run push

echo "==> Seeding the database (no-op if mahjong_sessions already has rows)..."
pnpm --filter @workspace/db run seed

echo "==> Starting the API server in watch mode..."
exec pnpm --filter @workspace/api-server run watch
