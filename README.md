# Friday Mahjong Scoreboard

A shared scoreboard for a friend group to record weekly Friday Mahjong sessions: date, rounds played, settlement amounts, per-player ending balances, the winner, and two house-rule counters — **Zha Hu** (诈胡) and **谢谢开相 / Kai Xiang**.

Reading the scoreboard is public. Creating, editing, and deleting sessions is admin-only, gated by Google sign-in through Clerk plus an email allowlist.

## Architecture

**Start here to understand how the system fits together:** [`docs/architecture/runtime-architecture.html`](docs/architecture/runtime-architecture.html) — an interactive diagram of every runtime component (SPA, API server, Clerk auth, Postgres, Gemini, the build-time OpenAPI contract) and how they talk to each other. It has a light/dark toggle, pan/zoom, search, and guided walkthroughs of the main request paths.

GitHub shows `.html` files as source rather than rendering them, so open it locally after cloning. See [`docs/architecture/README.md`](docs/architecture/README.md) for details, and for how to keep it up to date — a repo hook checks for this automatically (below).

## Running locally

The app normally runs on Replit. To run it on your own machine, see
[`docs/local-development.md`](docs/local-development.md) — Docker is the
only prerequisite; `docker compose up` starts Postgres, the API server, and
the web app together.

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

- `docs/architecture` — the interactive runtime architecture diagram and its source
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

- Public introduction, scoreboard, cumulative totals, winner standings, and weekly history
- Admin-only creation, editing, and deletion of completed Mahjong sessions
- Persistent tracking of date, rounds, settlement amount, winner, per-player Zha Hu and 谢谢 Kai Xiang counts, and optional notes
- Cumulative leaderboards for net winnings, match wins, Zha Hu incidents, and 谢谢 Kai Xiang occurrences
- Cumulative player winnings use each recorded ending balance minus the $500 starting balance; legacy sessions without balances are excluded
- Public analytics compare cumulative winnings over time, per-player win rates, and session-level Zha Hu / 谢谢 Kai Xiang activity

## Gotchas

- Re-run API codegen after editing `lib/api-spec/openapi.yaml`.
- Keep the Clerk proxy middleware mounted before Express body parsers.
- After editing an architecture-relevant file (see the list in `.claude/hooks/check-diagram-freshness.sh`), update `docs/architecture/runtime-architecture.source.json` and regenerate the HTML — a commit hook enforces this for AI agents working in this repo (see `docs/architecture/README.md`).

## For AI agents working in this repo

See `replit.md` for the AI-agent-facing project brief (run commands, gotchas, pointers). The [interactive architecture diagram](docs/architecture/runtime-architecture.html) is the canonical map of the system — read it before making structural changes, and keep it current per `docs/architecture/README.md`.
