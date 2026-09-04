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

  return {
    selectResults,
    mutationResults,
    getUser: vi.fn(),
    db: {
      select: vi.fn(() => query(selectResults.shift() ?? [])),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => mutationResults.shift() ?? []),
        })),
      })),
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
    { name: "Alice", endingAmount: 130, zhaHuCount: 1 },
    { name: "Bob", endingAmount: 100, zhaHuCount: 0 },
    { name: "Carol", endingAmount: 90, zhaHuCount: 2 },
    { name: "Dave", endingAmount: 80, zhaHuCount: 0 },
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
  it("allows public reads and defaults legacy Zha Hu counts to zero", async () => {
    const legacySession = {
      ...session,
      playerBalances: session.playerBalances.map(({ zhaHuCount: _count, ...player }) => player),
    };
    mocks.selectResults.push([legacySession]);
    const listResponse = await request("/api/sessions");
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject([{
      playerBalances: [
        { name: "Alice", zhaHuCount: 0 },
        { name: "Bob", zhaHuCount: 0 },
        { name: "Carol", zhaHuCount: 0 },
        { name: "Dave", zhaHuCount: 0 },
      ],
    }]);

    const secondSession = {
      ...session,
      id: 2,
      playerBalances: [
        { name: "alice", endingAmount: 120, zhaHuCount: 2 },
        { name: "BOB", endingAmount: 110, zhaHuCount: 1 },
        { name: "Eve", endingAmount: 90, zhaHuCount: 4 },
        { name: "Frank", endingAmount: 80, zhaHuCount: 0 },
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
    });
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
    mocks.mutationResults.push([session]);
    const createResponse = await request(
      "/api/sessions",
      { method: "POST", body: JSON.stringify(createBody) },
      userId,
    );
    expect(createResponse.status).toBe(201);

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
});