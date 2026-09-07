# Spec: Local Development Environment (Docker Compose)

**Status:** ready-for-agent
**Source:** `/grill-me` session, 2026-09-07

---

## Problem Statement

Friday Mahjong Scoreboard can only be run on Replit. There is no way to run it on a
developer's own machine, and the obstacles are not obvious until you hit them one at a
time:

- The workspace deliberately strips every native binary except `linux-x64-gnu` — esbuild,
  rollup, lightningcss and the Tailwind oxide binary all have their darwin **and**
  `linux-arm64` variants removed. A plain install on an Apple Silicon Mac produces a
  toolchain that cannot build or serve anything, with no clear error explaining why.
- Node 24 and pnpm are hard prerequisites that nothing in the repo installs or checks.
- Every piece of configuration — the database URL, the Clerk keys, the admin allowlist,
  the Gemini integration credentials — is supplied by Replit's environment. None of it is
  documented as a local contract, and there is no example file to copy.
- The API server crashes at module load, before serving a single request, if the Gemini
  integration variables are absent. A developer with a perfectly good database and Clerk
  setup still gets a dead server and a stack trace pointing at an AI integration they were
  not trying to use.
- The web app calls `/api/*` as a relative path. On Replit a router unifies the two
  origins; locally there is no router, so the SPA and the API sit on different ports and
  nothing joins them.
- There is no local Postgres, no schema bootstrap, and no sample data. Even a developer
  who cleared every hurdle above would land on an empty scoreboard with blank leaderboards
  and blank analytics charts.

The result: a new contributor cannot get the app running, cannot reproduce a bug reported
against the scoreboard, and cannot exercise the admin write paths without touching the
live Replit environment and the real Mahjong session records.

## Solution

A Docker Compose stack that runs the entire application locally — Postgres, the API
server, the web app, and a database browser — where the only prerequisite is Docker and
the only startup command is `docker compose up`.

Because Docker owns the runtime, the platform problem disappears: containers run
`linux/amd64`, which is exactly what the workspace's dependency overrides target, so the
existing lockfile installs cleanly and no shared workspace configuration is touched.

The stack bootstraps itself. On `up`, it waits for Postgres to report healthy, installs
dependencies, pushes the Drizzle schema, seeds a set of fictional Mahjong sessions, and
starts both servers with hot reload. The developer edits files on their own machine and
sees the change without rebuilding anything.

Configuration becomes an explicit, documented contract: a committed `.env.example` lists
every variable, states which ones are pre-filled and which ones the developer must supply,
and a guide in `docs/` walks through obtaining the one credential that genuinely requires
an external account (a Clerk development instance).

## User Stories

### Getting started

1. As a developer cloning the repo for the first time, I want a single documented command
   to start the whole application, so that I can see it running without reverse-engineering
   the Replit configuration.
2. As a developer, I want Docker to be the only prerequisite, so that I do not have to
   install or version-manage Node and pnpm on my own machine.
3. As a developer on an Apple Silicon Mac, I want the stack to run regardless of my CPU
   architecture, so that the workspace's `linux-x64`-only dependency overrides never
   become my problem.
4. As a developer, I want a committed example environment file listing every variable the
   application reads, so that I know the complete configuration contract without grepping
   the source for `process.env`.
5. As a developer, I want the example file to distinguish variables that are pre-filled
   from variables I must supply myself, so that I know exactly how much work stands
   between me and a running app.
6. As a developer, I want my real `.env` to be ignored by git, so that I cannot
   accidentally commit a Clerk secret key.
7. As a developer, I want the guide to tell me roughly how long the first start takes and
   why, so that I do not kill an install that is merely slow under emulation.

### Running and iterating

8. As a developer, I want the web app to hot-reload when I edit a component, so that I can
   iterate on the scoreboard UI at the speed I would expect from Vite.
9. As a developer, I want the API server to restart automatically when I edit a route, so
   that I do not have to rebuild a bundle or restart a container by hand.
10. As a developer, I want changes to the shared workspace packages — the database schema,
    the generated Zod schemas, the API client — to trigger the same automatic restart, so
    that cross-package edits feel the same as local ones.
11. As a developer, I want the browser to talk to one origin only, so that relative
    `/api/*` calls work unchanged and I never have to reason about CORS during normal work.
12. As a developer signing in as an admin, I want Clerk's session cookie to be treated as
    same-origin, so that create, edit and delete behave locally exactly as they do in
    production.
13. As a developer, I want dependencies to reinstall automatically when I pull a branch
    that adds a package, so that I never debug a phantom failure caused by a stale
    `node_modules`.
14. As a developer, I want the install step to be a fast no-op when nothing has changed,
    so that self-healing does not cost me time on every restart.
15. As a developer, I want the containers to keep running when a server crashes on a
    syntax error, so that fixing the file recovers without a full `up` cycle.

### Database

16. As a developer, I want a Postgres instance provisioned by the stack, so that I never
    connect a local process to the production Replit database.
17. As a developer, I want the local Postgres major version to match the one Replit
    provisions, so that version-specific behaviour does not differ between environments.
18. As a developer, I want the database schema created automatically on start, so that the
    app is never serving 500s against tables that do not exist.
19. As a developer, I want the schema to come from the existing Drizzle definitions, so
    that there is exactly one source of truth for the `mahjong_sessions` table.
20. As a developer, I want my local database contents to survive `docker compose down`, so
    that sessions I entered by hand while testing are still there tomorrow.
21. As a developer, I want the local Postgres exposed on a non-default host port, so that
    it does not collide with another Postgres already running on my machine.
22. As a developer, I want to connect a GUI client to the local database, so that I can
    inspect rows directly when debugging.
23. As a developer without a Postgres client installed, I want a browser-based database
    browser included in the stack, so that I can inspect `mahjong_sessions` with no extra
    tooling.
24. As a developer, I want a documented way to wipe the database and start clean, so that
    I can recover from a bad experiment in one command.

### Seed data

25. As a developer, I want the local database pre-populated with fictional Mahjong
    sessions, so that the scoreboard shows something meaningful the first time I open it.
26. As a developer, I want the seeded sessions to include per-player ending balances, so
    that cumulative winnings — ending balance minus the $500 starting balance — actually
    compute instead of excluding every row as legacy data.
27. As a developer, I want the seeded sessions to include Zha Hu and 谢谢 Kai Xiang counts,
    so that both house-rule leaderboards render with real variation.
28. As a developer, I want the seeded sessions to name several different winners across
    several dates, so that the winner standings, win-rate charts and cumulative-winnings-
    over-time analytics all have a shape to draw.
29. As a developer, I want the seed to be obviously fictional, so that no real player's
    financial record is ever copied onto a laptop.
30. As a developer, I want seeding to skip when the table already has rows, so that
    restarting the stack never overwrites sessions I created by hand.
31. As a developer, I want the seed to be re-runnable on demand after a reset, so that I
    can get back to a known-good dataset deliberately.

### Authentication

32. As a developer, I want documented instructions for obtaining Clerk development keys,
    so that I can reach the admin surface without being handed someone else's credentials.
33. As a developer, I want to sign in with Google against a Clerk development instance on
    `localhost`, so that I can exercise the real authentication path rather than a stub.
34. As a developer, I want to put my own email into the admin allowlist, so that I can
    create, edit and delete sessions locally as an admin.
35. As a developer, I want the public scoreboard to be readable locally without signing in,
    so that I can work on public screens without authenticating every time.
36. As a developer, I want the Clerk proxy behaviour to stay disabled locally as it already
    is outside production, so that local sign-in does not depend on production proxy
    configuration.

### Documentation

37. As a developer, I want a dedicated local-development guide rather than a swollen
    README, so that the README stays a scannable overview.
38. As a developer, I want both the README and the Replit-facing project notes to point at
    that guide, so that I find it from wherever I happen to start reading.
39. As a developer, I want the guide to list the URL of every service the stack exposes, so
    that I know where the app, the API and the database browser are without reading the
    compose file.
40. As a developer, I want the everyday commands — typecheck, tests, schema push, API
    codegen — restated in their containerised form, so that I am not left translating the
    README's host commands myself.
41. As a developer, I want a troubleshooting section covering the failures this setup can
    realistically produce, so that I can unblock myself.
42. As a developer, I want known local limitations stated plainly up front, so that I do
    not spend an hour debugging something that was never going to work locally.
43. As a developer, I want to know how to stop the stack and how to reclaim its disk space,
    so that it does not quietly accumulate volumes.

### Verification

44. As a developer, I want a single command that checks my running stack end to end, so
    that I can confirm my setup is correct before concluding a bug is in the application.
45. As a developer, I want that check to exercise the API through the web app's proxy and
    not just directly, so that a broken proxy or a rejected origin is caught immediately
    rather than surfacing as a mysterious 403 in the browser.
46. As a maintainer, I want that check to be re-runnable later, so that a future change to
    the Postgres image or the Vite configuration cannot silently break local development.

### Non-regression

47. As a maintainer, I want Replit's runtime behaviour to be provably unchanged, so that
    adding local development cannot break the deployed scoreboard.
48. As a maintainer, I want the existing package scripts left intact, so that Replit's
    managed workflows continue to invoke exactly what they invoke today.
49. As a maintainer, I want the workspace's supply-chain and platform-override settings
    left untouched, so that the security posture and the Replit lockfile are unaffected.

## Implementation Decisions

### Platform and topology

- **Everything runs in containers**, including both application servers. Running the app on
  the host was rejected: the workspace overrides remove every native binary except
  `linux-x64-gnu`, so a host install on macOS yields a broken toolchain. Fixing that by
  restoring arm64 binaries was also rejected — it would mean editing a shared workspace
  file that governs Replit's lockfile.
- **Containers are pinned to `linux/amd64`.** On Apple Silicon this runs under emulation.
  This is the deliberate trade: correctness and a zero-diff workspace configuration, paid
  for in install speed. The performance cost is concentrated in first install, not in the
  edit–reload loop.
- **Four services**: Postgres, the API server, the web app, and a database browser. The
  `mockup-sandbox` artifact is excluded — it is not part of the product and would add
  another emulated install for no benefit.
- **Postgres major version matches the Replit-provisioned one** so version-specific
  behaviour is consistent across environments.
- **Host port mapping**: the web app on the conventional Vite port, the API on the port the
  README already documents, and Postgres on a **non-default host port** to avoid colliding
  with a Homebrew Postgres or another project's container. The container-internal Postgres
  port is unchanged, so the in-network connection string is standard.
- **Database persistence uses a named volume**, so `down` preserves data and `down -v`
  discards it. That asymmetry is the documented reset mechanism.

### Origin unification

- **The Vite dev server proxies `/api` to the API service.** This reproduces what Replit's
  router does in production: the browser sees a single origin, relative `/api/*` calls in
  the generated client work unmodified, and Clerk's session cookie remains same-origin so
  admin authentication behaves identically to production.
- Alternatives rejected: pointing the client at a second origin via the client's base-URL
  setter (its own documentation forbids that in web apps, and cross-origin cookies make
  Clerk fragile), and a dedicated reverse-proxy container (closest to production shape, but
  a third moving part to explain for no additional capability).
- **The proxy is conditional on an environment variable that only the local stack sets.**
  Replit's evaluated configuration is therefore byte-for-byte unchanged. This guard is the
  central non-regression mechanism and must not be replaced with a `NODE_ENV` check —
  Replit also runs the dev server with `NODE_ENV` unset.
- **Known risk to verify empirically:** the API applies a trusted-origin check that compares
  the request's `Origin` against its `Host`. Vite's proxy does not rewrite the `Host` header
  by default, so the two should match and the check should pass. If it does not, the
  fallback is the existing comma-separated allowed-origins variable, which the example env
  file will carry pre-filled. This must be confirmed by actually signing in and performing
  an admin write, not by reading the code.

### Dependency handling

- The repository is **bind-mounted** into the containers so edits on the host are seen
  immediately.
- Because pnpm workspaces place a `node_modules` at the repository root *and* inside every
  package, the bind mount would shadow all of them. **Each `node_modules` path is masked
  with its own anonymous volume** — root, every artifact, every library, and the scripts
  package — so container-installed Linux dependencies survive.
- **Install runs on every start**, using the frozen lockfile. It is effectively
  instantaneous when the volume is warm, and it self-heals after pulling a branch that
  changes dependencies. A one-time install at image-build time was rejected because it
  produces a silent, confusing failure mode on branch switches.
- **The existing lockfile is used as-is.** It was generated for `linux-x64`, which is
  exactly the container platform, so a frozen install is expected to succeed unmodified.
- **pnpm is provided via corepack.** The repository declares no `packageManager` field and
  the lockfile is version 9, which pnpm 10 also reads; the implementation should pin a
  version explicitly and fall back if the frozen install rejects it.

### Startup sequence

The API service's startup is ordered and gated:

1. Wait for Postgres to report healthy via a container healthcheck — not a fixed sleep.
2. Install dependencies with the frozen lockfile.
3. Push the Drizzle schema to the database.
4. Run the seed.
5. Start the API server in watch mode.

**Schema is applied automatically on start** rather than as a documented manual step, so
that `docker compose up` is genuinely the whole instruction. Push is idempotent, so
repeated starts are no-ops. Generating standalone initialisation SQL was rejected: it would
create a second source of truth for the same table.

### Watch mode

- **A new watch script is added to the API server package**; the existing script is left
  untouched so whatever Replit's workflow invokes keeps working.
- The watcher runs the TypeScript sources directly rather than rebuilding the esbuild
  bundle. Because the shared workspace packages export TypeScript source, edits to the
  database schema, the generated Zod schemas and the API client all trigger a restart too.
- **Accepted divergence:** local development runs unbundled TypeScript while Replit runs
  the esbuild output. Bundling-specific problems will not be caught locally. This is
  accepted in exchange for a fast reload loop under emulation.

### Seed data

- A new seed script lives with the database package, alongside the existing schema-push
  script.
- **The seed is idempotent by table emptiness**: if `mahjong_sessions` has any rows, it
  does nothing. This guarantees that restarting the stack never destroys sessions the
  developer entered by hand.
- **Seeded records must populate `playerBalances` in full** — name, ending amount, Zha Hu
  count and 谢谢 Kai Xiang count for each player. Sessions without ending balances are
  excluded from the cumulative winnings calculation, so a balance-less seed would leave the
  main leaderboard empty and defeat the purpose.
- The set should span **multiple dates with several different winners**, so the winner
  standings, per-player win rates and cumulative-winnings-over-time analytics all render
  with visible variation.
- **All player names and figures are fictional.** Copying production data to developer
  machines was explicitly rejected.

### Configuration contract

A single environment file at the repository root, git-ignored, with a committed example.
Compose passes it to the containers as process environment; Vite exposes the
prefixed variables to the client from the process environment, which is the same mechanism
Replit's shared user environment already relies on.

Variables split into three groups, and the example file must label them as such:

- **Pre-filled, no editing needed** — the database connection string pointing at the
  in-network Postgres, the server port and base path consumed by the Vite configuration,
  and the local proxy guard variable.
- **Developer must supply** — the Clerk publishable and secret keys from a *development*
  instance, and the admin email allowlists (both the server-side and client-side
  variables), which the developer sets to their own Google account address so they can
  exercise admin writes.
- **Placeholders that only exist to satisfy startup validation** — the Gemini integration
  base URL and API key.

### The Gemini startup crash

The API server imports the Gemini integration eagerly through the chip-scan route, and that
integration throws at module load when its variables are absent — so the server cannot boot
at all without them, regardless of whether chip scanning is ever used.

**Decision: supply placeholder values in the example environment file.** No application code
changes. The consequence is that the chip scanner fails at call time with an authentication
error from the AI provider, and this is documented explicitly as a known local limitation
so it is never mistaken for a bug.

Rejected: making the integration client lazily constructed. It is a better failure mode — a
clean unavailable response instead of a boot crash — but it modifies a shared library and
removes deliberate fail-fast validation that is doing useful work in production. Also
rejected: requiring a real AI provider key, which would make an unrelated billable account
a hard prerequisite for running a scoreboard.

### Clerk

- The developer supplies keys from a **Clerk development instance**. Development instances
  permit `localhost` origins, and the Clerk proxy middleware is already a no-op outside
  production, so no code change is needed for local sign-in to work.
- The guide must walk through obtaining these keys, including which key goes into which of
  the three Clerk variables the application reads.
- Sharing this project's existing keys was rejected — it makes the instructions unusable
  for a fresh clone.

### Documentation

- A dedicated local-development guide under `docs/`, with short pointer sections added to
  both the README and the Replit-facing project notes so neither can go stale silently.
- The guide covers: prerequisites, obtaining Clerk keys, the environment file, the single
  start command, the URL of every service, the containerised form of the everyday commands,
  the verification command, the reset flow, teardown, troubleshooting, and known local
  limitations.
- **Known limitations must be stated up front**, not buried: chip scanning does not work
  locally, and first start is slow because of `amd64` emulation.

### Commit hygiene

The change to the web app's Vite configuration falls under the architecture-diagram
freshness hook's watchlist, which blocks commits touching it unless the diagram source is
updated in the same commit. Because the proxy is guarded so that production runtime is
genuinely unchanged, **the commit uses the hook's documented escape hatch** rather than
churning the runtime diagram. This is exactly the case the escape hatch exists for.

Rejected: extending the runtime architecture diagram, which would mix deployment-environment
concerns into a document that currently describes one production runtime; and authoring a
second local-development diagram, which is worth doing later but is not part of this change.

## Testing Decisions

### What makes a good test here

This is infrastructure. Nothing that can break in it — image build, dependency install,
schema push, seeding, the proxy, the origin check — exists until the stack is running.
Tests that assert on the *contents* of a compose file or a Dockerfile would test the
implementation rather than the behaviour, and would break on every harmless refactor while
catching nothing real.

The behaviour under test is therefore: **after `docker compose up`, does the stack actually
serve a working application?** That question is answered entirely at the HTTP boundary of
the running stack, which is the highest available seam and the only one this feature
introduces.

### The seam

**One seam: the running stack's HTTP surface.** A smoke script, runnable on demand, asserts:

1. The API's health endpoint responds successfully — proves the API container installed,
   booted past the Gemini validation, and is listening.
2. The web app's root serves the SPA document — proves the web container installed and the
   dev server is up.
3. The sessions endpoint returns a non-empty collection — proves the schema push and the
   seed both ran against a reachable database.
4. **The sessions endpoint fetched through the web app's origin returns the same payload as
   fetching it directly from the API.** This is the load-bearing assertion: it exercises the
   Vite proxy and the API's trusted-origin check together, which is precisely the risk
   flagged during design. A regression here is otherwise invisible until someone opens a
   browser.
5. Running the seed a second time leaves the row count unchanged — proves idempotency, and
   therefore that a restart cannot destroy hand-entered sessions.

Everything else is covered transitively: if the platform, the lockfile install, the
healthcheck gating, the schema push or the seed were broken, at least one of these
assertions fails.

### What stays manual

- **Clerk sign-in and admin create/edit/delete.** These require real development credentials
  that cannot live in the repository. The guide carries a short manual verification
  checklist covering: signing in with Google, creating a session, seeing it appear on the
  scoreboard, editing it, deleting it, and confirming a non-allowlisted account is refused.
- **Hot reload.** Verified by editing a file and observing the browser or the server
  restart; automating it would cost far more than it returns.

### Modules under test

Only the composed stack. No new unit tests. Adding a test runner to the database package to
test seed idempotency in isolation was considered and rejected: it introduces a second seam
to cover behaviour the smoke script already covers at a higher level.

### Prior art

The API server's existing route tests are the closest pattern in the repository — they boot
the real application on an ephemeral HTTP server and drive it over HTTP, mocking only the
database and the authentication provider. The smoke script follows the same instinct (assert
over HTTP, against the real application) at a level higher: no mocks at all, and a real
database.

Note that these existing tests cannot verify this feature. They mock the database entirely
and never construct a proxy request, so every failure mode this spec is concerned with is
outside their reach.

## Out of Scope

- **Changing the workspace's platform overrides** to restore arm64 native binaries. It would
  make the stack run natively and considerably faster on Apple Silicon, but it edits shared
  configuration that governs Replit's lockfile. Worth revisiting separately if emulation
  proves too slow in practice.
- **Making the Gemini integration client lazy**, so that chip scanning degrades gracefully
  instead of blocking startup. A genuine improvement, deliberately deferred to keep this
  change's blast radius inside local development.
- **Containerising the `mockup-sandbox` artifact.**
- **Any production-shaped local build.** The stack is a development environment only; there
  is no local path that exercises the esbuild bundle or a built SPA.
- **CI integration.** The repository has no CI configuration today, and none is added.
- **Database migrations.** The project uses schema push with no migration history, and this
  change does not alter that.
- **Restoring production data locally**, by dump or otherwise.
- **A local-development architecture diagram.** The compose topology is worth drawing, but
  it is a separate deliverable.
- **Making chip scanning work locally.**
- **Windows and Linux host instructions.** The guide targets macOS, which is the only host
  in evidence; nothing in the design should prevent other hosts from working.

## Further Notes

### Why the platform constraint is the root of the design

Almost every decision here traces back to one line of shared configuration: the workspace
strips all native binaries except `linux-x64-gnu`. That single fact rules out running the
app on the host, rules out arm64 containers, and forces emulation on Apple Silicon. It is
worth stating explicitly in the guide, because a developer who discovers it independently
will otherwise assume the emulation pinning is an oversight and "fix" it.

### The non-regression guarantee

The correctness bar for this change is that Replit's behaviour is identical afterwards. Three
mechanisms enforce it, and each should be checked before the change is considered done: the
Vite proxy is gated behind a variable only the local stack sets; the API's existing scripts
are added to rather than modified; and the workspace configuration file is not touched at
all.

### Sequencing

Not broken into separate tickets — the work is one cohesive unit that fits a single working
session, and a partially built stack is not independently demoable. The natural build order
is nonetheless: Postgres with schema push and seed → API container reaching a green health
check → web container with the working proxy → smoke script → documentation.

### Follow-ups worth filing later

- Lazy Gemini client, so chip scanning returns a clean unavailable response locally.
- Restore arm64 native binaries, if emulated install times prove painful in daily use.
- A local-development topology diagram alongside the runtime architecture diagram.
