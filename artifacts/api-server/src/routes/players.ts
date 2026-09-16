import {
  CreatePlayerBody,
  CreatePlayerResponse,
  ListPlayersQueryParams,
  ListPlayersResponse,
} from "@workspace/api-zod";
import { db, mahjongSessionsTable, playersTable } from "@workspace/db";
import { PLAYER_WRITE_LOCK_KEY } from "@workspace/session-rules";
import { eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { requireAdmin } from "./requireAdmin";

const router: IRouter = Router();

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

  const sessionCounts = new Map<number, number>();
  for (const session of sessions) {
    const playerIds = new Set(
      (session.playerBalances ?? []).map((balance) => balance.playerId),
    );
    for (const playerId of playerIds) {
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

router.post("/players", async (req, res): Promise<void> => {
  const userId = await requireAdmin(req, res);
  if (!userId) return;

  const parsed = CreatePlayerBody.safeParse(req.body);
  const name = parsed.success ? parsed.data.name.trim() : "";
  if (!parsed.success || !name) {
    res.status(400).json({
      error: parsed.success ? "Player name is required" : parsed.error.message,
    });
    return;
  }

  const player = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLAYER_WRITE_LOCK_KEY})`);
    const [created] = await tx
      .insert(playersTable)
      .values({ name, createdByUserId: userId })
      // Names are unique ignoring case and surrounding whitespace.
      .onConflictDoNothing()
      .returning();
    return created;
  });

  if (!player) {
    res.status(409).json({ error: `A player named "${name}" already exists` });
    return;
  }

  res.status(201).json(CreatePlayerResponse.parse({ ...player, sessionCount: 0 }));
});

export default router;
