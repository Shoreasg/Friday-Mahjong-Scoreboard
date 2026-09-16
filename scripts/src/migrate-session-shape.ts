import {
  db,
  mahjongSessionsTable,
  playersTable,
  type PlayerBalance,
} from "@workspace/db";
import { PLAYER_WRITE_LOCK_KEY, validateBasePot, validateEndingAmount } from "@workspace/session-rules";
import { asc, eq, sql } from "drizzle-orm";
import { storedBalances } from "./legacy-balances";

// Moves mahjong_sessions to its current shape in two phases around the
// schema push:
//
// 1. Before push (default): rename the derived `total_amount` (double
//    precision) to the creator-supplied `base_pot` (integer).
// 2. After push and seed:players (`--after-push`): drop the copied player
//    name from every balance, leaving only the playerId.
//
// Phase 1 must run BEFORE `drizzle-kit push --force`: push sees a dropped column
// plus an added one and, with --force, would drop total_amount and create an
// empty base_pot instead of renaming it — losing every session's stakes.
// Renaming here first leaves push with nothing to do for this column.
//
// Fails closed: if any existing session's amounts don't already sum to its
// total, nothing is changed and the offending sessions are listed, because the
// new rules would make those sessions uneditable. DRY_RUN=true reports only.

type LegacySessionRow = {
  id: number;
  total_amount: number;
  player_balances: { endingAmount?: unknown }[] | null;
};

async function columnNames(
  queryDb: Pick<typeof db, "execute">,
): Promise<Set<string>> {
  const result = await queryDb.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'mahjong_sessions' AND table_schema = current_schema()
  `);
  return new Set(
    (result.rows as { column_name: string }[]).map((row) => row.column_name),
  );
}

export function sessionProblems(session: LegacySessionRow): string[] {
  const problems: string[] = [];

  const balances = session.player_balances ?? [];
  // Legacy sessions recorded before balances existed have nothing to sum, and
  // their total can't be verified either — they're excluded from winnings —
  // so the base-pot rules don't apply to them at all.
  if (balances.length === 0) return problems;

  const basePotError = validateBasePot(Number(session.total_amount));
  if (basePotError) {
    problems.push(`total_amount ${session.total_amount}: ${basePotError}`);
  }

  let sum = 0;
  for (const balance of balances) {
    const amount = balance.endingAmount;
    const amountError =
      typeof amount === "number" ? validateEndingAmount(amount) : "missing ending amount";
    if (amountError) {
      problems.push(`ending amount ${String(amount)}: ${amountError}`);
    } else {
      sum += amount as number;
    }
  }
  if (problems.length === 0 && sum !== Number(session.total_amount)) {
    problems.push(`ending amounts sum to ${sum}, not ${session.total_amount}`);
  }
  return problems;
}

export async function renameTotalAmountToBasePot(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "true";

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLAYER_WRITE_LOCK_KEY})`);

    const columns = await columnNames(tx);
    if (columns.size === 0) {
      console.log("mahjong_sessions does not exist yet; nothing to migrate");
      return;
    }
    if (!columns.has("total_amount")) {
      console.log("mahjong_sessions already records base_pot; nothing to migrate");
      return;
    }
    if (columns.has("base_pot")) {
      throw new Error(
        "mahjong_sessions has both total_amount and base_pot; resolve by hand before pushing the schema",
      );
    }

    const sessions = (
      await tx.execute(sql`SELECT id, total_amount, player_balances FROM mahjong_sessions ORDER BY id`)
    ).rows as LegacySessionRow[];
    const invalid = sessions
      .map((session) => ({ id: session.id, problems: sessionProblems(session) }))
      .filter(({ problems }) => problems.length > 0);
    if (invalid.length > 0) {
      const report = invalid
        .map(({ id, problems }) => `  session ${id}: ${problems.join("; ")}`)
        .join("\n");
      throw new Error(
        `Refusing to migrate: ${invalid.length} session(s) break the base-pot rules. ` +
          `Correct them first, then re-run.\n${report}`,
      );
    }

    if (dryRun) {
      console.log(
        `[dry run] All ${sessions.length} session(s) balance; would rename total_amount to base_pot (integer)`,
      );
      return;
    }

    await tx.execute(sql`ALTER TABLE mahjong_sessions RENAME COLUMN total_amount TO base_pot`);
    // A no-balance row's total was never checked against validateBasePot
    // above, so it can be any double (including a non-integer one). Round it
    // explicitly rather than relying on the implicit double->integer cast,
    // whose rounding/overflow behavior is easy to get wrong by assumption.
    await tx.execute(
      sql`ALTER TABLE mahjong_sessions ALTER COLUMN base_pot TYPE integer USING round(base_pot)::integer`,
    );
    console.log(`Renamed total_amount to base_pot on ${sessions.length} session(s)`);
  });
}

/**
 * The contract step: once seed:players has linked every balance to a player,
 * rewrite each balance to carry only its playerId (no copied name) so the
 * player record is the single source of a player's name. Runs AFTER the
 * schema push and backfill. Fails closed, changing nothing, if any balance
 * still lacks a valid player reference.
 */
export async function stripNamesFromBalances(): Promise<void> {
  const dryRun = process.env.DRY_RUN === "true";

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLAYER_WRITE_LOCK_KEY})`);

    const sessions = await tx
      .select({ id: mahjongSessionsTable.id, playerBalances: mahjongSessionsTable.playerBalances })
      .from(mahjongSessionsTable)
      .orderBy(asc(mahjongSessionsTable.id));
    const playerIds = new Set(
      (await tx.select({ id: playersTable.id }).from(playersTable)).map((player) => player.id),
    );

    const unlinked: string[] = [];
    const rewrites: { id: number; playerBalances: PlayerBalance[] }[] = [];
    for (const session of sessions) {
      const balances = storedBalances(session.playerBalances);
      const contracted = balances.map((balance) => ({
        playerId: balance.playerId as number,
        endingAmount: balance.endingAmount,
        zhaHuCount: balance.zhaHuCount ?? 0,
        xieXieKaiXiangCount: balance.xieXieKaiXiangCount ?? 0,
      }));
      balances.forEach((balance, index) => {
        if (balance.playerId === undefined || !playerIds.has(balance.playerId)) {
          unlinked.push(`session ${session.id} seat ${index + 1} (${balance.name ?? "no name"})`);
        }
      });
      // Compare key sets rather than serialized JSON: jsonb reorders keys, so
      // an already-contracted row would never stringify identically.
      const contractedKeys = Object.keys(contracted[0] ?? {}).sort().join();
      if (balances.some((balance) => Object.keys(balance).sort().join() !== contractedKeys)) {
        rewrites.push({ id: session.id, playerBalances: contracted });
      }
    }

    if (unlinked.length > 0) {
      throw new Error(
        `Refusing to remove names: ${unlinked.length} balance(s) have no valid player reference. ` +
          `Run seed:players first.\n  ${unlinked.join("\n  ")}`,
      );
    }
    if (dryRun) {
      console.log(`[dry run] Would remove copied names from ${rewrites.length} session(s)`);
      return;
    }
    for (const rewrite of rewrites) {
      await tx
        .update(mahjongSessionsTable)
        .set({ playerBalances: rewrite.playerBalances })
        .where(eq(mahjongSessionsTable.id, rewrite.id));
    }
    console.log(`Removed copied player names from ${rewrites.length} session(s)`);
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv.includes("--after-push")) {
    await stripNamesFromBalances();
  } else {
    await renameTotalAmountToBasePot();
  }
}
