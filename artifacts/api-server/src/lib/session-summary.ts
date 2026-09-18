import { db, mahjongSessionsTable, playersTable } from "@workspace/db";
import { isInProfit, netWinnings } from "@workspace/session-rules";
import { desc } from "drizzle-orm";

export type SessionRecord = typeof mahjongSessionsTable.$inferSelect;
export type PlayerNames = Map<number, string>;

export async function loadAllPlayerNames(): Promise<PlayerNames> {
  const players = await db
    .select({ id: playersTable.id, name: playersTable.name })
    .from(playersTable);
  return new Map(players.map((player) => [player.id, player.name]));
}

export function playerName(names: PlayerNames, playerId: number): string {
  return names.get(playerId) ?? `Player #${playerId}`;
}

/** Shapes a stored session for responses, defaulting legacy incident counts. */
export function normalizeSession(session: SessionRecord) {
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

/**
 * Total sessions, total rounds, the latest session, and every per-player
 * aggregate (nights finished in profit, incident counts, net winnings)
 * across all recorded sessions.
 *
 * Shared by the summary HTTP route and the `/last` and `/standings` Telegram
 * commands so the scoreboard and the bot can never disagree about who is up.
 */
export async function getSessionSummary() {
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

  return {
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
  };
}

export type SessionSummaryResult = Awaited<ReturnType<typeof getSessionSummary>>;
