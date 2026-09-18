import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MahjongSession } from "@workspace/api-client-react";
import {
  buildWinRates,
  buildWinningsData,
  getPlayerIdentities,
} from "./performanceAnalyticsData.ts";

type Balance = MahjongSession["playerBalances"][number];

// Player ids used throughout, with the names on their player records.
const ALICE = 1;
const BOB = 2;
const CARA = 3;
const playerNames = new Map([
  [ALICE, "Alice"],
  [BOB, "Bob"],
  [CARA, "Cara"],
]);

function balance(playerId: number, endingAmount = 500): Balance {
  return {
    playerId,
    endingAmount,
    zhaHuCount: 0,
    xieXieKaiXiangCount: 0,
  };
}

function session(
  id: number,
  playedOn: string,
  playerBalances: Balance[],
  basePot = 2000,
): MahjongSession {
  return {
    id,
    playedOn,
    rounds: 4,
    basePot,
    playerBalances,
    notes: null,
    createdByUserId: null,
    createdAt: `${playedOn}T12:00:00.000Z`,
  };
}

describe("player identity", () => {
  it("identifies players by id, named from the player record", () => {
    const sessions = [
      session(1, "2026-01-02", [balance(ALICE), balance(BOB)]),
      session(2, "2026-01-09", [balance(ALICE), balance(CARA)]),
    ];

    const players = getPlayerIdentities(sessions, new Map([...playerNames, [ALICE, "Alicia"]]));

    assert.deepEqual(
      players.map(({ key, name }) => [key, name]),
      [[ALICE, "Alicia"], [BOB, "Bob"], [CARA, "Cara"]],
    );
  });

  it("keeps two different players apart even when they share a name", () => {
    const sessions = [session(1, "2026-01-02", [balance(7), balance(8)])];

    const players = getPlayerIdentities(sessions, new Map([[7, "Alex"], [8, "Alex"]]));

    assert.equal(players.length, 2);
  });
});

describe("cumulative winnings", () => {
  it("starts a line at first appearance and carries it forward only afterward", () => {
    const sessions = [
      session(1, "2026-01-02", [
        balance(ALICE, 550),
        balance(BOB, 450),
      ]),
      session(2, "2026-01-09", [
        balance(CARA, 575),
        balance(BOB, 425),
      ]),
      session(3, "2026-01-16", [
        balance(ALICE, 525),
        balance(CARA, 475),
      ]),
    ];
    const players = getPlayerIdentities(sessions, playerNames);
    const seriesByName = new Map(
      players.map((player) => [player.key, player.seriesKey]),
    );

    const data = buildWinningsData(sessions, players);
    const alice = seriesByName.get(ALICE)!;
    const bob = seriesByName.get(BOB)!;
    const cara = seriesByName.get(CARA)!;

    assert.equal(data[0][cara], undefined);
    assert.equal(data[0][alice], 50);
    assert.equal(data[1][alice], 50);
    assert.equal(data[2][bob], -125);
    assert.equal(data[1][cara], 75);
    assert.equal(data[2][cara], 50);
  });

  it("ignores legacy sessions without balances and orders tied dates by id", () => {
    const sessions = [
      session(9, "2026-02-06", []),
      session(4, "2026-02-13", [balance(ALICE, 525)]),
      session(3, "2026-02-13", [balance(ALICE, 550)]),
    ];
    const players = getPlayerIdentities(sessions, playerNames);
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

describe("cumulative winnings against each session's own base", () => {
  it("measures each night against the share that night was played for", () => {
    const sessions = [
      session(1, "2026-05-01", [balance(ALICE, 560)], 2000),
      session(2, "2026-05-08", [balance(ALICE, 230)], 800),
    ];
    const players = getPlayerIdentities(sessions, playerNames);
    const alice = players[0].seriesKey;

    const data = buildWinningsData(sessions, players);

    assert.deepEqual(data.map((point) => point[alice]), [60, 90]);
    assert.deepEqual(
      data.map((point) => point[`${alice}Delta`]),
      [60, 30],
    );
  });
});

describe("win rates", () => {
  it("counts a win for every player who finished above their share, over the sessions they played", () => {
    const sessions = [
      // $2000 base, $500 share: Alice and Bob both finish in profit.
      session(1, "2026-03-06", [
        balance(ALICE, 600),
        balance(BOB, 550),
        balance(CARA, 350),
      ]),
      // Nobody beats their share; breaking even is not a win.
      session(2, "2026-03-13", [
        balance(BOB, 500),
        balance(CARA, 500),
      ]),
      session(3, "2026-03-20", [
        balance(ALICE, 501),
        balance(CARA, 499),
      ]),
      session(4, "2026-03-27", []),
    ];

    const rates = buildWinRates(sessions, getPlayerIdentities(sessions, playerNames));
    const byKey = new Map(rates.map((rate) => [rate.key, rate]));

    assert.deepEqual(
      {
        alice: [byKey.get(ALICE)?.wins, byKey.get(ALICE)?.sessions],
        bob: [byKey.get(BOB)?.wins, byKey.get(BOB)?.sessions],
        cara: [byKey.get(CARA)?.wins, byKey.get(CARA)?.sessions],
      },
      {
        alice: [2, 2],
        bob: [1, 2],
        cara: [0, 3],
      },
    );
  });

  it("orders equal rates deterministically by wins, then display name", () => {
    const [ZED, AMY, CAL] = [10, 11, 12];
    const names = new Map([...playerNames, [ZED, "Zed"], [AMY, "Amy"], [CAL, "Cal"]]);
    const sessions = [
      session(1, "2026-04-03", [balance(ZED, 600), balance(AMY, 400)]),
      session(2, "2026-04-10", [balance(ZED, 400), balance(AMY, 600)]),
      session(3, "2026-04-17", [balance(BOB, 600), balance(CAL, 400)]),
      session(4, "2026-04-24", [balance(BOB, 400), balance(CAL, 600)]),
    ];

    const rates = buildWinRates(sessions, getPlayerIdentities(sessions, names));

    assert.deepEqual(
      rates.map((rate) => rate.playerName),
      ["Amy", "Bob", "Cal", "Zed"],
    );
  });
});
