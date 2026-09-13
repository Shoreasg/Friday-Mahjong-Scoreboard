// Real-Postgres coverage for the invariants the mocked unit tests can't
// prove: the DB-level case/whitespace-insensitive uniqueness index, and
// that concurrent writers actually serialize on PLAYER_WRITE_LOCK_KEY.
//
// Requires a live database — run via `pnpm --filter @workspace/scripts run
// test:integration` against docker compose's Postgres (or any DATABASE_URL
// with the players table already migrated). Not part of the default
// `pnpm test` run; see scripts/vitest.config.ts.
import { afterAll, describe, expect, it } from "vitest";
import { db, playersTable, pool } from "@workspace/db";
import { PLAYER_WRITE_LOCK_KEY } from "@workspace/session-rules";
import { like, sql } from "drizzle-orm";

const TEST_NAME_PREFIX = "__integration_test__";

afterAll(async () => {
  await db.delete(playersTable).where(like(playersTable.name, `${TEST_NAME_PREFIX}%`));
  await pool.end();
});

describe("players table uniqueness (real Postgres)", () => {
  it("rejects a case/whitespace variant of an existing name via onConflictDoNothing", async () => {
    const canonicalName = `${TEST_NAME_PREFIX}Sam ${Date.now()}`;
    const [created] = await db
      .insert(playersTable)
      .values({ name: canonicalName })
      .onConflictDoNothing()
      .returning();
    expect(created).toBeDefined();

    const variantName = `  ${canonicalName.toUpperCase()}  `;
    const [conflicting] = await db
      .insert(playersTable)
      .values({ name: variantName })
      .onConflictDoNothing()
      .returning();
    expect(conflicting).toBeUndefined();

    const rows = await db
      .select()
      .from(playersTable)
      .where(sql`lower(trim(${playersTable.name})) = lower(trim(${canonicalName}))`);
    expect(rows).toHaveLength(1);
  });
});

describe("PLAYER_WRITE_LOCK_KEY advisory lock (real Postgres)", () => {
  it("blocks a second holder until the first transaction ends", async () => {
    const holder = await pool.connect();
    const contender = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock($1)", [PLAYER_WRITE_LOCK_KEY]);

      await contender.query("BEGIN");
      const blocked = await contender.query(
        "SELECT pg_try_advisory_xact_lock($1) AS acquired",
        [PLAYER_WRITE_LOCK_KEY],
      );
      expect(blocked.rows[0]?.acquired).toBe(false);
      await contender.query("COMMIT");

      await holder.query("COMMIT");

      await contender.query("BEGIN");
      const unblocked = await contender.query(
        "SELECT pg_try_advisory_xact_lock($1) AS acquired",
        [PLAYER_WRITE_LOCK_KEY],
      );
      expect(unblocked.rows[0]?.acquired).toBe(true);
      await contender.query("COMMIT");
    } finally {
      holder.release();
      contender.release();
    }
  });
});
