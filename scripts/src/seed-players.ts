import {
  db,
  mahjongSessionsTable,
  playersTable,
  type PlayerBalance,
} from "@workspace/db";
import { normalizePlayerName } from "@workspace/session-rules";
import { asc, eq } from "drizzle-orm";

function nonEmptyBalances(value: PlayerBalance[] | null | undefined) {
  return (value ?? []).filter((balance) => normalizePlayerName(balance.name));
}

export async function seedPlayers(): Promise<void> {
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
      const key = normalizePlayerName(player.name);
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

        const key = normalizePlayerName(balance.name);
        if (!canonicalNames.has(key)) {
          canonicalNames.set(key, balance.name.trim());
        }
      }
    }

    for (const name of canonicalNames.values()) {
      const key = normalizePlayerName(name);
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
      const key = normalizePlayerName(player.name);
      if (playersByNormalizedName.has(key)) {
        throw new Error(`Duplicate case-insensitive player name: ${player.name}`);
      }
      playersByNormalizedName.set(key, player);
    }

    for (const session of sessions) {
      const [lockedSession] = await tx
        .select({
          id: mahjongSessionsTable.id,
          playerBalances: mahjongSessionsTable.playerBalances,
        })
        .from(mahjongSessionsTable)
        .where(eq(mahjongSessionsTable.id, session.id))
        .for("update");
      if (!lockedSession) continue;

      const balances = lockedSession.playerBalances ?? [];
      const expandedBalances = balances.map((balance) => {
        if (!normalizePlayerName(balance.name) || balance.playerId !== undefined) {
          return balance;
        }
        const player = playersByNormalizedName.get(normalizePlayerName(balance.name));
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
          .where(eq(mahjongSessionsTable.id, lockedSession.id));
      }
    }
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await seedPlayers();
}