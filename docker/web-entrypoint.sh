#!/bin/sh
# Startup sequence for the local web container: install -> serve.
set -e

cd /workspace

echo "==> Installing dependencies (frozen lockfile)..."
if ! pnpm install --frozen-lockfile; then
  echo "==> Frozen install was rejected under the pinned pnpm version; falling back to a non-frozen install so the lockfile can self-heal..." >&2
  pnpm install --no-frozen-lockfile
fi

echo "==> Starting the web app dev server..."
exec pnpm --filter @workspace/mahjong-scoreboard run dev
