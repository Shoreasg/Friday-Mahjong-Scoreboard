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

    const existingPlayers = await tx.select().from(playersTable);
    const playersById = new Map(existingPlayers.map((player) => [player.id, player]));
    const playersByName = new Map<string, (typeof existingPlayers)[number]>();
    for (const player of existingPlayers) {
      const key = normalizedName(player.name);
      if (playersByName.has(key)) {
        throw new Error(`Duplicate case-insensitive player name: ${player.name}`);
      }
      playersByName.set(key, player);
    }

    const canonicalNames = new Map<string, string>();
    for (const session of sessions) {
      for (const balance of nonEmptyBalances(session.playerBalances)) {
        if (balance.playerId !== undefined) {
          if (
            !Number.isInteger(balance.playerId) ||
            balance.playerId <= 0 ||
            !playersById.has(balance.playerId)
          ) {
            throw new Error(
              `Session ${session.id} has an invalid player reference`,
            );
          }
          continue;
        }

        const key = normalizedName(balance.name);
        if (!canonicalNames.has(key)) {
          canonicalNames.set(key, balance.name.trim());
        }
      }
    }

    for (const name of canonicalNames.values()) {
      const key = normalizedName(name);
      if (playersByName.has(key)) continue;

      const [player] = await tx
        .insert(playersTable)
        .values({ name })
        .onConflictDoNothing()
        .returning();
      if (player) {
        playersByName.set(key, player);
      }
    }

    const refreshedPlayers = await tx.select().from(playersTable);
    const playersByNormalizedName = new Map<string, (typeof refreshedPlayers)[number]>();
    for (const player of refreshedPlayers) {
      const key = normalizedName(player.name);
      if (playersByNormalizedName.has(key)) {
        throw new Error(`Duplicate case-insensitive player name: ${player.name}`);
      }
      playersByNormalizedName.set(key, player);
    }

    for (const session of sessions) {
      const balances = session.playerBalances ?? [];
      const expandedBalances = balances.map((balance) => {
        if (!normalizedName(balance.name) || balance.playerId !== undefined) {
          return balance;
        }
        const player = playersByNormalizedName.get(normalizedName(balance.name));
        if (!player) {
          throw new Error(`No player found for balance name: ${balance.name}`);
        }
        if (balance.playerId === player.id) {
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