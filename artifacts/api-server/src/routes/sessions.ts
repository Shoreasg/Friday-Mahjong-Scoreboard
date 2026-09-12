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
import {
  normalizePlayerName,
  STARTING_BALANCE,
} from "@workspace/session-rules";
import {
  sendTelegramMessage,
} from "@workspace/integrations-telegram";
import { desc, eq, sql } from "drizzle-orm";
import {
  Router,
  type IRouter,
  type Request,
} from "express";
import { requireAdmin } from "./requireAdmin";

const router: IRouter = Router();

type AnnouncementOutcome =
  | { status: "sent"; messageId: number | null }
  | { status: "skipped"; reason: "not_configured" }
  | { status: "failed"; reason: "delivery_failed" };

type SubmittedBalance = {
  name: string;
  endingAmount: number;
  zhaHuCount: number;
  xieXieKaiXiangCount?: number;
};

function normalizePlayerBalances(playerBalances: SubmittedBalance[]) {
  return playerBalances.map((balance) => {
    const xieXieKaiXiangCount = balance.xieXieKaiXiangCount;
    return {
      name: balance.name,
      endingAmount: balance.endingAmount,
      zhaHuCount:
        Number.isInteger(balance.zhaHuCount) && balance.zhaHuCount >= 0
          ? balance.zhaHuCount
          : 0,
      xieXieKaiXiangCount:
        Number.isInteger(xieXieKaiXiangCount) &&
        xieXieKaiXiangCount !== undefined &&
        xieXieKaiXiangCount >= 0
          ? xieXieKaiXiangCount
          : 0,
    };
  });
}

function normalizeSession(
  session: typeof mahjongSessionsTable.$inferSelect,
) {
  return {
    ...session,
    playerBalances: normalizePlayerBalances(session.playerBalances),
  };
}

function sessionResult(playerBalances: SubmittedBalance[]) {
  if (playerBalances.length !== 4) {
    return null;
  }

  const balances = playerBalances.map((balance) => ({
    name: balance.name.trim(),
    endingAmount: balance.endingAmount,
    zhaHuCount: balance.zhaHuCount,
    xieXieKaiXiangCount: balance.xieXieKaiXiangCount ?? 0,
  }));
  const seenNames = new Set<string>();
  for (const balance of balances) {
    if (!balance.name) {
      return null;
    }
    const normalizedName = normalizePlayerName(balance.name);
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

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatNetPosition(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatMoney(Math.abs(value))}`;
}

function scoreboardUrl(req: Request): string {
  const configuredUrl = process.env.SCOREBOARD_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }

  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}`;
}

function sessionAnnouncement(
  req: Request,
  session: typeof mahjongSessionsTable.$inferSelect,
): string {
  const players = normalizePlayerBalances(session.playerBalances);
  const playerLines = players
    .map((player) => {
      const netPosition = player.endingAmount - STARTING_BALANCE;
      return [
        `• <b>${escapeTelegramHtml(player.name)}</b>`,
        `${formatMoney(player.endingAmount)} (${formatNetPosition(netPosition)})`,
        `诈胡 ${player.zhaHuCount}`,
        `谢谢开相 ${player.xieXieKaiXiangCount}`,
      ].join(" · ");
    })
    .join("\n");
  const winner = players.find(
    (player) =>
      player.name.trim().toLocaleLowerCase() ===
      session.winnerName.trim().toLocaleLowerCase(),
  );
  const winnerPosition = winner
    ? ` (${formatNetPosition(winner.endingAmount - STARTING_BALANCE)})`
    : "";
  const notes = session.notes
    ? `\n\n<b>Notes</b>\n${escapeTelegramHtml(session.notes)}`
    : "";

  return [
    `<b>Friday Mahjong · ${escapeTelegramHtml(session.playedOn)}</b>`,
    `Winner: <b>${escapeTelegramHtml(session.winnerName)}</b>${winnerPosition}`,
    "",
    `<b>Players</b>\n${playerLines}`,
    "",
    `<b>Rounds</b>: ${session.rounds}`,
    `<b>Settlement total</b>: ${formatMoney(session.totalAmount)}`,
    `<b>Starting balance</b>: ${formatMoney(STARTING_BALANCE)} per player`,
    notes,
    "",
    `<a href="${escapeTelegramHtml(scoreboardUrl(req))}">Open the scoreboard</a>`,
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
}

async function announceSession(
  req: Request,
  session: typeof mahjongSessionsTable.$inferSelect,
): Promise<AnnouncementOutcome> {
  try {
    const result = await sendTelegramMessage({
      text: sessionAnnouncement(req, session),
      parseMode: "HTML",
    });
    return result.status === "sent"
      ? { status: "sent", messageId: result.messageId }
      : { status: "skipped", reason: result.reason };
  } catch (error) {
    req.log.warn(
      {
        err: error,
        sessionId: session.id,
      },
      "Telegram session announcement failed",
    );
    return { status: "failed", reason: "delivery_failed" };
  }
}

router.get("/sessions", async (req, res): Promise<void> => {
  const sessions = await db
    .select()
    .from(mahjongSessionsTable)
    .orderBy(desc(mahjongSessionsTable.playedOn));

  res.json(ListSessionsResponse.parse(sessions.map(normalizeSession)));
});

router.post("/sessions", async (req, res): Promise<void> => {
  const userId = await requireAdmin(req, res);
  if (!userId) return;

  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid session");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = sessionResult(parsed.data.playerBalances);
  if (!result) {
    res.status(400).json({ error: "Exactly four player names are required and must be unique" });
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

  const announcement = await announceSession(req, session);
  res.status(201).json(
    CreateSessionResponse.parse({
      ...normalizeSession(session),
      announcement,
    }),
  );
});

router.get("/sessions/summary", async (req, res): Promise<void> => {
  const [totals] = await db
    .select({
      totalSessions: sql<number>`count(*)::int`,
      totalRounds: sql<number>`coalesce(sum(${mahjongSessionsTable.rounds}), 0)::int`,
      totalAmount: sql<number>`coalesce(sum(${mahjongSessionsTable.totalAmount}), 0)::float8`,
    })
    .from(mahjongSessionsTable);

  const sessions = await db
    .select()
    .from(mahjongSessionsTable)
    .orderBy(desc(mahjongSessionsTable.playedOn));
  const latestSession = sessions[0];

  const winnerCounts = await db
    .select({
      winnerName: mahjongSessionsTable.winnerName,
      wins: sql<number>`count(*)::int`,
    })
    .from(mahjongSessionsTable)
    .groupBy(mahjongSessionsTable.winnerName)
    .orderBy(desc(sql`count(*)`), mahjongSessionsTable.winnerName);

  const zhaHuByPlayer = new Map<
    string,
    { playerName: string; count: number }
  >();
  const xieXieKaiXiangByPlayer = new Map<
    string,
    { playerName: string; count: number }
  >();
  const winningsByPlayer = new Map<
    string,
    { playerName: string; netCents: number }
  >();
  for (const session of sessions) {
    for (const player of normalizePlayerBalances(session.playerBalances)) {
      const normalizedName = normalizePlayerName(player.name);
      const existingZhaHu = zhaHuByPlayer.get(normalizedName);
      if (existingZhaHu) {
        existingZhaHu.count += player.zhaHuCount;
      } else {
        zhaHuByPlayer.set(normalizedName, {
          playerName: player.name.trim(),
          count: player.zhaHuCount,
        });
      }

      const existingXieXieKaiXiang =
        xieXieKaiXiangByPlayer.get(normalizedName);
      if (existingXieXieKaiXiang) {
        existingXieXieKaiXiang.count += player.xieXieKaiXiangCount;
      } else {
        xieXieKaiXiangByPlayer.set(normalizedName, {
          playerName: player.name.trim(),
          count: player.xieXieKaiXiangCount,
        });
      }

      const netCents =
        Math.round(player.endingAmount * 100) - STARTING_BALANCE * 100;
      const existingWinnings = winningsByPlayer.get(normalizedName);
      if (existingWinnings) {
        existingWinnings.netCents += netCents;
      } else {
        winningsByPlayer.set(normalizedName, {
          playerName: player.name.trim(),
          netCents,
        });
      }
    }
  }
  const zhaHuCounts = [...zhaHuByPlayer.values()].sort(
    (a, b) =>
      b.count - a.count || a.playerName.localeCompare(b.playerName),
  );
  const xieXieKaiXiangCounts = [...xieXieKaiXiangByPlayer.values()].sort(
    (a, b) =>
      b.count - a.count || a.playerName.localeCompare(b.playerName),
  );
  const playerWinnings = [...winningsByPlayer.values()]
    .map(({ playerName, netCents }) => ({
      playerName,
      netAmount: netCents / 100,
    }))
    .sort(
      (a, b) =>
        b.netAmount - a.netAmount ||
        a.playerName.localeCompare(b.playerName),
    );

  res.json(
    GetSessionSummaryResponse.parse({
      totalSessions: totals?.totalSessions ?? 0,
      totalRounds: totals?.totalRounds ?? 0,
      totalAmount: totals?.totalAmount ?? 0,
      latestSession: latestSession ? normalizeSession(latestSession) : null,
      winnerCounts,
      zhaHuCounts,
      xieXieKaiXiangCounts,
      playerWinnings,
    }),
  );
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
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

  res.json(GetSessionResponse.parse(normalizeSession(session)));
});

router.patch("/sessions/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

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
      res.status(400).json({ error: "Exactly four player names are required and must be unique" });
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

  res.json(UpdateSessionResponse.parse(normalizeSession(session)));
});

router.delete("/sessions/:id", async (req, res): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;

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