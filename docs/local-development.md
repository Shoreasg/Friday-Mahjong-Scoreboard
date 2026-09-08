# Local development

Run the whole app — Postgres, the API server, and the web app — on your own
machine with Docker Compose. This is the only supported way to run the
project outside Replit.

## Known limitations (read this first)

- **Chip scanning does not work locally.** The API server imports the Gemini
  integration eagerly, and it throws at boot if its credentials are absent —
  so the stack ships placeholder values just to let the server start. Chip
  scanning itself will fail at call time with an authentication error from
  the AI provider. This is expected, not a bug.
- **First start is slow.** The containers run `linux/amd64` so the
  workspace's linux-x64-only dependency overrides apply unmodified. On Apple
  Silicon that means emulation. Expect the first `docker compose up` to take
  several minutes while it installs the whole pnpm workspace under emulation;
  subsequent starts reuse that work and are fast. Let it finish — a slow
  first install is not a hang.
- **Windows and Linux hosts aren't covered here.** This guide targets macOS.
  Nothing about the design should prevent other hosts from working, but it
  hasn't been verified on them.

## Prerequisites

Docker (with Compose) is the only thing you need to install. You do not need
Node or pnpm on your machine — both run inside the containers.

## 1. Get Clerk development keys

Sign-in is real Clerk authentication, not a stub, so you need your own Clerk
*development* instance:

1. Create a free account at [clerk.com](https://clerk.com) and create a new
   application (or reuse an existing development instance).
2. Enable **Google** as a sign-in method (Configure → SSO connections).
3. From **API Keys**, copy:
   - The **Publishable key** (`pk_test_...`) → goes into both
     `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` in `.env`.
   - The **Secret key** (`sk_test_...`) → goes into `CLERK_SECRET_KEY`.

Development instances permit `localhost` origins out of the box, so no
further Clerk configuration is needed.

## 2. Configure your environment

```sh
cp .env.example .env
```

Open `.env` and fill in the "you must supply" section: the three Clerk
variables above, and `ADMIN_EMAILS` / `VITE_ADMIN_EMAILS` — set both to your
own Google account's email address so you can sign in and exercise admin
create/edit/delete locally. Everything else in the file already works.

`.env` is git-ignored — it will never end up in a commit.

## 3. Start the stack

```sh
docker compose up
```

That's the whole instruction. On first run it will:

1. Start Postgres and wait for it to report healthy.
2. Install the pnpm workspace with a frozen lockfile.
3. Push the Drizzle schema.
4. Seed the database with fictional Mahjong sessions (skipped if the table
   already has rows, so this never overwrites data you've entered by hand).
5. Start the API server and the web app with hot reload.

## Where everything is

| Service | URL |
| --- | --- |
| Web app | http://localhost:5173 |
| API server | http://localhost:5000 |
| Postgres | `localhost:5433` (see `.env` for credentials) |
| Adminer (DB browser) | http://localhost:8080 |

To log into Adminer: System `PostgreSQL`, Server `postgres`, Username
`mahjong`, Password `mahjong`, Database `mahjong` (or whatever you changed
`DATABASE_URL` to).

## Everyday commands

Run these while the stack is up:

```sh
# Typecheck everything
docker compose exec api pnpm run typecheck

# Run the API server's tests
docker compose exec api pnpm --filter @workspace/api-server run test

# Run the web app's tests
docker compose exec web pnpm --filter @workspace/mahjong-scoreboard run test

# Re-push the DB schema after changing lib/db/src/schema
docker compose exec api pnpm --filter @workspace/db run push

# Regenerate the API client/Zod schemas after editing the OpenAPI spec
docker compose exec api pnpm --filter @workspace/api-spec run codegen

# Re-seed on demand (no-op if the table already has rows)
docker compose exec api pnpm --filter @workspace/db run seed
```

Editing a file on your host is picked up automatically: the web app
hot-reloads through Vite, and the API server restarts through its own watch
mode. If a container crashes on a syntax error, fixing the file recovers it —
you don't need to restart anything.

## Verifying your setup

A smoke check exercises the running stack end to end — the API's health
endpoint, the web app's root document, the seeded sessions, and (the
important one) that a request routed through the web app's Vite proxy
returns the same thing as hitting the API directly. Run it any time you want
to confirm the setup is correct before chasing a bug in the application
itself:

```sh
docker compose exec web pnpm --filter @workspace/scripts run smoke
```

It also re-runs the seed and confirms the row count doesn't change, proving
seeding is safe to repeat.

## Manual checks that can't be automated

The smoke check above can't exercise real Clerk sign-in (that needs your own
credentials), so confirm this by hand once:

1. Open http://localhost:5173 and confirm the public scoreboard loads
   without signing in.
2. Sign in with Google using the account you put in `ADMIN_EMAILS`.
3. Create a session, confirm it appears on the scoreboard, edit it, then
   delete it.
4. Sign in with a different Google account (not in `ADMIN_EMAILS`) and
   confirm admin actions are refused.

## Resetting and stopping

```sh
# Stop the stack; the database and installed dependencies are preserved
docker compose down

# Stop the stack and wipe everything, including the database — the
# next `up` starts completely fresh
docker compose down -v
```

## Troubleshooting

- **Port already in use.** Change the conflicting port in `.env`
  (`WEB_PORT`, `API_PORT`, `POSTGRES_HOST_PORT`, or `ADMINER_PORT`) and
  restart. On macOS, port `5000` is commonly held by the AirPlay Receiver —
  turn it off in System Settings → General → AirDrop & Handoff, or just pick
  a different `API_PORT`.
- **"Missing VITE_CLERK_PUBLISHABLE_KEY" in the browser.** `.env` is missing
  a value, or the web container needs a restart to pick up a change:
  `docker compose up -d web`.
- **Admin sign-in works but writes return 403.** Your signed-in email isn't
  in `ADMIN_EMAILS` / `VITE_ADMIN_EMAILS`, or they're out of sync with each
  other — both must list the same address.
- **Chip scanning fails with an authentication error.** Expected — see
  Known limitations above.
- **A branch you pulled won't build / a package seems missing.**
  Dependencies are installed fresh on every `docker compose up`, so this
  should self-heal automatically. If it doesn't, force a clean install:
  `docker compose down && docker compose up`.
- **First `up` seems stuck on `Installing dependencies`.** This is expected
  under `linux/amd64` emulation on Apple Silicon — see Known limitations.
  Let it run; it can take several minutes the first time.
