# Shared base image for the local-development API and web containers. It
# only provides the toolchain (Node, pnpm) — the repository itself is
# bind-mounted at runtime by docker-compose.yml, not copied in here, so
# editing source or the entrypoint scripts never requires a rebuild.
FROM --platform=linux/amd64 node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm is provided via corepack rather than a pinned base-image feature, so a
# missing/rejected corepack fetch of the pinned version falls back to a
# floating one in the same major line instead of failing the build outright.
RUN npm install -g corepack@latest \
    && corepack enable \
    && (corepack prepare pnpm@10.15.1 --activate || corepack prepare pnpm@10 --activate)

WORKDIR /workspace
