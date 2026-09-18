#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run reconcile:players
pnpm --filter @workspace/scripts run migrate:sessions
pnpm --filter db push-force
pnpm --filter @workspace/scripts run seed:players
pnpm --filter @workspace/scripts run migrate:sessions:after-push
