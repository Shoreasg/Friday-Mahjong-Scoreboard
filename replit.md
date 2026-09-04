# Friday Mahjong Scoreboard

A shared scoreboard for friends to record weekly Friday Mahjong sessions, settlement amounts, rounds played, and winners.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/mahjong-scoreboard run dev` — run the web app through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `ADMIN_EMAILS`, `VITE_ADMIN_EMAILS`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/mahjong-scoreboard` — React web app and branded Clerk sign-in
- `artifacts/api-server/src/routes/sessions.ts` — public-read, admin-write Mahjong session API
- `lib/api-spec/openapi.yaml` — API contract and generated-client source of truth
- `lib/db/src/schema/mahjong-sessions.ts` — persistent session schema

## Architecture decisions

- Clerk owns the admin Google sign-in; browser API requests use Clerk's same-origin session cookie.
- The scoreboard and session history are public. Create, update, and delete requests require an email in the comma-separated `ADMIN_EMAILS` / `VITE_ADMIN_EMAILS` lists on both the API and client.
- Calendar game dates are stored as date-only values to avoid timezone shifts.

## Product

- Public introduction, scoreboard, cumulative totals, winner standings, and weekly history
- Admin-only creation, editing, and deletion of completed Mahjong sessions
- Persistent tracking of date, rounds, settlement amount, winner, per-player Zha Hu counts, and optional notes
- Cumulative leaderboards for match wins and Zha Hu incidents
- Cumulative player winnings use each recorded ending balance minus the $500 starting balance; legacy sessions without balances are excluded

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Re-run API codegen after editing `lib/api-spec/openapi.yaml`.
- Keep the Clerk proxy middleware mounted before Express body parsers.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
