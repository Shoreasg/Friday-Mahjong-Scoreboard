import {
  ListPlayersQueryParams,
  ListPlayersResponse,
} from "@workspace/api-zod";
import { db, mahjongSessionsTable, playersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

router.get("/players", async (req, res): Promise<void> => {
  const rawActive = req.query.active;
  let active: boolean | undefined;
  if (rawActive !== undefined) {
    if (rawActive === "true") {
      active = true;
    } else if (rawActive === "false") {
      active = false;
    } else {
      res.status(400).json({ error: "active must be true or false" });
      return;
    }
  }
  const parsedQuery = ListPlayersQueryParams.safeParse({ active });
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  const playerQuery = db.select().from(playersTable);
  const players =
    parsedQuery.data.active === undefined
      ? await playerQuery
      : await playerQuery.where(eq(playersTable.active, parsedQuery.data.active));
  const sessions = await db
    .select({ playerBalances: mahjongSessionsTable.playerBalances })
    .from(mahjongSessionsTable);

  const playerIdsByName = new Map(
    players.map((player) => [normalizedName(player.name), player.id]),
  );
  const sessionCounts = new Map<number, number>();
  for (const session of sessions) {
    const matchedPlayerIds = new Set<number>();
    for (const balance of session.playerBalances ?? []) {
      if (typeof balance.playerId === "number") {
        if (players.some((player) => player.id === balance.playerId)) {
          matchedPlayerIds.add(balance.playerId);
        }
        continue;
      }

      const playerId = playerIdsByName.get(normalizedName(balance.name));
      if (playerId !== undefined) matchedPlayerIds.add(playerId);
    }
    for (const playerId of matchedPlayerIds) {
      sessionCounts.set(playerId, (sessionCounts.get(playerId) ?? 0) + 1);
    }
  }

  res.json(
    ListPlayersResponse.parse(
      players.map((player) => ({
        ...player,
        sessionCount: sessionCounts.get(player.id) ?? 0,
      })),
    ),
  );
});

export default router;