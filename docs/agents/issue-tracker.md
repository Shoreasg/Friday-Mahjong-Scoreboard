# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Epics & project board (this repo)

Two epics track all work, each a GitHub issue labeled `epic`:

- **#3 `project-system-improvement`** — infra, dev tooling, backend, auth/admin, build/deploy, and other system-facing work.
- **#4 `ux-improvement`** — user-facing UI/UX, product features, accessibility, mobile experience.

When creating a new ticket, decide which epic it belongs to and create it as a sub-issue of that epic:

```
gh issue create --parent 3 --title "..." --body "..."   # project-system-improvement
gh issue create --parent 4 --title "..." --body "..."   # ux-improvement
```

**Project board**: https://github.com/users/Shoreasg/projects/2 (project number 2, owned by `Shoreasg`). Note this is owned by a different GitHub account than most repo collaborators — a user-owned GitHub Project can only be created or have its fields/settings administered by its owner (`Shoreasg`); collaborators need to be added as **project collaborators** separately from repo access (Project → Settings → Manage access), which is a distinct permission system from repo collaborator access.

Add a new ticket to the board once created:

```
gh project item-add 2 --owner Shoreasg --url <issue-url>
```

**Status field values**: `Backlog` / `Ready` / `In progress` / `In review` / `Done`.

Set `Ready` when a ticket is fully groomed and postable — this is the board's equivalent of the `ready-for-agent` label. Apply both together when a ticket is ready for an agent to pick up: the label (for `gh issue list --label ready-for-agent` style queries) and the Status field (for the board view).

Set status via node IDs — name-based `--field`/`--value` lookup (`gh project item-edit ... --field "Status" --value "Ready"`) has shown transient "not an item in project" errors immediately after `item-add`; retry with explicit node IDs if that happens:

```
gh project item-edit --id <item-id> --project-id "PVT_kwHOBNS9rM4BjPqD" \
  --field-id "PVTSSF_lAHOBNS9rM4BjPqDzhiEvhM" --single-select-option-id <option-id>
# Backlog=f75ad846  Ready=61e4505c  In progress=47fc9ee4  In review=df73e18b  Done=98236657
```

The item's own id (`--id`) comes from `gh project item-add`'s output, or from `gh project item-list 2 --owner Shoreasg --format json`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
