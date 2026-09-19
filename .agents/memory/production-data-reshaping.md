---
name: Production data reshaping
description: Safe release process when a managed production database needs both schema and row-content transformations.
---

For schema changes that also reshape existing row contents, first stage a read-only production snapshot in development, run the project migration there, and validate all references before publishing with data overwrite.

**Why:** Replit Publish applies schema diffs but does not run the project's custom data-reconciliation scripts against production. Publishing only the schema can leave live rows incompatible with the new application, while overwriting from unrelated development fixtures loses real data.

**How to apply:** Back up both environments temporarily, replace development fixtures with the live snapshot, run the normal development migration sequence, verify counts and referential integrity, then use Publish's overwrite-data option. Never add production DDL or startup migrations.