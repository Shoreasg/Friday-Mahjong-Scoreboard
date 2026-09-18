import { db, mahjongSessionsTable, playersTable } from "@workspace/db";
import { normalizePlayerName, PLAYER_WRITE_LOCK_KEY } from "@workspace/session-rules";
import { asc, eq, sql } from "drizzle-orm";
import { storedBalances, type StoredPlayerBalance } from "./legacy-balances";

function nonEmptyBalances(value: unknown) {
  // A balance with no name is either a blank legacy seat or one whose name
  // has already been contracted away, leaving only its playerId.
  return storedBalances(value).filter(
    (balance): balance is StoredPlayerBalance & { name: string } =>
      normalizePlayerName(balance.name ?? "") !== "",
  );
}

async function planSeedPlayers(): Promise<void> {
  // Read-only preview: reuses the same lookups as the real run but never
  // writes, so an operator can review what would change before committing.
  const sessions = await db
    .select({
      id: mahjongSessionsTable.id,
      playerBalances: mahjongSessionsTable.playerBalances,
    })
    .from(mahjongSessionsTable)
    .orderBy(asc(mahjongSessionsTable.id));

  const existingPlayers = await db.select().from(playersTable);
  const playersById = new Map(existingPlayers.map((player) => [player.id, player]));
  const playersByName = new Map(
    existingPlayers.map((player) => [normalizePlayerName(player.name), player]),
  );

  const newPlayerNames = new Map<string, string>();
  const linksToCreate: { sessionId: number; name: string }[] = [];
  for (const session of sessions) {
    for (const balance of nonEmptyBalances(session.playerBalances)) {
      if (balance.playerId !== undefined) {
        if (
          !Number.isInteger(balance.playerId) ||
          balance.playerId <= 0 ||
          !playersById.has(balance.playerId)
        ) {
          throw new Error(`Session ${session.id} has an invalid player reference`);
        }
        continue;
      }

      const key = normalizePlayerName(balance.name);
      if (!playersByName.has(key)) {
        newPlayerNames.set(key, balance.name.trim());
      }
      linksToCreate.push({ sessionId: session.id, name: balance.name.trim() });
    }
  }

  if (newPlayerNames.size === 0 && linksToCreate.length === 0) {
    console.log("[dry run] No changes needed.");
    return;
  }
  for (const name of newPlayerNames.values()) {
    console.log(`[dry run] Would create player "${name}"`);
  }
  const linksBySession = new Map<number, string[]>();
  for (const { sessionId, name } of linksToCreate) {
    linksBySession.set(sessionId, [...(linksBySession.get(sessionId) ?? []), name]);
  }
  for (const [sessionId, names] of linksBySession) {
    console.log(`[dry run] Would link session ${sessionId} balances to players: ${names.join(", ")}`);
  }
}

export async function seedPlayers(): Promise<void> {
  if (process.env.DRY_RUN === "true") {
    await planSeedPlayers();
    return;
  }

  await db.transaction(async (tx) => {
    // Serialize against session writes and reconcileDuplicatePlayers so
    // this backfill can't race a concurrent identity-affecting change.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLAYER_WRITE_LOCK_KEY})`);

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

      const balances = storedBalances(lockedSession.playerBalances);
      const expandedBalances = balances.map((balance) => {
        if (!normalizePlayerName(balance.name ?? "") || balance.playerId !== undefined) {
          return balance;
        }
        const player = playersByNormalizedName.get(normalizePlayerName(balance.name ?? ""));
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
          .set({ playerBalances: expandedBalances as typeof lockedSession.playerBalances })
          .where(eq(mahjongSessionsTable.id, lockedSession.id));
      }
    }
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await seedPlayers();
}