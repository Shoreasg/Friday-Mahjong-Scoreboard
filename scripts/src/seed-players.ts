import {
  db,
  mahjongSessionsTable,
  playersTable,
  type PlayerBalance,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function nonEmptyBalances(value: PlayerBalance[] | null | undefined) {
  return (value ?? []).filter((balance) => normalizedName(balance.name));
}

async function seedPlayers(): Promise<void> {
  await db.transaction(async (tx) => {
    const sessions = await tx
      .select({
        id: mahjongSessionsTable.id,
        playerBalances: mahjongSessionsTable.playerBalances,
      })
      .from(mahjongSessionsTable)
      .orderBy(asc(mahjongSessionsTable.id));

    const canonicalNames = new Map<string, string>();
    for (const session of sessions) {
      for (const balance of nonEmptyBalances(session.playerBalances)) {
        const key = normalizedName(balance.name);
        if (!canonicalNames.has(key)) {
          canonicalNames.set(key, balance.name.trim());
        }
      }
    }

    const existingPlayers = await tx.select().from(playersTable);
    const playersByName = new Map(
      existingPlayers.map((player) => [normalizedName(player.name), player]),
    );

    for (const name of canonicalNames.values()) {
      const key = normalizedName(name);
      if (playersByName.has(key)) continue;

      const [player] = await tx
        .insert(playersTable)
        .values({ name })
        .onConflictDoNothing({ target: playersTable.name })
        .returning();
      if (player) {
        playersByName.set(key, player);
      }
    }

    const refreshedPlayers = await tx.select().from(playersTable);
    const playersByNormalizedName = new Map(
      refreshedPlayers.map((player) => [normalizedName(player.name), player]),
    );

    for (const session of sessions) {
      const balances = session.playerBalances ?? [];
      const expandedBalances = balances.map((balance) => {
        const player = playersByNormalizedName.get(normalizedName(balance.name));
        if (!player || balance.playerId === player.id) {
          return balance;
        }
        return { ...balance, playerId: player.id };
      });

      if (
        JSON.stringify(expandedBalances) !== JSON.stringify(balances) &&
        expandedBalances.some((balance) => balance.playerId !== undefined)
      ) {
        await tx
          .update(mahjongSessionsTable)
          .set({ playerBalances: expandedBalances })
          .where(eq(mahjongSessionsTable.id, session.id));
      }
    }
  });
}

await seedPlayers();