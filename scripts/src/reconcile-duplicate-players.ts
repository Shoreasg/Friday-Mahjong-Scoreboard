import { db, mahjongSessionsTable, playersTable } from "@workspace/db";
import { normalizePlayerName } from "@workspace/session-rules";
import { asc, eq, inArray, sql } from "drizzle-orm";

export async function reconcileDuplicatePlayers(): Promise<void> {
  const [tableCheck] = (
    await db.execute(sql`SELECT to_regclass('public.players') IS NOT NULL AS exists`)
  ).rows as { exists: boolean }[];
  if (!tableCheck?.exists) {
    console.log("players table does not exist yet; skipping reconciliation");
    return;
  }

  await db.transaction(async (tx) => {
    const players = await tx
      .select()
      .from(playersTable)
      .orderBy(asc(playersTable.id));

    const groups = new Map<string, typeof players>();
    for (const player of players) {
      const key = normalizePlayerName(player.name);
      groups.set(key, [...(groups.get(key) ?? []), player]);
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [canonical, ...losers] = group;
      const loserIds = losers.map((player) => player.id);

      console.log(
        `Merging duplicate players into #${canonical.id} (${canonical.name}): ${losers
          .map((player) => `#${player.id} (${player.name})`)
          .join(", ")}`,
      );

      if (losers.some((player) => player.active) && !canonical.active) {
        await tx
          .update(playersTable)
          .set({ active: true })
          .where(eq(playersTable.id, canonical.id));
      }

      const sessions = await tx
        .select({
          id: mahjongSessionsTable.id,
          playerBalances: mahjongSessionsTable.playerBalances,
        })
        .from(mahjongSessionsTable);
      for (const session of sessions) {
        const balances = session.playerBalances ?? [];
        const remapped = balances.map((balance) =>
          balance.playerId !== undefined && loserIds.includes(balance.playerId)
            ? { ...balance, playerId: canonical.id, name: canonical.name }
            : balance,
        );
        if (JSON.stringify(remapped) !== JSON.stringify(balances)) {
          await tx
            .update(mahjongSessionsTable)
            .set({ playerBalances: remapped })
            .where(eq(mahjongSessionsTable.id, session.id));
        }
      }

      await tx.delete(playersTable).where(inArray(playersTable.id, loserIds));
    }
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await reconcileDuplicatePlayers();
}
