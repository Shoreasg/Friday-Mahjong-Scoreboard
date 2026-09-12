import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MahjongSession } from "@workspace/api-client-react";
import { STARTING_BALANCE } from "@workspace/session-rules";
import {
  buildWinRates,
  buildWinningsData,
  getPlayerIdentities,
} from "./performanceAnalyticsData.ts";

type Balance = MahjongSession["playerBalances"][number];

function balance(name: string, endingAmount = STARTING_BALANCE): Balance {
  return {
    name,
    endingAmount,
    zhaHuCount: 0,
    xieXieKaiXiangCount: 0,
  };
}

function session(
  id: number,
  playedOn: string,
  winnerName: string,
  playerBalances: Balance[],
): MahjongSession {
  return {
    id,
    playedOn,
    rounds: 4,
    totalAmount: playerBalances.reduce(
      (total, player) => total + player.endingAmount,
      0,
    ),
    winnerName,
    playerBalances,
    notes: null,
    createdByUserId: null,
    createdAt: `${playedOn}T12:00:00.000Z`,
  };
}

describe("player identity normalization", () => {
  it("combines case-insensitive aliases while preserving spaces and punctuation", () => {
    const sessions = [
      session(1, "2026-01-02", "Mary Jane", [
        balance(" Mary Jane "),
        balance("O'Connor-Smith"),
      ]),
      session(2, "2026-01-09", "MARY JANE", [
        balance("MARY JANE"),
        balance("o'connor-smith"),
      ]),
    ];

    const players = getPlayerIdentities(sessions);

    assert.deepEqual(
      players.map(({ key }) => key).sort(),
      ["mary jane", "o'connor-smith"],
    );
    assert.equal(players.length, 2);
  });
});

describe("cumulative winnings", () => {
  it("starts a line at first appearance and carries it forward only afterward", () => {
    const sessions = [
      session(1, "2026-01-02", "Alice", [
        balance("Alice", 550),
        balance("Bob", 450),
      ]),
      session(2, "2026-01-09", "Cara", [
        balance("Cara", 575),
        balance("Bob", 425),
      ]),
      session(3, "2026-01-16", "Alice", [
        balance("Alice", 525),
        balance("Cara", 475),
      ]),
    ];
    const players = getPlayerIdentities(sessions);
    const seriesByName = new Map(
      players.map((player) => [player.key, player.seriesKey]),
    );

    const data = buildWinningsData(sessions, players);
    const alice = seriesByName.get("alice")!;
    const bob = seriesByName.get("bob")!;
    const cara = seriesByName.get("cara")!;

    assert.equal(data[0][cara], undefined);
    assert.equal(data[0][alice], 50);
    assert.equal(data[1][alice], 50);
    assert.equal(data[2][bob], -125);
    assert.equal(data[1][cara], 75);
    assert.equal(data[2][cara], 50);
  });

  it("ignores legacy sessions without balances and orders tied dates by id", () => {
    const sessions = [
      session(9, "2026-02-06", "Legacy Winner", []),
      session(4, "2026-02-13", "Alice", [balance("Alice", 525)]),
      session(3, "2026-02-13", "ALICE", [balance("ALICE", 550)]),
    ];
    const players = getPlayerIdentities(sessions);
    const alice = players[0].seriesKey;
    const data = buildWinningsData(sessions, players);

    assert.equal(data.length, 2);
    assert.deepEqual(data.map((point) => point[alice]), [50, 75]);
    assert.deepEqual(
      data.map((point) => point[`${alice}Delta`]),
      [50, 25],
    );
  });
});

describe("win rates", () => {
  it("uses each player's rotating-lineup appearances as the denominator", () => {
    const sessions = [
      session(1, "2026-03-06", "Alice", [
        balance("Alice"),
        balance("Bob"),
      ]),
      session(2, "2026-03-13", "Cara", [
        balance("Bob"),
        balance("Cara"),
      ]),
      session(3, "2026-03-20", "ALICE", [
        balance("alice"),
        balance("Cara"),
      ]),
      session(4, "2026-03-27", "Legacy Winner", []),
    ];

    const rates = buildWinRates(sessions, getPlayerIdentities(sessions));
    const byKey = new Map(rates.map((rate) => [rate.key, rate]));

    assert.deepEqual(
      {
        alice: [byKey.get("alice")?.wins, byKey.get("alice")?.sessions],
        bob: [byKey.get("bob")?.wins, byKey.get("bob")?.sessions],
        cara: [byKey.get("cara")?.wins, byKey.get("cara")?.sessions],
      },
      {
        alice: [2, 2],
        bob: [0, 2],
        cara: [1, 2],
      },
    );
  });

  it("orders equal rates deterministically by wins, then display name", () => {
    const sessions = [
      session(1, "2026-04-03", "Zed", [
        balance("Zed"),
        balance("Amy"),
      ]),
      session(2, "2026-04-10", "Amy", [
        balance("Zed"),
        balance("Amy"),
      ]),
      session(3, "2026-04-17", "Bob", [
        balance("Bob"),
        balance("Cal"),
      ]),
      session(4, "2026-04-24", "Cal", [
        balance("Bob"),
        balance("Cal"),
      ]),
    ];

    const rates = buildWinRates(sessions, getPlayerIdentities(sessions));

    assert.deepEqual(
      rates.map((rate) => rate.playerName),
      ["Amy", "Bob", "Cal", "Zed"],
    );
  });
});