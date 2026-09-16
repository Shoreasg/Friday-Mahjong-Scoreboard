import {
  CreatePlayerBody,
  CreatePlayerResponse,
  ListPlayersQueryParams,
  ListPlayersResponse,
  UpdatePlayerBody,
  UpdatePlayerParams,
  UpdatePlayerResponse,
} from "@workspace/api-zod";
import { db, mahjongSessionsTable, playersTable } from "@workspace/db";
import { PLAYER_WRITE_LOCK_KEY } from "@workspace/session-rules";
import { eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { requireAdmin } from "./requireAdmin";

const router: IRouter = Router();

type Queryable = Pick<typeof db, "select">;

async function sessionCounts(queryDb: Queryable): Promise<Map<number, number>> {
  const sessions = await queryDb
    .select({ playerBalances: mahjongSessionsTable.playerBalances })
    .from(mahjongSessionsTable);

  const counts = new Map<number, number>();
  for (const session of sessions) {
    const playerIds = new Set(
      (session.playerBalances ?? []).map((balance) => balance.playerId),
    );
    for (const playerId of playerIds) {
      counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
    }
  }
  return counts;
}

function isUniqueViolation(error: unknown): boolean {
  // node-postgres reports 23505; drizzle may wrap it as the error's cause.
  const codeOf = (value: unknown) =>
    typeof value === "object" && value !== null && "code" in value
      ? (value as { code: unknown }).code
      : undefined;
  return (
    codeOf(error) === "23505" ||
    codeOf((error as { cause?: unknown } | null)?.cause) === "23505"
  );
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
  const counts = await sessionCounts(db);

  res.json(
    ListPlayersResponse.parse(
      players.map((player) => ({
        ...player,
        sessionCount: counts.get(player.id) ?? 0,
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

router.patch("/players/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

  const params = UpdatePlayerParams.safeParse(req.params);
  const body = UpdatePlayerBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : body.error?.message,
    });
    return;
  }

  const update: { name?: string; active?: boolean } = {};
  if (body.data.name !== undefined) {
    update.name = body.data.name.trim();
    if (!update.name) {
      res.status(400).json({ error: "Player name is required" });
      return;
    }
  }
  if (body.data.active !== undefined) {
    update.active = body.data.active;
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "Provide a new name or active state" });
    return;
  }

  let result: { player: typeof playersTable.$inferSelect; sessionCount: number } | null;
  try {
    result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLAYER_WRITE_LOCK_KEY})`);
      const [player] = await tx
        .update(playersTable)
        .set(update)
        .where(eq(playersTable.id, params.data.id))
        .returning();
      if (!player) return null;
      const counts = await sessionCounts(tx);
      return { player, sessionCount: counts.get(player.id) ?? 0 };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: `A player named "${update.name}" already exists` });
      return;
    }
    throw error;
  }

  if (!result) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  res.json(UpdatePlayerResponse.parse({ ...result.player, sessionCount: result.sessionCount }));
});

export default router;
