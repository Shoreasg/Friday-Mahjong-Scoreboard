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
import {
  db,
  mahjongSessionsTable,
  playersTable,
  type PlayerBalance,
} from "@workspace/db";
import {
  isInProfit,
  largestStackPlayerIds,
  netWinnings,
  perPlayerShare,
  PLAYER_WRITE_LOCK_KEY,
  validateSession,
  validateStakes,
} from "@workspace/session-rules";
import {
  sendTelegramMessage,
} from "@workspace/integrations-telegram";
import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  Router,
  type IRouter,
  type Request,
} from "express";
import { requireAdmin } from "./requireAdmin";

const router: IRouter = Router();

type SessionRecord = typeof mahjongSessionsTable.$inferSelect;
type PlayerNames = Map<number, string>;

type AnnouncementOutcome =
  | { status: "sent"; messageId: number | null }
  | { status: "skipped"; reason: "not_configured" }
  | { status: "failed"; reason: "delivery_failed" };

class SessionRequestError extends Error {
  constructor(public readonly body: { error: string }) {
    super(body.error);
  }
}

/**
 * Confirms every seat references an existing player (active or not — an
 * inactive guest must still be editable in the nights they played) and returns
 * those players' current names.
 */
async function loadReferencedPlayers(
  queryDb: Pick<typeof db, "select" | "execute">,
  playerBalances: Pick<PlayerBalance, "playerId">[],
): Promise<PlayerNames> {
  // Serialize against player merges in the reconciliation script, so a
  // referenced player can't be merged away between this check and the write.
  await queryDb.execute(sql`SELECT pg_advisory_xact_lock(${PLAYER_WRITE_LOCK_KEY})`);

  const playerIds = playerBalances.map((balance) => balance.playerId);
  const players = await queryDb
    .select({ id: playersTable.id, name: playersTable.name })
    .from(playersTable)
    .where(inArray(playersTable.id, playerIds));
  const names: PlayerNames = new Map(players.map((player) => [player.id, player.name]));

  const missing = playerIds.find((playerId) => !names.has(playerId));
  if (missing !== undefined) {
    throw new SessionRequestError({
      error: `playerId ${missing} does not reference an existing player`,
    });
  }
  return names;
}

async function loadAllPlayerNames(): Promise<PlayerNames> {
  const players = await db
    .select({ id: playersTable.id, name: playersTable.name })
    .from(playersTable);
  return new Map(players.map((player) => [player.id, player.name]));
}

function playerName(names: PlayerNames, playerId: number): string {
  return names.get(playerId) ?? `Player #${playerId}`;
}

function toStoredBalances(
  playerBalances: PlayerBalance[],
): PlayerBalance[] {
  return playerBalances.map((balance) => ({
    playerId: balance.playerId,
    endingAmount: balance.endingAmount,
    zhaHuCount: balance.zhaHuCount,
    xieXieKaiXiangCount: balance.xieXieKaiXiangCount,
  }));
}

/** Shapes a stored session for responses, defaulting legacy incident counts. */
function normalizeSession(session: SessionRecord) {
  return {
    ...session,
    playerBalances: (session.playerBalances ?? []).map((balance) => ({
      playerId: balance.playerId,
      endingAmount: balance.endingAmount,
      zhaHuCount:
        Number.isInteger(balance.zhaHuCount) && balance.zhaHuCount >= 0
          ? balance.zhaHuCount
          : 0,
      xieXieKaiXiangCount:
        Number.isInteger(balance.xieXieKaiXiangCount) &&
        balance.xieXieKaiXiangCount >= 0
          ? balance.xieXieKaiXiangCount
          : 0,
    })),
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
  session: SessionRecord,
  names: PlayerNames,
): string {
  const { basePot, playerBalances: players } = normalizeSession(session);
  const nameOf = (playerId: number) => escapeTelegramHtml(playerName(names, playerId));
  const playerLines = players
    .map((player) =>
      [
        `• <b>${nameOf(player.playerId)}</b>`,
        `${formatMoney(player.endingAmount)} (${formatNetPosition(netWinnings(player.endingAmount, basePot))})`,
        `诈胡 ${player.zhaHuCount}`,
        `谢谢开相 ${player.xieXieKaiXiangCount}`,
      ].join(" · "),
    )
    .join("\n");
  const winners = players
    .filter((player) => isInProfit(player.endingAmount, basePot))
    .map(
      (player) =>
        `<b>${nameOf(player.playerId)}</b> (${formatNetPosition(netWinnings(player.endingAmount, basePot))})`,
    );
  const largestStack = largestStackPlayerIds(players).map(nameOf).join(", ");
  const notes = session.notes
    ? `\n\n<b>Notes</b>\n${escapeTelegramHtml(session.notes)}`
    : "";

  return [
    `<b>Friday Mahjong · ${escapeTelegramHtml(session.playedOn)}</b>`,
    winners.length > 0
      ? `In profit: ${winners.join(", ")}`
      : "Nobody finished in profit",
    ...(largestStack ? [`Largest stack: ${largestStack}`] : []),
    "",
    `<b>Players</b>\n${playerLines}`,
    "",
    `<b>Rounds</b>: ${session.rounds}`,
    `<b>Base pot</b>: ${formatMoney(basePot)} (${formatMoney(perPlayerShare(basePot))} per player)`,
    notes,
    "",
    `<a href="${escapeTelegramHtml(scoreboardUrl(req))}">Open the scoreboard</a>`,
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
}

async function announceSession(
  req: Request,
  session: SessionRecord,
  names: PlayerNames,
): Promise<AnnouncementOutcome> {
  try {
    const result = await sendTelegramMessage({
      text: sessionAnnouncement(req, session, names),
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

  const sessionError = validateSession(parsed.data);
  if (sessionError) {
    res.status(400).json({ error: sessionError });
    return;
  }

  let created: { session: SessionRecord; names: PlayerNames };
  try {
    created = await db.transaction(async (tx) => {
      const names = await loadReferencedPlayers(tx, parsed.data.playerBalances);

      const [session] = await tx
        .insert(mahjongSessionsTable)
        .values({
          playedOn: dateOnly(parsed.data.playedOn),
          rounds: parsed.data.rounds,
          basePot: parsed.data.basePot,
          playerBalances: toStoredBalances(parsed.data.playerBalances),
          notes: parsed.data.notes?.trim() || null,
          createdByUserId: userId,
        })
        .returning();
      if (!session) {
        throw new SessionRequestError({ error: "Session was not created" });
      }

      return { session, names };
    });
  } catch (err) {
    if (err instanceof SessionRequestError) {
      res.status(400).json(err.body);
      return;
    }
    throw err;
  }

  const announcement = await announceSession(req, created.session, created.names);
  res.status(201).json(
    CreateSessionResponse.parse({
      ...normalizeSession(created.session),
      announcement,
    }),
  );
});

router.get("/sessions/summary", async (req, res): Promise<void> => {
  const sessions = (
    await db
      .select()
      .from(mahjongSessionsTable)
      .orderBy(desc(mahjongSessionsTable.playedOn))
  ).map(normalizeSession);
  const names = await loadAllPlayerNames();

  type PlayerTotals = {
    profitNights: number;
    zhaHu: number;
    xieXieKaiXiang: number;
    netAmount: number;
  };
  const totalsByPlayer = new Map<number, PlayerTotals>();
  for (const session of sessions) {
    for (const player of session.playerBalances) {
      const totals = totalsByPlayer.get(player.playerId) ?? {
        profitNights: 0,
        zhaHu: 0,
        xieXieKaiXiang: 0,
        netAmount: 0,
      };
      if (isInProfit(player.endingAmount, session.basePot)) {
        totals.profitNights += 1;
      }
      totals.zhaHu += player.zhaHuCount;
      totals.xieXieKaiXiang += player.xieXieKaiXiangCount;
      // Amounts are whole dollars and shares are too (bases divide by four),
      // so this sum is exact.
      totals.netAmount += netWinnings(player.endingAmount, session.basePot);
      totalsByPlayer.set(player.playerId, totals);
    }
  }

  const rows = [...totalsByPlayer.entries()].map(([playerId, totals]) => ({
    playerId,
    playerName: playerName(names, playerId),
    ...totals,
  }));
  const byName = (a: { playerName: string }, b: { playerName: string }) =>
    a.playerName.localeCompare(b.playerName);

  res.json(
    GetSessionSummaryResponse.parse({
      totalSessions: sessions.length,
      totalRounds: sessions.reduce((total, session) => total + session.rounds, 0),
      latestSession: sessions[0] ?? null,
      profitNightCounts: rows
        .filter((row) => row.profitNights > 0)
        .sort((a, b) => b.profitNights - a.profitNights || byName(a, b))
        .map(({ playerId, playerName, profitNights }) => ({
          playerId,
          playerName,
          nights: profitNights,
        })),
      zhaHuCounts: [...rows]
        .sort((a, b) => b.zhaHu - a.zhaHu || byName(a, b))
        .map(({ playerId, playerName, zhaHu }) => ({ playerId, playerName, count: zhaHu })),
      xieXieKaiXiangCounts: [...rows]
        .sort((a, b) => b.xieXieKaiXiang - a.xieXieKaiXiang || byName(a, b))
        .map(({ playerId, playerName, xieXieKaiXiang }) => ({
          playerId,
          playerName,
          count: xieXieKaiXiang,
        })),
      playerWinnings: [...rows]
        .sort((a, b) => b.netAmount - a.netAmount || byName(a, b))
        .map(({ playerId, playerName, netAmount }) => ({ playerId, playerName, netAmount })),
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
  const userId = await requireAdmin(req, res);
  if (!userId) return;

  const params = UpdateSessionParams.safeParse(req.params);
  const body = UpdateSessionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : body.error?.message,
    });
    return;
  }

  let transactionResult: { session: SessionRecord } | { notFound: true };
  try {
    transactionResult = await db.transaction(async (tx) => {
      const update: Partial<typeof mahjongSessionsTable.$inferInsert> = {};
      if (body.data.basePot !== undefined || body.data.playerBalances !== undefined) {
        // Either half of the money can change on its own, so the rules are
        // checked against the session as it will be after this update.
        const [existing] = await tx
          .select({
            basePot: mahjongSessionsTable.basePot,
            playerBalances: mahjongSessionsTable.playerBalances,
          })
          .from(mahjongSessionsTable)
          .where(eq(mahjongSessionsTable.id, params.data.id));
        if (!existing) return { notFound: true };

        const basePot = body.data.basePot ?? existing.basePot;
        const sessionError = body.data.playerBalances
          ? validateSession({ basePot, playerBalances: body.data.playerBalances })
          : validateStakes(
              basePot,
              existing.playerBalances.map((balance) => balance.endingAmount),
            );
        if (sessionError) {
          throw new SessionRequestError({ error: sessionError });
        }
        update.basePot = basePot;

        if (body.data.playerBalances) {
          await loadReferencedPlayers(tx, body.data.playerBalances);
          update.playerBalances = toStoredBalances(body.data.playerBalances);
        }
      }
      if (body.data.playedOn) {
        update.playedOn = dateOnly(body.data.playedOn);
      }
      if (body.data.rounds !== undefined) {
        update.rounds = body.data.rounds;
      }
      if (body.data.notes !== undefined) {
        update.notes = body.data.notes?.trim() || null;
      }

      const [session] = await tx
        .update(mahjongSessionsTable)
        .set(update)
        .where(eq(mahjongSessionsTable.id, params.data.id))
        .returning();

      return session ? { session } : { notFound: true };
    });
  } catch (err) {
    if (err instanceof SessionRequestError) {
      res.status(400).json(err.body);
      return;
    }
    throw err;
  }

  if ("notFound" in transactionResult) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(UpdateSessionResponse.parse(normalizeSession(transactionResult.session)));
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
