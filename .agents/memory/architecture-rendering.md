---
name: Architecture rendering
description: Local repository requirements for regenerating Archify architecture HTML.
---

Archify architecture delivery validates repository evidence against a full 40-character Git revision and expects the local repository to expose an `origin` remote. Replit checkouts may use a different remote name, so a temporary local-only origin alias can be used during rendering and removed afterward.

**Why:** The renderer rejects missing origin remotes, short revisions, and source paths that do not exist at the pinned revision.

**How to apply:** Generate the implementation commit containing new source files first, pin the architecture source to that full commit SHA, render the HTML, then commit the generated artifact separately.