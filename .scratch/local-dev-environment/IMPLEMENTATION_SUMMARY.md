# Implementation Summary: Docker Compose Local Development Environment

Implements `.scratch/local-dev-environment/spec.md` in full. Committed to
`feat/local-dev-docker` as `83840b1` (local only, not pushed).

## What was built

**The stack** (`docker-compose.yml`, `docker/`): four services — Postgres 16
(matching Replit's provisioned version), the API server, the web app, and
Adminer as a browser-based DB inspector. `docker compose up` is the entire
instruction: it waits for Postgres's healthcheck, installs the pnpm
workspace with a frozen lockfile, pushes the Drizzle schema, seeds fictional
sessions (skipped if the table already has rows), and starts both servers.

Both Node services share one Dockerfile that only provides the toolchain
(Node 24, pnpm via corepack, pinned to `linux/amd64` in the `FROM` line); the
repo itself is bind-mounted at runtime, so editing source or the entrypoint
scripts never needs a rebuild. Every `node_modules` path in the workspace
(root, every artifact, every `lib` package, `scripts`) is masked with its
own named volume in both containers, so the bind mount never shadows
container-installed Linux binaries — this is what makes it safe to run on
Apple Silicon despite the workspace's linux-x64-only dependency overrides.

**Origin unification** (`vite.config.ts`): Vite proxies `/api` to the API
service, gated behind `LOCAL_DEV_API_PROXY_TARGET` — an environment variable
only the local stack sets. Replit's evaluated configuration is unaffected
because it never sets that variable, and this was verified rather than
assumed (see below).

**Watch mode** (`artifacts/api-server/watch.mjs`, new `watch` script): the
API server runs its TypeScript source directly via `tsx`, so edits to it and
to the workspace packages it imports (`@workspace/db`, `@workspace/api-zod`,
`@workspace/integrations-gemini-ai`) trigger a restart. The existing `dev`
script (build + run the esbuild bundle) is untouched.

**Seed data** (`lib/db/src/seed.ts`, new `seed` script): eight fictional
sessions across four fictional core players (plus two one-off substitutes)
spanning June–July 2026, with full player balances, varying Zha Hu / Xie Xie
Kai Xiang counts, and four different winners, so every leaderboard and chart
has real variation. Idempotent by table emptiness.

**Configuration contract** (`.env.example`): variables grouped and labeled
as pre-filled, developer-supplied (Clerk keys, admin allowlists), or
placeholder-only (the Gemini integration, which crashes the server at
import time if absent — documented as a known limitation rather than
patched, per the spec's decision).

**Verification** (`scripts/src/smoke-local-stack.ts`, new `smoke` script):
runs from inside the web container and checks, over HTTP: the API health
endpoint, the web app's SPA root, that the sessions endpoint has seeded
rows, that a request through the web app's Vite proxy (with a real `Origin`
header) returns the identical payload to calling the API directly, and that
re-running the seed leaves the row count unchanged.

**Documentation**: `docs/local-development.md` (prerequisites, obtaining
Clerk keys, the env file, service URLs, containerized everyday commands,
verification, reset/teardown, troubleshooting, known limitations up front),
with one-paragraph pointers added to `README.md` and `replit.md`.

## Two real bugs found and fixed via live testing

I ran the actual stack against a live Docker daemon rather than relying on
static review, which surfaced two design flaws the spec's own risk analysis
didn't anticipate:

1. **The fallback pnpm version doesn't work.** The spec called for pinning
   pnpm 10 and falling back to a different version if the frozen install
   rejects it. Pinning the fallback to pnpm 9 (a natural first guess, since
   the lockfile is nominally "version 9") actually fails with
   `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` — pnpm 9 and 10 hash the
   `pnpm-workspace.yaml` `overrides` block differently. The entrypoint
   scripts instead fall back to `pnpm install --no-frozen-lockfile` under
   the *same* pinned version, which self-heals without fighting that hash.
   Verified working live.

2. **tsx's built-in `--watch` doesn't fire on this bind mount.** Editing a
   route file produced zero restarts. tsx's watch mode uses Node's native
   recursive `fs.watch` (inotify on Linux), which several Docker
   filesystem-sharing backends don't propagate reliably for bind mounts —
   confirmed here by testing `CHOKIDAR_USEPOLLING` (no effect; tsx doesn't
   actually depend on chokidar) and by inspecting tsx's own `package.json`.
   Replaced with `watch.mjs`, a ~90-line polling-based supervisor with no
   new dependency: it spawns `tsx src/index.ts` as a child, polls mtimes
   across the watched directories every 500ms, and restarts the child on
   change. Verified live: detects an edit, restarts, survives a syntax-error
   crash (container keeps running, logs "waiting for a file change"), and
   recovers automatically once the file is fixed — satisfying the spec's
   crash-resilience story regardless of the host's filesystem-sharing
   backend, rather than only on the ones where inotify happens to propagate.

## What was actually verified live

Using this machine's own Docker daemon (after fixing a missing
`docker compose` plugin and a separate container-runtime bug where passing
`platform:` on a locally-built image intermittently made the image
untaggable — worked around by pinning the platform in the Dockerfile's
`FROM` line instead, which is arguably cleaner anyway):

- Image builds, including the corepack pnpm-pinning logic.
- The full install → push → seed → serve sequence, via container logs.
- Schema push idempotency (`No changes detected` on repeat) and seed
  idempotency (`already has rows — skipping`) across `down`/`up` cycles,
  proving the named-volume persistence design.
- `GET /api/healthz` and `GET /api/sessions` against the real seeded data.
- Hot reload and crash recovery for the API (both bugs above found here).
- The web app serving the SPA document via Vite.
- **The load-bearing assertion**: a proxied request with a real `Origin`
  header returns byte-identical JSON to a direct API request, *and* a
  mismatched `Origin` is still rejected with 403 through the proxy —
  confirming the trusted-origin check and the Vite proxy genuinely
  cooperate, not just that the check was accidentally bypassed.
- The smoke script itself, run via `docker compose exec web pnpm --filter
  @workspace/scripts run smoke` (2 of 5 checks observed passing before the
  test VM's memory ceiling took down a container mid-run — see caveat).
- Full workspace typecheck (`pnpm run typecheck`, run serially) and the
  existing `api-server` test suite (32 tests) — both pass unchanged.

**Caveat**: this validation ran inside a sandboxed Docker backend with only
~1.9GB of RAM, which could not sustain Postgres + both Node containers
running their installs simultaneously without an OOM kill — this happened
repeatedly and is why several checks above were validated one service at a
time rather than as one continuous `docker compose up` session. This is a
resource ceiling specific to that test environment, not a defect in the
design; a normal development machine has far more headroom. I was not able
to complete one uninterrupted full-stack run or a full clean pass of the
smoke script in that environment. Recommend running `docker compose up`
followed by the smoke script on a real machine to confirm.

## Manual verification still needed (documented, not automated)

Real Clerk sign-in and the admin write path can't be exercised without your
own Clerk development credentials. `docs/local-development.md` has a short
checklist: sign in with Google, create/edit/delete a session, confirm a
non-allowlisted account is refused.

## Out of scope (per spec, unchanged)

Restoring arm64 native binaries, a lazy Gemini client, containerizing
`mockup-sandbox`, CI integration, database migrations, restoring production
data, and a local-development architecture diagram.
