// Real-Postgres coverage for the session-shape migration: the column rename
// and type change are DDL, which the mocked unit tests can't exercise.
//
// Isolation follows player-identity.integration.test.ts: a throwaway schema
// holding the *pre-migration* mahjong_sessions shape, with DATABASE_URL's
// search_path redirected into it before @workspace/db is imported. Requires a
// live database — run via `pnpm --filter @workspace/scripts run
// test:integration`.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error(
    "DATABASE_URL must be set to run the real-Postgres integration suite " +
      "(pnpm --filter @workspace/scripts run test:integration)",
  );
}

const schemaName = `it_${randomUUID().replace(/-/g, "")}`;

const bootstrapPool = new pg.Pool({ connectionString: baseDatabaseUrl });
try {
  await bootstrapPool.query(`CREATE SCHEMA "${schemaName}"`);
} finally {
  await bootstrapPool.end();
}

const searchPathOption = encodeURIComponent(`-c search_path=${schemaName}`);
process.env.DATABASE_URL = `${baseDatabaseUrl}${baseDatabaseUrl.includes("?") ? "&" : "?"}options=${searchPathOption}`;

const { db, pool } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");
const { renameTotalAmountToBasePot, stripNamesFromBalances } = await import("./migrate-session-shape");

function balances(amounts: number[]) {
  return JSON.stringify(
    amounts.map((endingAmount, index) => ({
      name: `Player ${index + 1}`,
      endingAmount,
      zhaHuCount: 0,
      xieXieKaiXiangCount: 0,
    })),
  );
}

async function createLegacyTable(rows: { totalAmount: number; amounts: number[] }[]) {
  await db.execute(sql`DROP TABLE IF EXISTS mahjong_sessions`);
  await db.execute(sql`
    CREATE TABLE mahjong_sessions (
      id serial PRIMARY KEY,
      played_on date NOT NULL,
      rounds integer NOT NULL,
      total_amount double precision NOT NULL,
      winner_name text NOT NULL,
      player_balances jsonb NOT NULL DEFAULT '[]',
      notes text,
      created_by_user_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  for (const row of rows) {
    await db.execute(sql`
      INSERT INTO mahjong_sessions (played_on, rounds, total_amount, winner_name, player_balances)
      VALUES ('2026-09-04', 4, ${row.totalAmount}, 'Player 1', ${balances(row.amounts)}::jsonb)
    `);
  }
}

async function columns(): Promise<Record<string, string>> {
  const result = await db.execute(sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'mahjong_sessions' AND table_schema = current_schema()
  `);
  return Object.fromEntries(
    (result.rows as { column_name: string; data_type: string }[]).map((row) => [
      row.column_name,
      row.data_type,
    ]),
  );
}

beforeEach(() => {
  delete process.env.DRY_RUN;
});

afterAll(async () => {
  await pool.end();
  const cleanupPool = new pg.Pool({ connectionString: baseDatabaseUrl });
  try {
    await cleanupPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
  } finally {
    await cleanupPool.end();
  }
});

describe("renameTotalAmountToBasePot (real Postgres, isolated schema)", () => {
  it("renames total_amount to an integer base_pot, keeping every value, and is a no-op on repeat", async () => {
    await createLegacyTable([
      { totalAmount: 2000, amounts: [433, 485, 501, 581] },
      { totalAmount: 800, amounts: [200, 250, 150, 200] },
    ]);

    await renameTotalAmountToBasePot();

    expect(await columns()).toMatchObject({ base_pot: "integer" });
    expect(await columns()).not.toHaveProperty("total_amount");
    const rows = await db.execute(sql`SELECT base_pot FROM mahjong_sessions ORDER BY id`);
    expect(rows.rows).toEqual([{ base_pot: 2000 }, { base_pot: 800 }]);

    await renameTotalAmountToBasePot();
    expect(await columns()).toMatchObject({ base_pot: "integer" });
  });

  it("changes nothing in dry-run mode", async () => {
    await createLegacyTable([{ totalAmount: 2000, amounts: [500, 500, 500, 500] }]);
    process.env.DRY_RUN = "true";

    await renameTotalAmountToBasePot();

    expect(await columns()).toMatchObject({ total_amount: "double precision" });
  });

  it("fails closed, naming the session, when a session's amounts don't sum to its total", async () => {
    await createLegacyTable([
      { totalAmount: 2000, amounts: [500, 500, 500, 500] },
      { totalAmount: 2000, amounts: [500, 500, 500, 499.5] },
    ]);

    await expect(renameTotalAmountToBasePot()).rejects.toThrow(/session 2:/);

    expect(await columns()).toMatchObject({ total_amount: "double precision" });
    expect(await columns()).not.toHaveProperty("base_pot");
  });
});

describe("stripNamesFromBalances (real Postgres, isolated schema)", () => {
  async function createCurrentTables(balancesJson: string) {
    await db.execute(sql`DROP TABLE IF EXISTS mahjong_sessions`);
    await db.execute(sql`DROP TABLE IF EXISTS players`);
    await db.execute(sql`
      CREATE TABLE players (
        id serial PRIMARY KEY,
        name text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_by_user_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`INSERT INTO players (name) VALUES ('Kah Wei'), ('Ash')`);
    await db.execute(sql`
      CREATE TABLE mahjong_sessions (
        id serial PRIMARY KEY,
        played_on date NOT NULL,
        rounds integer NOT NULL,
        base_pot integer NOT NULL,
        player_balances jsonb NOT NULL DEFAULT '[]',
        notes text,
        created_by_user_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      INSERT INTO mahjong_sessions (played_on, rounds, base_pot, player_balances)
      VALUES ('2026-09-04', 4, 1000, ${balancesJson}::jsonb)
    `);
  }

  async function storedBalances() {
    const result = await db.execute(sql`SELECT player_balances FROM mahjong_sessions`);
    return (result.rows[0] as { player_balances: unknown }).player_balances;
  }

  it("keeps only the player reference on each linked balance, and is a no-op on repeat", async () => {
    await createCurrentTables(
      JSON.stringify([
        { name: "Kah wei", playerId: 1, endingAmount: 600, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
        // A legacy seat recorded before incident counts existed.
        { name: "Ash", playerId: 2, endingAmount: 400 },
      ]),
    );

    await stripNamesFromBalances();

    const expected = [
      { playerId: 1, endingAmount: 600, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
      { playerId: 2, endingAmount: 400, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
    ];
    expect(await storedBalances()).toEqual(expected);

    await stripNamesFromBalances();
    expect(await storedBalances()).toEqual(expected);
  });

  it("fails closed, keeping names, when a balance was never linked to a player", async () => {
    const unlinked = [
      { name: "Kah Wei", playerId: 1, endingAmount: 600, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
      { name: "Nobody", endingAmount: 400, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
    ];
    await createCurrentTables(JSON.stringify(unlinked));

    await expect(stripNamesFromBalances()).rejects.toThrow(/session 1 seat 2 \(Nobody\)/);
    expect(await storedBalances()).toEqual(unlinked);
  });
});
