import { db, pool, mahjongSessionsTable } from "./index";
import type { PlayerBalance } from "./schema/mahjong-sessions";

/*
 * All names, dates and amounts below are fictional. This seed exists only
 * to give a freshly provisioned local database something to show on the
 * scoreboard, leaderboards and analytics charts — never copy production
 * data here.
 */
type SeedSession = {
  playedOn: string;
  rounds: number;
  notes: string | null;
  playerBalances: PlayerBalance[];
};

const seedSessions: SeedSession[] = [
  {
    playedOn: "2026-06-05",
    rounds: 16,
    notes: "First game of the summer, played on the balcony.",
    playerBalances: [
      { name: "Nadia Cho", endingAmount: 700, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
      { name: "Marco Silva", endingAmount: 550, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
      { name: "Priya Nair", endingAmount: 450, zhaHuCount: 2, xieXieKaiXiangCount: 0 },
      { name: "Jonas Berg", endingAmount: 300, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
    ],
  },
  {
    playedOn: "2026-06-12",
    rounds: 14,
    notes: null,
    playerBalances: [
      { name: "Marco Silva", endingAmount: 800, zhaHuCount: 2, xieXieKaiXiangCount: 0 },
      { name: "Nadia Cho", endingAmount: 500, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
      { name: "Priya Nair", endingAmount: 400, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
      { name: "Jonas Berg", endingAmount: 300, zhaHuCount: 0, xieXieKaiXiangCount: 2 },
    ],
  },
  {
    playedOn: "2026-06-19",
    rounds: 18,
    notes: "Priya's lucky night.",
    playerBalances: [
      { name: "Priya Nair", endingAmount: 650, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
      { name: "Jonas Berg", endingAmount: 550, zhaHuCount: 0, xieXieKaiXiangCount: 2 },
      { name: "Nadia Cho", endingAmount: 450, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
      { name: "Marco Silva", endingAmount: 350, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
    ],
  },
  {
    playedOn: "2026-06-26",
    rounds: 20,
    notes: null,
    playerBalances: [
      { name: "Jonas Berg", endingAmount: 900, zhaHuCount: 2, xieXieKaiXiangCount: 0 },
      { name: "Priya Nair", endingAmount: 500, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
      { name: "Marco Silva", endingAmount: 350, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
      { name: "Nadia Cho", endingAmount: 250, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
    ],
  },
  {
    playedOn: "2026-07-03",
    rounds: 15,
    notes: "Wendy sat in for Jonas this week.",
    playerBalances: [
      { name: "Nadia Cho", endingAmount: 600, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
      { name: "Wendy Tan", endingAmount: 500, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
      { name: "Marco Silva", endingAmount: 500, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
      { name: "Priya Nair", endingAmount: 400, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
    ],
  },
  {
    playedOn: "2026-07-10",
    rounds: 17,
    notes: null,
    playerBalances: [
      { name: "Marco Silva", endingAmount: 750, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
      { name: "Jonas Berg", endingAmount: 550, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
      { name: "Priya Nair", endingAmount: 300, zhaHuCount: 2, xieXieKaiXiangCount: 0 },
      { name: "Nadia Cho", endingAmount: 400, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
    ],
  },
  {
    playedOn: "2026-07-17",
    rounds: 13,
    notes: "Farid filled in for Priya.",
    playerBalances: [
      { name: "Jonas Berg", endingAmount: 700, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
      { name: "Nadia Cho", endingAmount: 500, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
      { name: "Farid Haque", endingAmount: 400, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
      { name: "Marco Silva", endingAmount: 400, zhaHuCount: 0, xieXieKaiXiangCount: 2 },
    ],
  },
  {
    playedOn: "2026-07-24",
    rounds: 19,
    notes: null,
    playerBalances: [
      { name: "Priya Nair", endingAmount: 800, zhaHuCount: 2, xieXieKaiXiangCount: 0 },
      { name: "Marco Silva", endingAmount: 500, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
      { name: "Nadia Cho", endingAmount: 400, zhaHuCount: 0, xieXieKaiXiangCount: 1 },
      { name: "Jonas Berg", endingAmount: 300, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
    ],
  },
];

function winnerOf(playerBalances: PlayerBalance[]): string {
  return [...playerBalances].sort(
    (a, b) => b.endingAmount - a.endingAmount || a.name.localeCompare(b.name),
  )[0].name;
}

async function seed(): Promise<void> {
  const existing = await db
    .select({ id: mahjongSessionsTable.id })
    .from(mahjongSessionsTable)
    .limit(1);

  if (existing.length > 0) {
    console.log(
      "mahjong_sessions already has rows — skipping seed (restarting the stack never overwrites your data).",
    );
    return;
  }

  await db.insert(mahjongSessionsTable).values(
    seedSessions.map((session) => ({
      playedOn: session.playedOn,
      rounds: session.rounds,
      totalAmount: session.playerBalances.reduce(
        (total, balance) => total + balance.endingAmount,
        0,
      ),
      winnerName: winnerOf(session.playerBalances),
      playerBalances: session.playerBalances,
      notes: session.notes,
      createdByUserId: null,
    })),
  );

  console.log(`Seeded ${seedSessions.length} fictional Mahjong sessions.`);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
