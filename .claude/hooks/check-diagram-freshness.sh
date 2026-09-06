#!/usr/bin/env bash
# PreToolUse guard (Bash matcher): blocks `git commit` when a staged change
# touches an architecture-relevant source file but the interactive diagram
# source (docs/architecture/runtime-architecture.source.json) wasn't updated
# alongside it. Bypass with `[skip-diagram-check]` in the commit message.
set -euo pipefail

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

# Only act on commands that actually run `git commit`.
if ! printf '%s' "$command" | grep -qE '(^|[;&|]|[[:space:]])git[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

# Explicit escape hatch for changes that don't affect runtime architecture.
if printf '%s' "$command" | grep -qF '[skip-diagram-check]'; then
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root"

staged=$(git diff --cached --name-only || true)
[ -z "$staged" ] && exit 0

diagram_source="docs/architecture/runtime-architecture.source.json"

arch_paths=(
  "artifacts/mahjong-scoreboard/vite.config.ts"
  "artifacts/mahjong-scoreboard/src/App.tsx"
  "artifacts/mockup-sandbox/.replit-artifact/artifact.toml"
  "artifacts/mahjong-scoreboard/.replit-artifact/artifact.toml"
  "artifacts/api-server/.replit-artifact/artifact.toml"
  "artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts"
  "artifacts/api-server/src/app.ts"
  "artifacts/api-server/src/routes/index.ts"
  "artifacts/api-server/src/routes/requireAdmin.ts"
  "lib/db/src/index.ts"
  "lib/db/src/schema/mahjong-sessions.ts"
  "lib/integrations-gemini-ai/src/client.ts"
  "lib/api-spec/openapi.yaml"
  "lib/api-spec/orval.config.ts"
  ".replit"
)

matched=""
for p in "${arch_paths[@]}"; do
  if printf '%s\n' "$staged" | grep -qxF "$p"; then
    matched="${matched}  - ${p}"$'\n'
  fi
done

[ -z "$matched" ] && exit 0

# Diagram source was updated in the same commit — nothing to flag.
if printf '%s\n' "$staged" | grep -qxF "$diagram_source"; then
  exit 0
fi

{
  echo "Blocked: architecture-relevant file(s) are staged, but the interactive diagram source wasn't updated."
  echo
  echo "$matched"
  echo "docs/architecture/runtime-architecture.html is the canonical map new contributors (and agents) read first, and it silently drifts if the source behind it doesn't move with the code."
  echo
  echo "Before committing:"
  echo "  1. Update ${diagram_source} to reflect the change."
  echo "  2. Regenerate docs/architecture/runtime-architecture.html with the archify skill:"
  echo "       cd ~/.agents/skills/archify"
  echo "       node bin/archify.mjs deliver architecture \"${repo_root}/${diagram_source}\" \"${repo_root}/docs/architecture/runtime-architecture.html\" --quality showcase --json --repo-root \"${repo_root}\""
  echo
  echo "If this change genuinely doesn't affect runtime architecture, re-run the commit with '[skip-diagram-check]' in the commit message to bypass this check."
} >&2

exit 2
