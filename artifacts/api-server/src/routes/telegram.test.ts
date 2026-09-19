import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  telegramSend: vi.fn(),
}));

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

vi.mock("@workspace/integrations-telegram", () => ({
  sendTelegramMessage: mocks.telegramSend,
}));

import app from "../app";

const adminUserId = "admin-user";
const viewerUserId = "viewer-user";
const adminEmail = "admin@example.com";

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

async function broadcast(message: unknown, userId?: string) {
  return request(
    "/api/telegram/broadcast",
    { method: "POST", body: JSON.stringify({ message }) },
    userId,
  );
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
  vi.clearAllMocks();
  mocks.getUser.mockImplementation(async (userId: string) => ({
    emailAddresses: [{
      emailAddress: userId === adminUserId ? adminEmail : "viewer@example.com",
    }],
  }));
});

describe("POST /telegram/broadcast", () => {
  it("rejects signed-out callers", async () => {
    const response = await broadcast("Mahjong tonight?");

    expect(response.status).toBe(401);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers", async () => {
    const response = await broadcast("Mahjong tonight?", viewerUserId);

    expect(response.status).toBe(403);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });

  it("sends the exact composed text with no parse mode", async () => {
    mocks.telegramSend.mockResolvedValue({ status: "sent", messageId: 7 });

    const response = await broadcast("Bring <snacks> & *dice* tonight!", adminUserId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "sent", messageId: 7 });
    expect(mocks.telegramSend).toHaveBeenCalledWith({
      text: "Bring <snacks> & *dice* tonight!",
    });
  });

  it("rejects a message exceeding Telegram's length limit", async () => {
    const response = await broadcast("x".repeat(4097), adminUserId);

    expect(response.status).toBe(400);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    const response = await broadcast("", adminUserId);

    expect(response.status).toBe(400);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });

  it("reports unavailability when Telegram is not configured", async () => {
    mocks.telegramSend.mockResolvedValue({
      status: "skipped",
      reason: "not_configured",
    });

    const response = await broadcast("Mahjong tonight?", adminUserId);

    expect(response.status).toBe(503);
  });

  it("surfaces a delivery failure instead of swallowing it", async () => {
    mocks.telegramSend.mockRejectedValue(new Error("Telegram is unavailable"));

    const response = await broadcast("Mahjong tonight?", adminUserId);

    expect(response.status).toBe(502);
  });
});
