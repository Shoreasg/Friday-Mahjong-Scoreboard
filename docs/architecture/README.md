# Runtime architecture diagram

`runtime-architecture.html` is a self-contained, interactive diagram of how this system talks to itself at runtime: 11 components across the SPA, the API server, Clerk auth, Postgres, Gemini, and the build-time OpenAPI contract, plus 12 relationships between them.

**Open it:** download or clone the repo and open `runtime-architecture.html` directly in a browser (GitHub renders `.html` files as source, not as a page — there's no way to view it live from the GitHub UI). It has:

- Light/dark theme toggle, pan/zoom, and search
- Relationship tracing and three guided walkthroughs: session request path, Clerk identity, and the build-time contract
- PNG/SVG export

`runtime-architecture.source.json` is the diagram's source of truth — an [archify](https://github.com/tt-a1i/archify) `architecture` spec. It cites the exact source files behind each component (`sources[].path`), so it doubles as a map from "box on the diagram" to "code that backs it."

## Keeping this current

This diagram is meant to be the first thing a reader (human or agent) opens to understand the system. A [pre-commit guard](../../.claude/hooks/check-diagram-freshness.sh) blocks commits that touch an architecture-relevant file (see the path list in that script) without also touching `runtime-architecture.source.json`, so it shouldn't go stale silently. If you hit that block:

1. Edit `runtime-architecture.source.json` to reflect the change (add/move/relabel a component, connection, or `sources` entry).
2. Regenerate the HTML with the archify CLI:
   ```
   cd ~/.agents/skills/archify   # or wherever archify is installed
   node bin/archify.mjs deliver architecture \
     path/to/runtime-architecture.source.json \
     path/to/runtime-architecture.html \
     --quality showcase --json --repo-root /path/to/this/repo
   ```
3. Commit both files together.

If a change genuinely doesn't affect runtime architecture (e.g. a copy tweak in a file that's merely *listed* as a source), include `[skip-diagram-check]` in the commit message to bypass the guard.
