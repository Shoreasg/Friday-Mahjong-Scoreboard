// Real-Postgres coverage for the invariants the mocked unit tests can't
// prove: the DB-level case/whitespace-insensitive uniqueness index,
// PLAYER_WRITE_LOCK_KEY actually serializing concurrent writers, the
// fail-closed duplicate-reconciliation default, backfill repeatability,
// transaction rollback on failure, and concurrent first-time player
// creation.
//
// Requires a live database — run via `pnpm --filter @workspace/scripts run
// test:integration` against docker compose's Postgres (or any DATABASE_URL
// with the players table already migrated). Not part of the default
// `pnpm test` run; see scripts/vitest.config.ts.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db, mahjongSessionsTable, playersTable, pool } from "@workspace/db";
import { PLAYER_WRITE_LOCK_KEY } from "@workspace/session-rules";
import { eq, inArray, like, sql } from "drizzle-orm";
import { reconcileDuplicatePlayers } from "./reconcile-duplicate-players";
import { seedPlayers } from "./seed-players";

const TEST_NAME_PREFIX = "__integration_test__";
const cleanupSessionIds: number[] = [];
let tmpDir: string | undefined;

function uniqueName(label: string): string {
  return `${TEST_NAME_PREFIX}${label} ${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function writeMappingsFile(mapping: Record<string, number[]>): string {
  tmpDir ??= mkdtempSync(join(tmpdir(), "player-merge-mappings-"));
  const filePath = join(tmpDir, `mapping-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(filePath, JSON.stringify(mapping));
  return filePath;
}

// The unique index isn't creatable through the app layer (every insert
// already goes through it), so real ambiguous-duplicate scenarios can only
// be simulated by dropping it — exactly the pre-migration state the
// reconcile script is designed for. Must match lib/db/src/schema/players.ts.
async function withoutUniqueIndex<T>(run: () => Promise<T>): Promise<T> {
  await db.execute(sql`DROP INDEX players_name_lower_unique`);
  try {
    return await run();
  } finally {
    // Whatever the test did or didn't clean up, only rows under our test
    // prefix can possibly violate the constraint here — delete them before
    // recreating it so a failed assertion never leaves the real unique
    // index missing for every later test (and real dev/prod data never
    // uses this prefix, so this is safe).
    await db.delete(playersTable).where(like(playersTable.name, `${TEST_NAME_PREFIX}%`));
    await db.execute(
      sql`CREATE UNIQUE INDEX players_name_lower_unique ON players (lower(trim(name)))`,
    );
  }
}

afterEach(async () => {
  if (cleanupSessionIds.length > 0) {
    await db.delete(mahjongSessionsTable).where(inArray(mahjongSessionsTable.id, cleanupSessionIds));
    cleanupSessionIds.length = 0;
  }
  await db.delete(playersTable).where(like(playersTable.name, `${TEST_NAME_PREFIX}%`));
});

afterAll(async () => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  await pool.end();
});

describe("players table uniqueness (real Postgres)", () => {
  it("rejects a case/whitespace variant of an existing name via onConflictDoNothing", async () => {
    const canonicalName = uniqueName("Sam");
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

describe("reconcileDuplicatePlayers duplicate handling (real Postgres)", () => {
  it("fails closed and writes nothing for a real ambiguous duplicate with no mapping supplied", async () => {
    const name = uniqueName("Sam");
    await withoutUniqueIndex(async () => {
      const rows = await db
        .insert(playersTable)
        .values([{ name }, { name: `  ${name.toUpperCase()}  ` }])
        .returning();
      expect(rows).toHaveLength(2);

      await expect(reconcileDuplicatePlayers()).rejects.toThrow(/No approved merge mapping/);

      const remaining = await db.select().from(playersTable).where(eq(playersTable.name, name));
      expect(remaining).toHaveLength(1); // untouched: neither row merged nor deleted
    });
  });

  it("merges per an explicit approved mapping, remapping linked session balances", async () => {
    const name = uniqueName("Priya");
    await withoutUniqueIndex(async () => {
      const [canonical, loser] = await db
        .insert(playersTable)
        .values([{ name }, { name: `  ${name.toUpperCase()}  ` }])
        .returning();
      if (!canonical || !loser) throw new Error("setup failed to insert both duplicate rows");

      const [session] = await db
        .insert(mahjongSessionsTable)
        .values({
          playedOn: "2026-01-01",
          rounds: 1,
          totalAmount: 0,
          winnerName: name,
          playerBalances: [
            { name: loser.name, playerId: loser.id, endingAmount: 500, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
          ],
        })
        .returning();
      if (!session) throw new Error("setup failed to insert session");
      cleanupSessionIds.push(session.id);

      const mappingsFile = writeMappingsFile({ [canonical.id]: [loser.id] });
      const originalMappingsFile = process.env.PLAYER_MERGE_MAPPINGS_FILE;
      process.env.PLAYER_MERGE_MAPPINGS_FILE = mappingsFile;
      try {
        await reconcileDuplicatePlayers();
      } finally {
        if (originalMappingsFile === undefined) {
          delete process.env.PLAYER_MERGE_MAPPINGS_FILE;
        } else {
          process.env.PLAYER_MERGE_MAPPINGS_FILE = originalMappingsFile;
        }
      }

      const remaining = await db
        .select()
        .from(playersTable)
        .where(inArray(playersTable.id, [canonical.id, loser.id]));
      expect(remaining).toEqual([expect.objectContaining({ id: canonical.id })]);

      const [updatedSession] = await db
        .select()
        .from(mahjongSessionsTable)
        .where(eq(mahjongSessionsTable.id, session.id));
      expect(updatedSession?.playerBalances).toEqual([
        expect.objectContaining({ playerId: canonical.id, name: canonical.name }),
      ]);
    });
  });
});

describe("seedPlayers backfill (real Postgres)", () => {
  it("is idempotent: dry-run makes no changes, apply links the balance, repeat apply is a no-op", async () => {
    const name = uniqueName("Wendy");
    const [session] = await db
      .insert(mahjongSessionsTable)
      .values({
        playedOn: "2026-01-02",
        rounds: 1,
        totalAmount: 0,
        winnerName: name,
        playerBalances: [{ name, endingAmount: 500, zhaHuCount: 0, xieXieKaiXiangCount: 0 }],
      })
      .returning();
    if (!session) throw new Error("setup failed to insert session");
    cleanupSessionIds.push(session.id);

    process.env.DRY_RUN = "true";
    try {
      await seedPlayers();
    } finally {
      delete process.env.DRY_RUN;
    }
    const afterDryRun = await db.select().from(playersTable).where(eq(playersTable.name, name));
    expect(afterDryRun).toHaveLength(0);

    await seedPlayers();
    const [createdPlayer] = await db.select().from(playersTable).where(eq(playersTable.name, name));
    expect(createdPlayer).toBeDefined();
    const [linkedSession] = await db
      .select()
      .from(mahjongSessionsTable)
      .where(eq(mahjongSessionsTable.id, session.id));
    expect(linkedSession?.playerBalances).toEqual([
      expect.objectContaining({ playerId: createdPlayer!.id }),
    ]);

    await seedPlayers();
    const playersAfterRepeat = await db.select().from(playersTable).where(eq(playersTable.name, name));
    expect(playersAfterRepeat).toHaveLength(1);
    expect(playersAfterRepeat[0]?.id).toBe(createdPlayer!.id);
  });

  it("creates no player rows when a later session has an invalid player reference", async () => {
    const validName = uniqueName("Farid");
    const [validSession, invalidSession] = await db
      .insert(mahjongSessionsTable)
      .values([
        {
          playedOn: "2026-01-03",
          rounds: 1,
          totalAmount: 0,
          winnerName: validName,
          playerBalances: [{ name: validName, endingAmount: 500, zhaHuCount: 0, xieXieKaiXiangCount: 0 }],
        },
        {
          playedOn: "2026-01-04",
          rounds: 1,
          totalAmount: 0,
          winnerName: "Dangling",
          playerBalances: [
            { name: "Dangling", playerId: 999_999, endingAmount: 500, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
          ],
        },
      ])
      .returning();
    if (!validSession || !invalidSession) throw new Error("setup failed to insert sessions");
    cleanupSessionIds.push(validSession.id, invalidSession.id);

    await expect(seedPlayers()).rejects.toThrow(/invalid player reference/);

    // The valid balance's player must not have been created: seedPlayers
    // validates every session's playerId references before creating any
    // player, so one bad session blocks the whole run rather than leaving
    // a partial backfill behind.
    const orphanedPlayer = await db.select().from(playersTable).where(eq(playersTable.name, validName));
    expect(orphanedPlayer).toHaveLength(0);

    const [unchangedSession] = await db
      .select()
      .from(mahjongSessionsTable)
      .where(eq(mahjongSessionsTable.id, validSession.id));
    const unchangedBalance = unchangedSession?.playerBalances[0];
    expect(unchangedBalance?.name).toBe(validName);
    expect(unchangedBalance?.playerId).toBeUndefined();
  });
});

describe("concurrent first-time player creation (real Postgres)", () => {
  it("lets only one of two racing onConflictDoNothing inserts for the same normalized name win", async () => {
    const name = uniqueName("Concurrent");
    const [resultA, resultB] = await Promise.all([
      db.insert(playersTable).values({ name }).onConflictDoNothing().returning(),
      db.insert(playersTable).values({ name: name.toUpperCase() }).onConflictDoNothing().returning(),
    ]);

    const winners = [...resultA, ...resultB];
    expect(winners).toHaveLength(1); // exactly one of the two racing inserts succeeded

    const rows = await db
      .select()
      .from(playersTable)
      .where(sql`lower(trim(${playersTable.name})) = lower(trim(${name}))`);
    expect(rows).toHaveLength(1);
  });
});

describe("transaction rollback on failure (real Postgres)", () => {
  it("discards a player insert when the transaction throws afterward", async () => {
    const name = uniqueName("RollbackProbe");
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(playersTable).values({ name }).returning();
        throw new Error("simulated mid-transaction failure");
      }),
    ).rejects.toThrow("simulated mid-transaction failure");

    const rows = await db.select().from(playersTable).where(eq(playersTable.name, name));
    expect(rows).toHaveLength(0);
  });
});
