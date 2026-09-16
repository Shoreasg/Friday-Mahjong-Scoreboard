import type { MahjongSession } from "@workspace/api-client-react";
import { isInProfit, netWinnings } from "@workspace/session-rules";
import { format, parseISO } from "date-fns";

export type PlayerIdentity = {
  key: number;
  name: string;
  seriesKey: string;
};

export type WinningsPoint = {
  date: string;
  dateLabel: string;
  [key: string]: string | number | undefined;
};

export type WinRate = {
  key: number;
  playerName: string;
  wins: number;
  sessions: number;
  winRate: number;
};

export function chronologicalSessions(sessions: MahjongSession[]) {
  return [...sessions].sort(
    (a, b) => a.playedOn.localeCompare(b.playedOn) || a.id - b.id,
  );
}

/**
 * One identity per player id appearing in the sessions, named from the player
 * record so a rename is reflected everywhere.
 */
export function getPlayerIdentities(
  sessions: MahjongSession[],
  playerNames: ReadonlyMap<number, string>,
): PlayerIdentity[] {
  const playerIds = new Set(
    sessions.flatMap((session) =>
      session.playerBalances.map((player) => player.playerId),
    ),
  );

  return [...playerIds]
    .map((key) => ({ key, name: playerNames.get(key) ?? `Player #${key}` }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key - b.key)
    .map((player, index) => ({
      ...player,
      seriesKey: `player${index}`,
    }));
}

export function buildWinningsData(
  sessions: MahjongSession[],
  players: PlayerIdentity[],
): WinningsPoint[] {
  const running = new Map<number, number>();
  const appeared = new Set<number>();

  return chronologicalSessions(sessions)
    .filter((session) => session.playerBalances.length > 0)
    .map((session) => {
      const point: WinningsPoint = {
        date: session.playedOn,
        dateLabel: format(parseISO(session.playedOn), "MMM d"),
      };
      const changes = new Map<number, number>();

      for (const player of session.playerBalances) {
        const key = player.playerId;
        const change = netWinnings(player.endingAmount, session.basePot);
        changes.set(key, change);
        running.set(key, (running.get(key) ?? 0) + change);
        appeared.add(key);
      }

      for (const player of players) {
        if (!appeared.has(player.key)) continue;
        point[player.seriesKey] = running.get(player.key) ?? 0;
        point[`${player.seriesKey}Delta`] = changes.get(player.key);
      }
      return point;
    });
}

export function buildWinRates(
  sessions: MahjongSession[],
  players: PlayerIdentity[],
): WinRate[] {
  const rates = new Map(
    players.map((player) => [
      player.key,
      {
        key: player.key,
        playerName: player.name,
        wins: 0,
        sessions: 0,
        winRate: 0,
      },
    ]),
  );

  for (const session of sessions) {
    if (session.playerBalances.length === 0) continue;
    for (const balance of session.playerBalances) {
      const player = rates.get(balance.playerId);
      if (!player) continue;
      player.sessions += 1;
      // A night counts as a win for everyone who finished above their share.
      if (isInProfit(balance.endingAmount, session.basePot)) player.wins += 1;
    }
  }

  return [...rates.values()]
    .filter((player) => player.sessions > 0)
    .map((player) => ({
      ...player,
      winRate: (player.wins / player.sessions) * 100,
    }))
    .sort(
      (a, b) =>
        b.winRate - a.winRate ||
        b.wins - a.wins ||
        a.playerName.localeCompare(b.playerName),
    );
}