import { getAuth } from "@clerk/express";
import {
  CreateSessionBody,
  CreateSessionResponse,
  DeleteSessionParams,
  GetSessionParams,
  GetSessionResponse,
  GetSessionSummaryResponse,
  ListSessionsResponse,
  UpdateSessionBody,
  UpdateSessionParams,
  UpdateSessionResponse,
} from "@workspace/api-zod";
import { db, mahjongSessionsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";

const router: IRouter = Router();

type SubmittedBalance = {
  name: string;
  endingAmount: number;
};

function sessionResult(playerBalances: SubmittedBalance[]) {
  const balances = playerBalances.map((balance) => ({
    name: balance.name.trim(),
    endingAmount: balance.endingAmount,
  }));
  const seenNames = new Set<string>();
  for (const balance of balances) {
    if (!balance.name) {
      return null;
    }
    const normalizedName = balance.name.toLocaleLowerCase();
    if (seenNames.has(normalizedName)) {
      return null;
    }
    seenNames.add(normalizedName);
  }

  const [winner] = [...balances].sort(
    (a, b) =>
      b.endingAmount - a.endingAmount || a.name.localeCompare(b.name),
  );

  return {
    playerBalances: balances,
    winnerName: winner.name,
    totalAmount: balances.reduce(
      (total, balance) => total + balance.endingAmount,
      0,
    ),
  };
}

function userIdFor(req: Request): string | null {
  const auth = getAuth(req);
  const claimUserId = auth?.sessionClaims?.userId;
  return typeof claimUserId === "string"
    ? claimUserId
    : (auth?.userId ?? null);
}

function requireUser(req: Request, res: Response): string | null {
  const userId = userIdFor(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

router.get("/sessions", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;

  const sessions = await db
    .select()
    .from(mahjongSessionsTable)
    .orderBy(desc(mahjongSessionsTable.playedOn));

  res.json(ListSessionsResponse.parse(sessions));
});

router.post("/sessions", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid session");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = sessionResult(parsed.data.playerBalances);
  if (!result) {
    res.status(400).json({ error: "Player names are required and must be unique" });
    return;
  }

  const [session] = await db
    .insert(mahjongSessionsTable)
    .values({
      playedOn: dateOnly(parsed.data.playedOn),
      rounds: parsed.data.rounds,
      totalAmount: result.totalAmount,
      winnerName: result.winnerName,
      playerBalances: result.playerBalances,
      notes: parsed.data.notes?.trim() || null,
      createdByUserId: userId,
    })
    .returning();

  res.status(201).json(CreateSessionResponse.parse(session));
});

router.get("/sessions/summary", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;

  const [totals] = await db
    .select({
      totalSessions: sql<number>`count(*)::int`,
      totalRounds: sql<number>`coalesce(sum(${mahjongSessionsTable.rounds}), 0)::int`,
      totalAmount: sql<number>`coalesce(sum(${mahjongSessionsTable.totalAmount}), 0)::float8`,
    })
    .from(mahjongSessionsTable);

  const [latestSession] = await db
    .select()
    .from(mahjongSessionsTable)
    .orderBy(desc(mahjongSessionsTable.playedOn))
    .limit(1);

  const winnerCounts = await db
    .select({
      winnerName: mahjongSessionsTable.winnerName,
      wins: sql<number>`count(*)::int`,
    })
    .from(mahjongSessionsTable)
    .groupBy(mahjongSessionsTable.winnerName)
    .orderBy(desc(sql`count(*)`), mahjongSessionsTable.winnerName);

  res.json(
    GetSessionSummaryResponse.parse({
      totalSessions: totals?.totalSessions ?? 0,
      totalRounds: totals?.totalRounds ?? 0,
      totalAmount: totals?.totalAmount ?? 0,
      latestSession: latestSession ?? null,
      winnerCounts,
    }),
  );
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;

  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(mahjongSessionsTable)
    .where(eq(mahjongSessionsTable.id, params.data.id));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(GetSessionResponse.parse(session));
});

router.patch("/sessions/:id", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;

  const params = UpdateSessionParams.safeParse(req.params);
  const body = UpdateSessionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : body.error?.message,
    });
    return;
  }

  const update: Partial<typeof mahjongSessionsTable.$inferInsert> = {};
  if (body.data.playedOn) {
    update.playedOn = dateOnly(body.data.playedOn);
  }
  if (body.data.rounds !== undefined) {
    update.rounds = body.data.rounds;
  }
  if (body.data.playerBalances !== undefined) {
    const result = sessionResult(body.data.playerBalances);
    if (!result) {
      res.status(400).json({ error: "Player names are required and must be unique" });
      return;
    }
    update.totalAmount = result.totalAmount;
    update.winnerName = result.winnerName;
    update.playerBalances = result.playerBalances;
  }
  if (body.data.notes !== undefined) {
    update.notes = body.data.notes?.trim() || null;
  }

  const [session] = await db
    .update(mahjongSessionsTable)
    .set(update)
    .where(eq(mahjongSessionsTable.id, params.data.id))
    .returning();

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(UpdateSessionResponse.parse(session));
});

router.delete("/sessions/:id", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;

  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(mahjongSessionsTable)
    .where(eq(mahjongSessionsTable.id, params.data.id))
    .returning({ id: mahjongSessionsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;