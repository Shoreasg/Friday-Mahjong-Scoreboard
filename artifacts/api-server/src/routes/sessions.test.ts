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
    selectResults,
    mutationResults,
    getUser: vi.fn(),
    select: vi.fn(() => query(selectResults.shift() ?? [])),
    insert: vi.fn(() => {
      const returning = vi.fn(async () => mutationResults.shift() ?? []);
      return {
        values: vi.fn(() => ({ returning })),
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
    getUser: db.getUser,
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

const session = {
  id: 1,
  playedOn: "2026-09-04",
  rounds: 4,
  totalAmount: 400,
  winnerName: "Alice",
  playerBalances: [
    { name: "Alice", endingAmount: 130, zhaHuCount: 1, xieXieKaiXiangCount: 1 },
    { name: "Bob", endingAmount: 100, zhaHuCount: 0, xieXieKaiXiangCount: 2 },
    { name: "Carol", endingAmount: 90, zhaHuCount: 2, xieXieKaiXiangCount: 0 },
    { name: "Dave", endingAmount: 80, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
  ],
  notes: null,
  createdByUserId: adminUserId,
  createdAt: new Date("2026-09-04T12:00:00Z"),
};

const createBody = {
  playedOn: "2026-09-04",
  rounds: 4,
  playerBalances: session.playerBalances,
};
const writablePlayers = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
  { id: 3, name: "Carol" },
  { id: 4, name: "Dave" },
];

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
    const legacySession = {
      ...session,
      playerBalances: session.playerBalances.map(
        ({
          zhaHuCount: _zhaHuCount,
          xieXieKaiXiangCount: _xieXieKaiXiangCount,
          ...player
        }) => player,
      ),
    };
    mocks.selectResults.push([legacySession]);
    const listResponse = await request("/api/sessions");
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject([{
      playerBalances: [
        { name: "Alice", zhaHuCount: 0, xieXieKaiXiangCount: 0 },
        { name: "Bob", zhaHuCount: 0, xieXieKaiXiangCount: 0 },
        { name: "Carol", zhaHuCount: 0, xieXieKaiXiangCount: 0 },
        { name: "Dave", zhaHuCount: 0, xieXieKaiXiangCount: 0 },
      ],
    }]);

    const secondSession = {
      ...session,
      id: 2,
      playerBalances: [
        { name: "alice", endingAmount: 120, zhaHuCount: 2, xieXieKaiXiangCount: 2 },
        { name: "BOB", endingAmount: 110, zhaHuCount: 1, xieXieKaiXiangCount: 0 },
        { name: "Eve", endingAmount: 90, zhaHuCount: 4, xieXieKaiXiangCount: 4 },
        { name: "Frank", endingAmount: 80, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
      ],
    };
    mocks.selectResults.push(
      [{ totalSessions: 2, totalRounds: 8, totalAmount: 800 }],
      [session, secondSession],
      [{ winnerName: "Alice", wins: 1 }],
    );
    const summaryResponse = await request("/api/sessions/summary");
    expect(summaryResponse.status).toBe(200);
    expect(await summaryResponse.json()).toMatchObject({
      totalSessions: 2,
      winnerCounts: [{ winnerName: "Alice", wins: 1 }],
      zhaHuCounts: [
        { playerName: "Eve", count: 4 },
        { playerName: "Alice", count: 3 },
        { playerName: "Carol", count: 2 },
        { playerName: "Bob", count: 1 },
        { playerName: "Dave", count: 0 },
        { playerName: "Frank", count: 0 },
      ],
      xieXieKaiXiangCounts: [
        { playerName: "Eve", count: 4 },
        { playerName: "Alice", count: 3 },
        { playerName: "Bob", count: 2 },
        { playerName: "Carol", count: 0 },
        { playerName: "Dave", count: 0 },
        { playerName: "Frank", count: 0 },
      ],
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("calculates cumulative winnings and losses from the $500 starting balance", async () => {
    const firstSession = {
      ...session,
      playerBalances: [
        { name: "Tom", endingAmount: 565, zhaHuCount: 0 },
        { name: "Dick", endingAmount: 510, zhaHuCount: 0 },
        { name: "Harry", endingAmount: 450, zhaHuCount: 0 },
        { name: "Ben", endingAmount: 400, zhaHuCount: 0 },
      ],
    };
    const secondSession = {
      ...session,
      id: 2,
      playerBalances: [
        { name: "tom", endingAmount: 500, zhaHuCount: 0 },
        { name: "DICK", endingAmount: 490, zhaHuCount: 0 },
        { name: "Ivy", endingAmount: 500, zhaHuCount: 0 },
        { name: "Zoe", endingAmount: 565, zhaHuCount: 0 },
      ],
    };
    const legacySession = {
      ...session,
      id: 3,
      playerBalances: [],
    };
    mocks.selectResults.push(
      [{ totalSessions: 3, totalRounds: 12, totalAmount: 3980 }],
      [firstSession, secondSession, legacySession],
      [],
    );

    const response = await request("/api/sessions/summary");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      playerWinnings: [
        { playerName: "Tom", netAmount: 65 },
        { playerName: "Zoe", netAmount: 65 },
        { playerName: "Dick", netAmount: 0 },
        { playerName: "Ivy", netAmount: 0 },
        { playerName: "Harry", netAmount: -50 },
        { playerName: "Ben", netAmount: -100 },
      ],
    });
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
    mocks.selectResults.push(writablePlayers);
    const linkedSession = {
      ...session,
      playerBalances: session.playerBalances.map((player, index) => ({
        ...player,
        playerId: index + 1,
      })),
    };
    mocks.mutationResults.push([linkedSession]);
    const createResponse = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(createBody) },
      userId,
    );
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toMatchObject({
      playerBalances: [
        { name: "Alice", playerId: 1 },
        { name: "Bob", playerId: 2 },
        { name: "Carol", playerId: 3 },
        { name: "Dave", playerId: 4 },
      ],
    });

    const updatedSession = { ...session, rounds: 5 };
    mocks.mutationResults.push([updatedSession]);
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

  it("creates and links a player for a first-time name-only write", async () => {
    const guestBody = {
      ...createBody,
      playerBalances: createBody.playerBalances.map((player, index) =>
        index === 0 ? { ...player, name: "Guest" } : player,
      ),
    };
    const linkedSession = {
      ...session,
      playerBalances: guestBody.playerBalances.map((player, index) => ({
        ...player,
        playerId: index === 0 ? 5 : index + 1,
      })),
    };
    mocks.selectResults.push(writablePlayers);
    mocks.mutationResults.push(
      [{ id: 5, name: "Guest" }],
      [linkedSession],
    );

    const response = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(guestBody) },
      adminUserId,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      playerBalances: [
        { name: "Guest", playerId: 5 },
        { name: "Bob", playerId: 2 },
        { name: "Carol", playerId: 3 },
        { name: "Dave", playerId: 4 },
      ],
    });
  });

  it("resolves name-only player balances during updates", async () => {
    const linkedSession = {
      ...session,
      playerBalances: session.playerBalances.map((player, index) => ({
        ...player,
        playerId: index + 1,
      })),
    };
    mocks.selectResults.push(writablePlayers);
    mocks.mutationResults.push([linkedSession]);

    const response = await request(
      "/api/sessions/1",
      {
        method: "PATCH",
        body: JSON.stringify({ playerBalances: createBody.playerBalances }),
      },
      adminUserId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      playerBalances: [
        { name: "Alice", playerId: 1 },
        { name: "Bob", playerId: 2 },
        { name: "Carol", playerId: 3 },
        { name: "Dave", playerId: 4 },
      ],
    });
  });

  it("resolves mixed explicit and name-only player balances", async () => {
    const mixedBody = {
      ...createBody,
      playerBalances: createBody.playerBalances.map((player, index) =>
        index === 0 ? { ...player, playerId: 1 } : player,
      ),
    };
    const linkedSession = {
      ...session,
      playerBalances: session.playerBalances.map((player, index) => ({
        ...player,
        playerId: index + 1,
      })),
    };
    mocks.selectResults.push(writablePlayers);
    mocks.mutationResults.push([linkedSession]);

    const response = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(mixedBody) },
      adminUserId,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      playerBalances: [
        { name: "Alice", playerId: 1 },
        { name: "Bob", playerId: 2 },
        { name: "Carol", playerId: 3 },
        { name: "Dave", playerId: 4 },
      ],
    });
  });

  it("returns 500 for signed-in writes when the admin list is missing", async () => {
    delete process.env.ADMIN_EMAILS;

    const response = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(createBody) },
      adminUserId,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Admin access is not configured",
    });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("returns 500 for signed-in writes when the admin list contains only whitespace", async () => {
    process.env.ADMIN_EMAILS = " ,  , ";

    const response = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(createBody) },
      adminUserId,
    );

    expect(response.status).toBe(500);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("announces a newly created session with escaped HTML and delivery metadata", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    process.env.SCOREBOARD_URL = "https://scoreboard.example/app";
    mocks.telegramSend.mockResolvedValue({ status: "sent", messageId: 42 });

    const escapedSession = {
      ...session,
      winnerName: "A & <Ace>",
      notes: "Bring snacks & <tea>",
      playerBalances: [
        { name: "A & <Ace>", endingAmount: 130, zhaHuCount: 1, xieXieKaiXiangCount: 1 },
        { name: "Bob", endingAmount: 100, zhaHuCount: 0, xieXieKaiXiangCount: 2 },
        { name: "Carol", endingAmount: 90, zhaHuCount: 2, xieXieKaiXiangCount: 0 },
        { name: "Dave", endingAmount: 80, zhaHuCount: 0, xieXieKaiXiangCount: 0 },
      ],
    };
    mocks.mutationResults.push([escapedSession]);

    const response = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(createBody) },
      adminUserId,
    );

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
    expect(text).toContain("Winner: <b>A &amp; &lt;Ace&gt;</b> (-$370.00)");
    expect(text).toContain("$130.00 (-$370.00)");
    expect(text).toContain("$100.00 (-$400.00)");
    expect(text).toContain("$90.00 (-$410.00)");
    expect(text).toContain("$80.00 (-$420.00)");
    expect(text).toContain("<b>Rounds</b>: 4");
    expect(text).toContain("<b>Settlement total</b>: $400.00");
    expect(text).toContain("<b>Starting balance</b>: $500.00 per player");
    expect(text).toContain("诈胡 1");
    expect(text).toContain("谢谢开相 1");
    expect(text).toContain("Bring snacks &amp; &lt;tea&gt;");
    expect(text).not.toContain("A & <Ace>");
  });

  it("persists a session and reports a failed announcement separately", async () => {
    mocks.telegramSend.mockRejectedValue(new Error("Telegram is unavailable"));
    mocks.mutationResults.push([session]);

    const response = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(createBody) },
      adminUserId,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: session.id,
      announcement: { status: "failed", reason: "delivery_failed" },
    });
  });

  it.each([-1, 1.5])(
    "rejects an invalid Zha Hu count of %s",
    async (zhaHuCount) => {
      const invalidBody = {
        ...createBody,
        playerBalances: createBody.playerBalances.map((player, index) =>
          index === 0 ? { ...player, zhaHuCount } : player,
        ),
      };
      const response = await request(
        "/api/sessions",
        { method: "POST", body: JSON.stringify(invalidBody) },
        adminUserId,
      );
      expect(response.status).toBe(400);
      expect(mocks.db.insert).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 1.5])(
    "rejects an invalid 谢谢 Kai Xiang count of %s",
    async (xieXieKaiXiangCount) => {
      const invalidBody = {
        ...createBody,
        playerBalances: createBody.playerBalances.map((player, index) =>
          index === 0 ? { ...player, xieXieKaiXiangCount } : player,
        ),
      };
      const response = await request(
        "/api/sessions",
        { method: "POST", body: JSON.stringify(invalidBody) },
        adminUserId,
      );
      expect(response.status).toBe(400);
      expect(mocks.db.insert).not.toHaveBeenCalled();
    },
  );

  it("rejects a player reference that does not exist", async () => {
    const invalidBody = {
      ...createBody,
      playerBalances: createBody.playerBalances.map((player, index) =>
        index === 0 ? { ...player, playerId: 999 } : player,
      ),
    };
    mocks.selectResults.push([]);

    const response = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(invalidBody) },
      adminUserId,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "playerId 999 does not reference an existing player",
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("rejects duplicate player references within a session", async () => {
    const invalidBody = {
      ...createBody,
      playerBalances: createBody.playerBalances.map((player, index) =>
        index < 2 ? { ...player, playerId: 1 } : player,
      ),
    };

    const response = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(invalidBody) },
      adminUserId,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "playerId values must be unique within a session",
    });
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("rejects a player reference paired with another player's name", async () => {
    const invalidBody = {
      ...createBody,
      playerBalances: createBody.playerBalances.map((player, index) =>
        index === 0 ? { ...player, playerId: 1, name: "Not Alice" } : player,
      ),
    };
    mocks.selectResults.push([{ id: 1, name: "Alice" }]);

    const response = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(invalidBody) },
      adminUserId,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "playerId 1 does not match the player name",
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });
});

describe("player listing", () => {
  const players = [
    {
      id: 1,
      name: "Alex",
      active: true,
      createdByUserId: null,
      createdAt: new Date("2026-09-01T12:00:00Z"),
    },
    {
      id: 2,
      name: "Bea",
      active: false,
      createdByUserId: null,
      createdAt: new Date("2026-09-01T12:00:00Z"),
    },
    {
      id: 3,
      name: "Chen",
      active: true,
      createdByUserId: null,
      createdAt: new Date("2026-09-01T12:00:00Z"),
    },
  ];

  const sessions = [
    {
      playerBalances: [
        {
          playerId: 1,
          name: "Alex",
          endingAmount: 500,
          zhaHuCount: 0,
          xieXieKaiXiangCount: 0,
        },
        {
          playerId: 2,
          name: "Bea",
          endingAmount: 500,
          zhaHuCount: 0,
          xieXieKaiXiangCount: 0,
        },
      ],
    },
    {
      playerBalances: [
        {
          name: "Alex",
          endingAmount: 500,
          zhaHuCount: 0,
          xieXieKaiXiangCount: 0,
        },
        {
          playerId: 3,
          name: "Chen",
          endingAmount: 500,
          zhaHuCount: 0,
          xieXieKaiXiangCount: 0,
        },
      ],
    },
  ];

  it("lists public players with session counts", async () => {
    mocks.selectResults.push(players, sessions);

    const response = await request("/api/players");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([
      { id: 1, name: "Alex", active: true, sessionCount: 2 },
      { id: 2, name: "Bea", active: false, sessionCount: 1 },
      { id: 3, name: "Chen", active: true, sessionCount: 1 },
    ]);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([
    ["true", [players[0], players[2]]],
    ["false", [players[1]]],
  ])("filters players by active=%s", async (active, expectedPlayers) => {
    mocks.selectResults.push(expectedPlayers, sessions);

    const response = await request(`/api/players?active=${active}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(
      expectedPlayers.map((player) => ({
        id: player.id,
        active: player.active,
      })),
    );
  });
});