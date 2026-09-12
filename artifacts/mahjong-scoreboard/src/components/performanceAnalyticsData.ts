import type { MahjongSession } from "@workspace/api-client-react";
import {
  normalizePlayerName,
  STARTING_BALANCE,
} from "@workspace/session-rules";
import { format, parseISO } from "date-fns";

export type PlayerIdentity = {
  key: string;
  name: string;
  seriesKey: string;
};

export type WinningsPoint = {
  date: string;
  dateLabel: string;
  [key: string]: string | number | undefined;
};

export type WinRate = {
  key: string;
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

export function getPlayerIdentities(
  sessions: MahjongSession[],
): PlayerIdentity[] {
  const namesByKey = new Map<string, Set<string>>();
  for (const session of sessions) {
    for (const player of session.playerBalances) {
      const name = player.name.trim();
      const key = normalizePlayerName(name);
      if (!key) continue;
      const names = namesByKey.get(key) ?? new Set<string>();
      names.add(name);
      namesByKey.set(key, names);
    }
  }

  return [...namesByKey.entries()]
    .map(([key, names]) => ({
      key,
      name: [...names].sort((a, b) => a.localeCompare(b))[0],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((player, index) => ({
      ...player,
      seriesKey: `player${index}`,
    }));
}

export function buildWinningsData(
  sessions: MahjongSession[],
  players: PlayerIdentity[],
): WinningsPoint[] {
  const running = new Map<string, number>();
  const appeared = new Set<string>();

  return chronologicalSessions(sessions)
    .filter((session) => session.playerBalances.length > 0)
    .map((session) => {
      const point: WinningsPoint = {
        date: session.playedOn,
        dateLabel: format(parseISO(session.playedOn), "MMM d"),
      };
      const changes = new Map<string, number>();

      for (const player of session.playerBalances) {
        const key = normalizePlayerName(player.name);
        const change = player.endingAmount - STARTING_BALANCE;
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
    const participants = new Set(
      session.playerBalances.map((player) => normalizePlayerName(player.name)),
    );
    for (const key of participants) {
      const player = rates.get(key);
      if (player) player.sessions += 1;
    }
    const winner = rates.get(normalizePlayerName(session.winnerName));
    if (winner && participants.has(winner.key)) winner.wins += 1;
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