---
name: CLI upgrades
description: Version and PATH pitfalls when upgrading workspace command-line tools.
---
Verify both the resolved executable and its version after installing a CLI.

**Why:** Adding GitHub CLI as a Nix dependency exposed an older version ahead of the checksum-verified official release in the workspace-local tool path.

**How to apply:** Prefer managed packages first, but compare against the requested upstream version. If using an official release binary, verify its published checksum and remove any newly added older package that shadows it. Check authenticated access without printing credentials. Workspace-local binary installs are not reproducible from a Git clone alone.