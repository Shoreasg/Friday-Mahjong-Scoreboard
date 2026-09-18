# Friday Mahjong Scoreboard

A shared scoreboard for friends to record weekly Friday Mahjong sessions, base pots, rounds played, and who finished in profit.

## Running locally

This project runs on Replit day to day. To run the whole stack on a
contributor's own machine instead, see `docs/local-development.md` — Docker
Compose provisions Postgres, the API server, and the web app; Docker is the
only prerequisite.

## Run & Operate

- Managed workflow `artifacts/api-server: API Server` — run the API server
- Managed workflow `artifacts/mahjong-scoreboard: web` — run the main web app
- `pnpm install --frozen-lockfile` — restore the imported workspace dependencies
- `pnpm --filter @workspace/db run push` — apply the development database schema
- `pnpm --filter @workspace/db run seed` — seed fictional sessions without overwriting existing rows
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `ADMIN_EMAILS`, `VITE_ADMIN_EMAILS`
- Managed setup also provisions `AI_INTEGRATIONS_GEMINI_BASE_URL` and `AI_INTEGRATIONS_GEMINI_API_KEY`; the API imports Gemini at startup.
- Optional Telegram env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SCOREBOARD_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `docs/architecture/runtime-architecture.html` — interactive runtime architecture diagram; open this first to understand what talks to what. Source at `docs/architecture/runtime-architecture.source.json`.
- `artifacts/mahjong-scoreboard` — React web app and branded Clerk sign-in
- `artifacts/api-server/src/routes/sessions.ts` — public-read, admin-write Mahjong session API
- `lib/api-spec/openapi.yaml` — API contract and generated-client source of truth
- `lib/db/src/schema/mahjong-sessions.ts` — persistent session schema

## Architecture decisions

- Clerk owns the admin Google sign-in; browser API requests use Clerk's same-origin session cookie.
- The scoreboard and session history are public. Create, update, and delete requests require an email in the comma-separated `ADMIN_EMAILS` / `VITE_ADMIN_EMAILS` lists on both the API and client.
- Calendar game dates are stored as date-only values to avoid timezone shifts.
- The web app uses a Mahjong-inspired neo-brutalist visual system built from local Tailwind component styles: bold borders, offset shadows, saturated accents, and accessible reduced-motion behavior.
- Light and dark appearance follows the device by default, can be toggled from public screens, and persists locally across visits.

## Product

- Public introduction, scoreboard, cumulative totals, nights-in-profit standings, and weekly history
- Admin-only creation, editing, and deletion of completed Mahjong sessions
- Players are first-class records; each seat of a session references a player by id, so renaming a player (from the admin-only roster at `/app/players`) is reflected on every past session and leaderboard. Inactive players keep their history but aren't offered when recording a session
- Each session stores the base pot it was played for (prefilled at $2000, i.e. $500 each). The four whole-dollar ending amounts must sum exactly to it; the rules live in `lib/session-rules` and are enforced by both the form and the API
- Winning a night means finishing strictly above the per-player share (base pot ÷ 4), so a night can have several winners or none; session cards also show who had the largest stack
- Persistent tracking of date, rounds, base pot, per-player ending balances, Zha Hu and 谢谢 Kai Xiang counts, and optional notes
- Cumulative leaderboards for net winnings, nights in profit, Zha Hu incidents, and 谢谢 Kai Xiang occurrences
- Cumulative player winnings sum each ending balance minus that session's own per-player share; legacy sessions without balances are excluded
- Public analytics compare cumulative winnings over time, per-player win rates, and session-level Zha Hu / 谢谢 Kai Xiang activity

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Re-run API codegen after editing `lib/api-spec/openapi.yaml`.
- Schema changes that `drizzle-kit push --force` can't express safely (renames, reshaping jsonb) go in `scripts/src/migrate-session-shape.ts`, which `scripts/post-merge.sh` runs before and after the push.
- Keep the Clerk proxy middleware mounted before Express body parsers.
- If you touch an architecture-relevant file (see the path list in `.claude/hooks/check-diagram-freshness.sh`), update `docs/architecture/runtime-architecture.source.json` and regenerate `runtime-architecture.html` (see `docs/architecture/README.md`) before committing — a pre-commit hook blocks the commit otherwise.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
