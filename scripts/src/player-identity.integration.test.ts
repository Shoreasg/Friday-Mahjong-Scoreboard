// Real-Postgres coverage for the invariants the mocked unit tests can't
// prove: the DB-level case/whitespace-insensitive uniqueness index,
// PLAYER_WRITE_LOCK_KEY actually serializing concurrent writers, the
// fail-closed duplicate-reconciliation default, backfill repeatability,
// transaction rollback on failure, and concurrent first-time player
// creation.
//
// Isolation: this suite never touches the shared/public schema. It
// bootstraps a throwaway schema (its own players/mahjong_sessions tables
// and unique index) on a real Postgres server, then redirects
// DATABASE_URL's search_path at every module under test — including
// @workspace/db's own connection pool — into that schema before anything
// else is imported. The schema is dropped in afterAll. If the schema
// bootstrap fails for any reason, every test fails loudly rather than
// silently falling back to running against whatever the ambient
// DATABASE_URL already points at.
//
// One caveat that schema isolation can't fully cover: PLAYER_WRITE_LOCK_KEY
// is a Postgres advisory lock, which is scoped to the whole server, not a
// schema. If something else on the same Postgres server takes that exact
// lock key at the same moment this suite's advisory-lock test runs, that
// test could see cross-talk. That's an inherent property of advisory locks
// (see the PostgreSQL docs on pg_advisory_lock) rather than something this
// suite's isolation strategy can change, and it never touches table data.
//
// Requires a live database — run via `pnpm --filter @workspace/scripts run
// test:integration` against docker compose's Postgres (or any reachable
// DATABASE_URL). Not part of the default `pnpm test` run; see
// scripts/vitest.config.ts.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error(
    "DATABASE_URL must be set to run the real-Postgres integration suite " +
      "(pnpm --filter @workspace/scripts run test:integration)",
  );
}

const schemaName = `it_${randomUUID().replace(/-/g, "")}`;

// Bootstrap on the *unmodified* URL, before anything redirects search_path,
// so this step can never accidentally land on the wrong schema.
const bootstrapPool = new pg.Pool({ connectionString: baseDatabaseUrl });
try {
  await bootstrapPool.query(`CREATE SCHEMA "${schemaName}"`);
  await bootstrapPool.query(`
    CREATE TABLE "${schemaName}".players (
      id serial PRIMARY KEY,
      name text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_by_user_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX players_name_lower_unique
      ON "${schemaName}".players (lower(trim(name)));
    CREATE TABLE "${schemaName}".mahjong_sessions (
      id serial PRIMARY KEY,
      played_on date NOT NULL,
      rounds integer NOT NULL,
      total_amount double precision NOT NULL,
      winner_name text NOT NULL,
      player_balances jsonb NOT NULL DEFAULT '[]',
      notes text,
      created_by_user_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
} finally {
  await bootstrapPool.end();
}

// Every module below reads DATABASE_URL at import time (@workspace/db's
// pool, transitively used by reconcileDuplicatePlayers and seedPlayers).
// Redirecting it here, before those dynamic imports, is what makes the
// code under test — not just this file's own queries — operate entirely
// inside the isolated schema.
const searchPathOption = encodeURIComponent(`-c search_path=${schemaName}`);
process.env.DATABASE_URL = `${baseDatabaseUrl}${baseDatabaseUrl.includes("?") ? "&" : "?"}options=${searchPathOption}`;

const { db, mahjongSessionsTable, playersTable, pool } = await import("@workspace/db");
const { PLAYER_WRITE_LOCK_KEY } = await import("@workspace/session-rules");
const { eq, inArray, sql } = await import("drizzle-orm");
const { reconcileDuplicatePlayers } = await import("./reconcile-duplicate-players");
const { seedPlayers } = await import("./seed-players");

function uniqueName(label: string): string {
  return `${label} ${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function withoutUniqueIndex<T>(run: () => Promise<T>): Promise<T> {
  await db.execute(sql`DROP INDEX players_name_lower_unique`);
  try {
    return await run();
  } finally {
    await db.execute(
      sql`CREATE UNIQUE INDEX players_name_lower_unique ON players (lower(trim(name)))`,
    );
  }
}

afterAll(async () => {
  await pool.end();
  const cleanupPool = new pg.Pool({ connectionString: baseDatabaseUrl });
  try {
    await cleanupPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  } finally {
    await cleanupPool.end();
  }
});

describe("players table uniqueness (real Postgres, isolated schema)", () => {
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

describe("reconcileDuplicatePlayers duplicate handling (real Postgres, isolated schema)", () => {
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

      // Clean up before the finally block recreates the unique index, or
      // recreation would fail on our still-present duplicate.
      await db.delete(playersTable).where(inArray(playersTable.id, rows.map((row) => row.id)));
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

      const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const mappingsDir = mkdtempSync(join(tmpdir(), "player-merge-mappings-"));
      const mappingsFile = join(mappingsDir, "mapping.json");
      writeFileSync(mappingsFile, JSON.stringify({ [canonical.id]: [loser.id] }));

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
        rmSync(mappingsDir, { recursive: true, force: true });
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

describe("seedPlayers backfill (real Postgres, isolated schema)", () => {
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

describe("concurrent first-time player creation (real Postgres, isolated schema)", () => {
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

describe("transaction rollback on failure (real Postgres, isolated schema)", () => {
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
