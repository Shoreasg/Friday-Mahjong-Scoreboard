import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectResults: unknown[] = [];
  const mutationResults: unknown[][] = [];

  function query(result: unknown) {
    const chain = {
      from: vi.fn(),
      where: vi.fn(),
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    return chain;
  }

  const db = {
    execute: vi.fn(async () => ({ rows: [] })),
    select: vi.fn(() => query(selectResults.shift() ?? [])),
    insert: vi.fn(() => {
      const returning = vi.fn(async () => mutationResults.shift() ?? []);
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      return { values: vi.fn(() => ({ returning, onConflictDoNothing })) };
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => mutationResults.shift() ?? []),
        })),
      })),
    })),
  };
  return {
    selectResults,
    mutationResults,
    getUser: vi.fn(),
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

import app from "../app";

const adminUserId = "admin-user";
const viewerUserId = "viewer-user";
const adminEmail = "admin@example.com";

const createdAt = new Date("2026-09-01T12:00:00Z");
const roster = [
  { id: 1, name: "Alex", active: true, createdByUserId: null, createdAt },
  { id: 2, name: "Bea", active: false, createdByUserId: null, createdAt },
  { id: 3, name: "Chen", active: true, createdByUserId: null, createdAt },
];

function balance(playerId: number) {
  return { playerId, endingAmount: 500, zhaHuCount: 0, xieXieKaiXiangCount: 0 };
}

const sessions = [
  { playerBalances: [balance(1), balance(2)] },
  { playerBalances: [balance(1), balance(3)] },
  { playerBalances: [] },
];

let server: Server;
let baseUrl: string;

async function request(path: string, init: RequestInit = {}, userId?: string) {
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
  process.env.ADMIN_EMAILS = adminEmail;
  mocks.selectResults.length = 0;
  mocks.mutationResults.length = 0;
  vi.clearAllMocks();
  mocks.getUser.mockImplementation(async (userId: string) => ({
    emailAddresses: [{
      emailAddress: userId === adminUserId ? adminEmail : "viewer@example.com",
    }],
  }));
});

describe("player listing", () => {
  it("lists public players with the number of sessions each played", async () => {
    mocks.selectResults.push(roster, sessions);

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
    ["true", [roster[0], roster[2]]],
    ["false", [roster[1]]],
  ])("filters players by active=%s", async (active, expectedPlayers) => {
    mocks.selectResults.push(expectedPlayers, sessions);

    const response = await request(`/api/players?active=${active}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(
      expectedPlayers.map((player) => ({ id: player.id, active: player.active })),
    );
  });

  it("rejects an active filter that isn't true or false", async () => {
    const response = await request("/api/players?active=yes");

    expect(response.status).toBe(400);
  });
});

describe("player creation", () => {
  it("adds an active player with no sessions yet", async () => {
    mocks.mutationResults.push([
      { id: 4, name: "Dong", active: true, createdByUserId: adminUserId, createdAt },
    ]);

    const response = await request(
      "/api/players",
      { method: "POST", body: JSON.stringify({ name: "  Dong " }) },
      adminUserId,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: 4,
      name: "Dong",
      active: true,
      sessionCount: 0,
    });
    const [insertCall] = mocks.db.insert.mock.results;
    const valuesMock = (insertCall?.value as { values: ReturnType<typeof vi.fn> }).values;
    expect(valuesMock).toHaveBeenCalledWith({ name: "Dong", createdByUserId: adminUserId });
  });

  it("reports a conflict when a player already has that name, ignoring case", async () => {
    mocks.mutationResults.push([]);

    const response = await request(
      "/api/players",
      { method: "POST", body: JSON.stringify({ name: "ALEX" }) },
      adminUserId,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'A player named "ALEX" already exists' });
  });

  it.each(["", "   "])("rejects a blank name %j", async (name) => {
    const response = await request(
      "/api/players",
      { method: "POST", body: JSON.stringify({ name }) },
      adminUserId,
    );

    expect(response.status).toBe(400);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["signed-out", undefined, 401],
    ["non-admin", viewerUserId, 403],
  ])("rejects %s callers", async (_label, userId, status) => {
    const response = await request(
      "/api/players",
      { method: "POST", body: JSON.stringify({ name: "Dong" }) },
      userId,
    );

    expect(response.status).toBe(status);
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });
});

describe("player updates", () => {
  async function patchPlayer(id: number, body: unknown, userId: string | undefined = adminUserId) {
    return request(
      `/api/players/${id}`,
      { method: "PATCH", body: JSON.stringify(body) },
      userId,
    );
  }

  it("renames a player, keeping their session history", async () => {
    mocks.mutationResults.push([{ ...roster[0], name: "Alexander" }]);
    mocks.selectResults.push(sessions);

    const response = await patchPlayer(1, { name: " Alexander " });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 1,
      name: "Alexander",
      active: true,
      sessionCount: 2,
    });
    const setMock = (mocks.db.update.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> }).set;
    expect(setMock).toHaveBeenCalledWith({ name: "Alexander" });
  });

  it.each([
    ["marks a player inactive", 1, false],
    ["reactivates a returning player", 2, true],
  ])("%s without losing their history", async (_label, id, active) => {
    const player = roster.find((candidate) => candidate.id === id)!;
    mocks.mutationResults.push([{ ...player, active }]);
    mocks.selectResults.push(sessions);

    const response = await patchPlayer(id, { active });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id,
      active,
      sessionCount: id === 1 ? 2 : 1,
    });
    const setMock = (mocks.db.update.mock.results[0]?.value as { set: ReturnType<typeof vi.fn> }).set;
    expect(setMock).toHaveBeenCalledWith({ active });
  });

  it("reports a conflict when renaming to another player's name", async () => {
    mocks.db.update.mockImplementationOnce(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            throw Object.assign(new Error("duplicate key"), { code: "23505" });
          }),
        })),
      })),
    }));

    const response = await patchPlayer(1, { name: "bea" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'A player named "bea" already exists' });
  });

  it("returns 404 for a player that doesn't exist", async () => {
    mocks.mutationResults.push([]);

    const response = await patchPlayer(99, { active: false });

    expect(response.status).toBe(404);
  });

  it.each([
    ["an empty update", {}],
    ["a blank name", { name: "   " }],
  ])("rejects %s", async (_label, body) => {
    const response = await patchPlayer(1, body);

    expect(response.status).toBe(400);
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it.each([
    ["signed-out", undefined, 401],
    ["non-admin", viewerUserId, 403],
  ])("rejects %s callers", async (_label, userId, status) => {
    const response = await request(
      "/api/players/1",
      { method: "PATCH", body: JSON.stringify({ active: false }) },
      userId,
    );

    expect(response.status).toBe(status);
    expect(mocks.db.update).not.toHaveBeenCalled();
  });
});
