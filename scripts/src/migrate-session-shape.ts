import { db } from "@workspace/db";
import { PLAYER_WRITE_LOCK_KEY, validateBasePot, validateEndingAmount } from "@workspace/session-rules";
import { sql } from "drizzle-orm";

// Moves mahjong_sessions from the shape where the pot was a derived
// `total_amount` (double precision) to a creator-supplied `base_pot` (integer).
//
// This must run BEFORE `drizzle-kit push --force`: push sees a dropped column
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
  const basePotError = validateBasePot(Number(session.total_amount));
  if (basePotError) {
    problems.push(`total_amount ${session.total_amount}: ${basePotError}`);
  }

  const balances = session.player_balances ?? [];
  // Legacy sessions recorded before balances existed have nothing to sum.
  if (balances.length === 0) return problems;

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
    await tx.execute(
      sql`ALTER TABLE mahjong_sessions ALTER COLUMN base_pot TYPE integer USING base_pot::integer`,
    );
    console.log(`Renamed total_amount to base_pot on ${sessions.length} session(s)`);
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await renameTotalAmountToBasePot();
}
