import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[] = [];
  const mutationResults: unknown[][] = [];

  function query(result: unknown) {
    const chain = {
      from: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      groupBy: vi.fn(),
      where: vi.fn(),
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    chain.from.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.groupBy.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    return chain;
  }

  const db = {
    execute: vi.fn(async () => ({ rows: [] })),
    select: vi.fn(() => query(selectResults.shift() ?? [])),
    insert: vi.fn(() => {
      const returning = vi.fn(async () => mutationResults.shift() ?? []);
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      return {
        values: vi.fn(() => ({ returning, onConflictDoNothing })),
      };
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => mutationResults.shift() ?? []),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => mutationResults.shift() ?? []),
      })),
    })),
  };
  return {
    selectResults,
    mutationResults,
    getUser: vi.fn(),
    telegramSend: vi.fn(),
    db: {
      ...db,
      transaction: vi.fn(async (callback: (transactionDb: typeof db) => unknown) =>
        callback(db),
      ),
    },
  };
});

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: mocks.getUser } },
  clerkMiddleware:
    () =>
    (req: { headers: Record<string, string | undefined>; testAuth?: unknown }, _res: unknown, next: () => void) => {
      const userId = req.headers["x-test-user"];
      req.testAuth = userId ? { userId, sessionClaims: { userId } } : {};
      next();
    },
  getAuth: (req: { testAuth?: unknown }) => req.testAuth ?? {},
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: mocks.db };
});

vi.mock("@workspace/integrations-telegram", () => ({
  sendTelegramMessage: mocks.telegramSend,
}));

import app from "../app";

const adminUserId = "admin-user";
const secondAdminUserId = "second-admin-user";
const viewerUserId = "viewer-user";
const adminEmail = "admin@example.com";
const secondAdminEmail = "second.admin@example.com";

const players = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Carol" },
  { id: 4, name: "Dave" },
];

type Balance = {
  playerId: number;
  endingAmount: number;
  zhaHuCount?: number;
  xieXieKaiXiangCount?: number;
};

function seats(amounts: number[], playerIds = [1, 2, 3, 4]): Balance[] {
  return amounts.map((endingAmount, index) => ({
    playerId: playerIds[index],
    endingAmount,
    zhaHuCount: 0,
    xieXieKaiXiangCount: 0,
  }));
}

// A $400 base pot: a $100 share each.
const session = {
  id: 1,
  playedOn: "2026-09-04",
  rounds: 4,
  basePot: 400,
  playerBalances: [
    { playerId: 1, endingAmount: 130, zhaHuCount: 1, xieXieKaiXiangCount: 1 },
    { playerId: 2, endingAmount: 100, zhaHuCount: 0, xieXieKaiXiangCount: 2 },
    { playerId: 3, endingAmount: 90, zhaHuCount: 2, xieXieKaiXiangCount: 0 },
    { playerId: 4, endingAmount: 80, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
  ],
  notes: null,
  createdByUserId: adminUserId,
  createdAt: new Date("2026-09-04T12:00:00Z"),
};

const createBody = {
  playedOn: "2026-09-04",
  rounds: 4,
  basePot: 400,
  playerBalances: session.playerBalances,
};

function sessionWith(
  overrides: { id?: number; basePot?: number; playerBalances: Balance[] },
) {
  return { ...session, ...overrides };
}

let server: Server;
let baseUrl: string;

async function request(
  path: string,
  init: RequestInit = {},
  userId?: string,
) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (userId) headers.set("x-test-user", userId);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function createSession(body: unknown) {
  return request(
    "/api/sessions",
    { method: "POST", body: JSON.stringify(body) },
    adminUserId,
  );
}

async function getSummary(sessions: unknown[], roster: unknown[] = players) {
  mocks.selectResults.push(sessions, roster);
  const response = await request("/api/sessions/summary");
  expect(response.status).toBe(200);
  return response.json();
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  process.env.ADMIN_EMAILS = ` ${adminEmail.toUpperCase()} , ${secondAdminEmail} `;
  mocks.selectResults.length = 0;
  mocks.mutationResults.length = 0;
  vi.clearAllMocks();
  mocks.telegramSend.mockResolvedValue({
    status: "skipped",
    reason: "not_configured",
  });
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.SCOREBOARD_URL;
  mocks.getUser.mockImplementation(async (userId: string) => ({
    emailAddresses: [{
      emailAddress:
        userId === adminUserId
          ? ` ${adminEmail} `
          : userId === secondAdminUserId
            ? secondAdminEmail.toUpperCase()
            : "viewer@example.com",
    }],
  }));
});

describe("session authorization", () => {
  it("allows public reads and defaults legacy incident counts to zero", async () => {
    const legacySession = sessionWith({
      playerBalances: session.playerBalances.map(({ playerId, endingAmount }) => ({
        playerId,
        endingAmount,
      })),
    });
    mocks.selectResults.push([legacySession]);

    const listResponse = await request("/api/sessions");

    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject([{
      playerBalances: [
        { playerId: 1, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
        { playerId: 2, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
        { playerId: 3, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
        { playerId: 4, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
      ],
    }]);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/api/sessions", createBody],
    ["PATCH", "/api/sessions/1", { rounds: 5 }],
    ["DELETE", "/api/sessions/1", undefined],
  ])("returns 401 for signed-out %s requests", async (method, path, body) => {
    const response = await request(path, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
    expect(response.status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/api/sessions", createBody],
    ["PATCH", "/api/sessions/1", { rounds: 5 }],
    ["DELETE", "/api/sessions/1", undefined],
  ])("returns 403 for non-admin %s requests", async (method, path, body) => {
    const response = await request(
      path,
      { method, body: body ? JSON.stringify(body) : undefined },
      viewerUserId,
    );
    expect(response.status).toBe(403);
  });

  it.each([
    ["existing", adminUserId],
    ["second", secondAdminUserId],
  ])("allows the %s configured admin to create, update, and delete sessions", async (_label, userId) => {
    mocks.selectResults.push(players);
    mocks.mutationResults.push([session]);
    const createResponse = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(createBody) },
      userId,
    );
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toMatchObject({
      basePot: 400,
      playerBalances: [
        { playerId: 1 },
        { playerId: 2 },
        { playerId: 3 },
        { playerId: 4 },
      ],
    });

    mocks.mutationResults.push([{ ...session, rounds: 5 }]);
    const updateResponse = await request(
      "/api/sessions/1",
      { method: "PATCH", body: JSON.stringify({ rounds: 5 }) },
      userId,
    );
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({ id: 1, rounds: 5 });

    mocks.mutationResults.push([{ id: 1 }]);
    const deleteResponse = await request(
      "/api/sessions/1",
      { method: "DELETE" },
      userId,
    );
    expect(deleteResponse.status).toBe(204);
    expect(mocks.getUser).toHaveBeenCalledTimes(3);
    expect(mocks.telegramSend).toHaveBeenCalledTimes(1);
  });

  it("returns 500 for signed-in writes when the admin list is missing", async () => {
    delete process.env.ADMIN_EMAILS;

    const response = await createSession(createBody);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Admin access is not configured",
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("returns 500 for signed-in writes when the admin list contains only whitespace", async () => {
    process.env.ADMIN_EMAILS = " ,  , ";

    const response = await createSession(createBody);

    expect(response.status).toBe(500);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
});

describe("session balances reference players", () => {
  it("stores only the player reference on each balance, never a copied name", async () => {
    mocks.selectResults.push(players);
    mocks.mutationResults.push([session]);

    const response = await createSession({
      ...createBody,
      playerBalances: createBody.playerBalances.map((balance, index) =>
        index === 0 ? { ...balance, name: "Stale Name" } : balance,
      ),
    });

    expect(response.status).toBe(201);
    const [insertCall] = mocks.db.insert.mock.results;
    const valuesMock = (insertCall?.value as { values: ReturnType<typeof vi.fn> }).values;
    const stored = valuesMock.mock.calls[0]?.[0] as { playerBalances: object[] };
    expect(stored.playerBalances).toEqual(session.playerBalances);
    for (const balance of stored.playerBalances) {
      expect(balance).not.toHaveProperty("name");
    }
    expect(await response.json()).not.toHaveProperty("winnerName");
  });

  it("rejects a player reference that does not exist", async () => {
    mocks.selectResults.push(players.slice(1));

    const response = await createSession({
      ...createBody,
      playerBalances: seats([130, 100, 90, 80], [999, 2, 3, 4]),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "playerId 999 does not reference an existing player",
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("rejects the same player in two seats before touching the database", async () => {
    const response = await createSession({
      ...createBody,
      playerBalances: seats([130, 100, 90, 80], [1, 1, 3, 4]),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A player cannot be recorded twice in one session",
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("rejects a seat with no player reference", async () => {
    const response = await createSession({
      ...createBody,
      playerBalances: createBody.playerBalances.map((balance, index) =>
        index === 0 ? { name: "Alice", endingAmount: balance.endingAmount, zhaHuCount: 0, xieXieKaiXiangCount: 0 } : balance,
      ),
    });

    expect(response.status).toBe(400);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("validates replaced balances on update, including their player references", async () => {
    mocks.selectResults.push([session], players.slice(0, 3));

    const response = await request(
      "/api/sessions/1",
      {
        method: "PATCH",
        body: JSON.stringify({ playerBalances: seats([130, 100, 90, 80], [1, 2, 3, 77]) }),
      },
      adminUserId,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "playerId 77 does not reference an existing player",
    });
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5])(
    "rejects an invalid Zha Hu count of %s",
    async (zhaHuCount) => {
      const response = await createSession({
        ...createBody,
        playerBalances: createBody.playerBalances.map((player, index) =>
          index === 0 ? { ...player, zhaHuCount } : player,
        ),
      });
      expect(response.status).toBe(400);
      expect(mocks.db.insert).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 1.5])(
    "rejects an invalid 谢谢 Kai Xiang count of %s",
    async (xieXieKaiXiangCount) => {
      const response = await createSession({
        ...createBody,
        playerBalances: createBody.playerBalances.map((player, index) =>
          index === 0 ? { ...player, xieXieKaiXiangCount } : player,
        ),
      });
      expect(response.status).toBe(400);
      expect(mocks.db.insert).not.toHaveBeenCalled();
    },
  );
});

describe("session stakes", () => {
  it.each([0, -400, 400.5, 402])(
    "rejects a base pot of %s that is not a positive whole number divisible by four",
    async (basePot) => {
      const response = await createSession({
        ...createBody,
        basePot,
        playerBalances: seats([basePot, 0, 0, 0]),
      });

      expect(response.status).toBe(400);
      expect(mocks.db.transaction).not.toHaveBeenCalled();
      expect(mocks.db.insert).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["short of", [130, 100, 90, 79], "Ending amounts are $1 short of the $400 base pot"],
    ["over", [130, 100, 90, 90], "Ending amounts exceed the $400 base pot by $10"],
  ])("rejects ending amounts that fall %s the base pot", async (_label, amounts, error) => {
    const response = await createSession({
      ...createBody,
      playerBalances: seats(amounts as number[]),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-integer", 129.5],
    ["a negative", -30],
  ])("rejects %s ending amount", async (_label, amount) => {
    const response = await createSession({
      ...createBody,
      playerBalances: seats([amount, 100, 90, 210 - amount]),
    });

    expect(response.status).toBe(400);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("accepts a player who busted out at zero", async () => {
    const bustedBalances = seats([220, 100, 80, 0]);
    mocks.selectResults.push(players);
    mocks.mutationResults.push([sessionWith({ playerBalances: bustedBalances })]);

    const response = await createSession({ ...createBody, playerBalances: bustedBalances });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      basePot: 400,
      playerBalances: [
        { endingAmount: 220 },
        { endingAmount: 100 },
        { endingAmount: 80 },
        { endingAmount: 0 },
      ],
    });
  });

  it("stores the base pot the creator supplied", async () => {
    const balances = seats([700, 500, 450, 350]);
    mocks.selectResults.push(players);
    mocks.mutationResults.push([sessionWith({ basePot: 2000, playerBalances: balances })]);

    const response = await createSession({ ...createBody, basePot: 2000, playerBalances: balances });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ basePot: 2000 });
  });

  it("rejects changing only the base pot when the saved amounts no longer sum to it", async () => {
    mocks.selectResults.push([session]);

    const response = await request(
      "/api/sessions/1",
      { method: "PATCH", body: JSON.stringify({ basePot: 2000 }) },
      adminUserId,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Ending amounts are $1600 short of the $2000 base pot",
    });
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("accepts a new base pot together with amounts rebalanced to it", async () => {
    const rebalanced = seats([800, 500, 400, 300]);
    mocks.selectResults.push([session], players);
    mocks.mutationResults.push([sessionWith({ basePot: 2000, playerBalances: rebalanced })]);

    const response = await request(
      "/api/sessions/1",
      {
        method: "PATCH",
        body: JSON.stringify({ basePot: 2000, playerBalances: rebalanced }),
      },
      adminUserId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ basePot: 2000 });
  });

  it("rejects rebalanced amounts that don't sum to the saved base pot", async () => {
    mocks.selectResults.push([session]);

    const response = await request(
      "/api/sessions/1",
      {
        method: "PATCH",
        body: JSON.stringify({ playerBalances: seats([130, 100, 90, 81]) }),
      },
      adminUserId,
    );

    expect(response.status).toBe(400);
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("accepts a base-only change on a legacy session that has no balances", async () => {
    mocks.selectResults.push([sessionWith({ playerBalances: [] })]);
    mocks.mutationResults.push([sessionWith({ basePot: 800, playerBalances: [] })]);

    const response = await request(
      "/api/sessions/1",
      { method: "PATCH", body: JSON.stringify({ basePot: 800 }) },
      adminUserId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ basePot: 800 });
  });

  it("still rejects an invalid base pot on a legacy session that has no balances", async () => {
    mocks.selectResults.push([sessionWith({ playerBalances: [] })]);

    const response = await request(
      "/api/sessions/1",
      { method: "PATCH", body: JSON.stringify({ basePot: 402 }) },
      adminUserId,
    );

    expect(response.status).toBe(400);
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("returns 404 when changing the stakes of a session that doesn't exist", async () => {
    mocks.selectResults.push([]);

    const response = await request(
      "/api/sessions/99",
      { method: "PATCH", body: JSON.stringify({ basePot: 400 }) },
      adminUserId,
    );

    expect(response.status).toBe(404);
  });
});

describe("session summary", () => {
  it("aggregates every statistic by player identity across sessions, named from the player record", async () => {
    const secondSession = sessionWith({
      id: 2,
      playerBalances: [
        { playerId: 1, endingAmount: 120, zhaHuCount: 2, xieXieKaiXiangCount: 2 },
        { playerId: 2, endingAmount: 110, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
        { playerId: 5, endingAmount: 90, zhaHuCount: 4, xieXieKaiXiangCount: 4 },
        { playerId: 6, endingAmount: 80, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
      ],
    });
    // Player 1 has since been renamed; 5 and 6 share a display name but are
    // different people, so they must stay separate rows.
    const roster = [
      { id: 1, name: "Alicia" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Carol" },
      { id: 4, name: "Dave" },
      { id: 5, name: "Alex" },
      { id: 6, name: "Alex" },
    ];

    const summary = await getSummary([session, secondSession], roster);

    expect(summary).toMatchObject({
      totalSessions: 2,
      totalRounds: 8,
      zhaHuCounts: [
        { playerId: 5, playerName: "Alex", count: 4 },
        { playerId: 1, playerName: "Alicia", count: 3 },
        { playerId: 3, playerName: "Carol", count: 2 },
        { playerId: 2, playerName: "Bob", count: 1 },
        { playerId: 6, playerName: "Alex", count: 0 },
        { playerId: 4, playerName: "Dave", count: 0 },
      ],
      xieXieKaiXiangCounts: [
        { playerId: 5, count: 4 },
        { playerId: 1, count: 3 },
        { playerId: 2, count: 2 },
        { playerId: 6, count: 0 },
        { playerId: 3, count: 0 },
        { playerId: 4, count: 0 },
      ],
    });
    expect(summary).not.toHaveProperty("totalAmount");
    expect(summary).not.toHaveProperty("winnerCounts");
    const names = (summary as { playerWinnings: { playerName: string }[] }).playerWinnings.map(
      (row) => row.playerName,
    );
    expect(names).not.toContain("Alice");
    expect(names.filter((name) => name === "Alicia")).toHaveLength(1);
  });

  it("calculates cumulative winnings from each session's own base pot", async () => {
    // $2000 base: a $500 share each.
    const firstSession = sessionWith({
      basePot: 2000,
      playerBalances: seats([565, 510, 525, 400], [1, 2, 3, 4]),
    });
    // $800 base: a $200 share each, so Alice's 200 breaks even here rather
    // than counting as a $300 loss against the customary stakes.
    const secondSession = sessionWith({
      id: 2,
      basePot: 800,
      playerBalances: seats([200, 190, 145, 265], [1, 2, 5, 6]),
    });
    const legacySession = sessionWith({ id: 3, playerBalances: [] });
    const roster = [
      { id: 1, name: "Tom" },
      { id: 2, name: "Dick" },
      { id: 3, name: "Harry" },
      { id: 4, name: "Ben" },
      { id: 5, name: "Ivy" },
      { id: 6, name: "Zoe" },
    ];

    const summary = await getSummary([firstSession, secondSession, legacySession], roster);

    expect(summary).toMatchObject({
      totalSessions: 3,
      playerWinnings: [
        { playerName: "Tom", netAmount: 65 },
        { playerName: "Zoe", netAmount: 65 },
        { playerName: "Harry", netAmount: 25 },
        { playerName: "Dick", netAmount: 0 },
        { playerName: "Ivy", netAmount: -55 },
        { playerName: "Ben", netAmount: -100 },
      ],
    });
  });

  it("credits every player who finished above their share, and nobody on a night with no winners", async () => {
    // $400 base, $100 share. Two players in profit.
    const twoWinners = sessionWith({ playerBalances: seats([150, 110, 100, 40]) });
    // One player in profit.
    const oneWinner = sessionWith({ id: 2, playerBalances: seats([100, 100, 99, 101]) });
    // Everyone broke even: finishing exactly on the share is not a win.
    const noWinners = sessionWith({ id: 3, playerBalances: seats([100, 100, 100, 100]) });

    const summary = await getSummary([twoWinners, oneWinner, noWinners]);

    expect(summary).toMatchObject({
      profitNightCounts: [
        { playerId: 1, playerName: "Alice", nights: 1 },
        { playerId: 2, playerName: "Bob", nights: 1 },
        { playerId: 4, playerName: "Dave", nights: 1 },
      ],
    });
    expect(
      (summary as { profitNightCounts: unknown[] }).profitNightCounts,
    ).toHaveLength(3);
  });

  it("counts the same player's profitable nights together", async () => {
    const summary = await getSummary([
      sessionWith({ playerBalances: seats([130, 100, 90, 80]) }),
      sessionWith({ id: 2, playerBalances: seats([101, 99, 100, 100]) }),
      sessionWith({ id: 3, playerBalances: seats([90, 110, 100, 100]) }),
    ]);

    expect(summary).toMatchObject({
      profitNightCounts: [
        { playerId: 1, nights: 2 },
        { playerId: 2, nights: 1 },
      ],
    });
  });
});

describe("session announcements", () => {
  it("announces a newly created session with escaped HTML and delivery metadata", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    process.env.SCOREBOARD_URL = "https://scoreboard.example/app";
    mocks.telegramSend.mockResolvedValue({ status: "sent", messageId: 42 });
    mocks.selectResults.push([{ id: 1, name: "A & <Ace>" }, ...players.slice(1)]);
    mocks.mutationResults.push([{ ...session, notes: "Bring snacks & <tea>" }]);

    const response = await createSession(createBody);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      announcement: { status: "sent", messageId: 42 },
    });
    expect(mocks.telegramSend).toHaveBeenCalledWith({
      parseMode: "HTML",
      text: expect.stringContaining("A &amp; &lt;Ace&gt;"),
    });
    const [{ text }] = mocks.telegramSend.mock.calls[0] as [{ text: string }];
    expect(text).toContain("https://scoreboard.example/app");
    // Net positions are measured against this session's own $400 base,
    // i.e. a $100 share each. Bob's even finish is not "in profit".
    expect(text).toContain("In profit: <b>A &amp; &lt;Ace&gt;</b> (+$30.00)");
    expect(text).toContain("Largest stack: A &amp; &lt;Ace&gt;");
    expect(text).toContain("$130.00 (+$30.00)");
    expect(text).toContain("<b>Bob</b> · $100.00 (+$0.00)");
    expect(text).toContain("$90.00 (-$10.00)");
    expect(text).toContain("$80.00 (-$20.00)");
    expect(text).toContain("<b>Rounds</b>: 4");
    expect(text).toContain("<b>Base pot</b>: $400.00 ($100.00 per player)");
    expect(text).toContain("诈胡 1");
    expect(text).toContain("谢谢开相 1");
    expect(text).toContain("Bring snacks &amp; &lt;tea&gt;");
    expect(text).not.toContain("A & <Ace>");
  });

  it("says so when nobody finished in profit", async () => {
    const evenNight = seats([100, 100, 100, 100]);
    mocks.selectResults.push(players);
    mocks.mutationResults.push([sessionWith({ playerBalances: evenNight })]);

    await createSession({ ...createBody, playerBalances: evenNight });

    const [{ text }] = mocks.telegramSend.mock.calls[0] as [{ text: string }];
    expect(text).toContain("Nobody finished in profit");
    expect(text).toContain("Largest stack: Alice, Bob, Carol, Dave");
  });

  it("persists a session and reports a failed announcement separately", async () => {
    mocks.telegramSend.mockRejectedValue(new Error("Telegram is unavailable"));
    mocks.selectResults.push(players);
    mocks.mutationResults.push([session]);

    const response = await createSession(createBody);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: session.id,
      announcement: { status: "failed", reason: "delivery_failed" },
    });
  });
});
