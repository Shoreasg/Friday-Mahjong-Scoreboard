import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  telegramSend: vi.fn(),
  telegramPoll: vi.fn(),
  getTelegramWebhookInfo: vi.fn(),
  setTelegramWebhook: vi.fn(),
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
  startTelegramPoll: mocks.telegramPoll,
  getTelegramWebhookInfo: mocks.getTelegramWebhookInfo,
  setTelegramWebhook: mocks.setTelegramWebhook,
}));

// requireAdmin() falls back to an admins-table lookup for any caller not on
// ADMIN_EMAILS. No test here exercises a table-granted admin, so every
// lookup resolves to "not found" (empty rows).
vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const chain: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    then: (resolve: (value: unknown) => unknown) => unknown;
  } = {
    from: vi.fn(),
    where: vi.fn(),
    then: (resolve) => Promise.resolve([]).then(resolve),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return { ...original, db: { select: vi.fn(() => chain) } };
});

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

async function startPoll(preset: unknown, userId?: string) {
  return request(
    "/api/telegram/poll",
    { method: "POST", body: JSON.stringify({ preset }) },
    userId,
  );
}

async function getWebhookInfo(userId?: string) {
  return request("/api/telegram/webhook/info", {}, userId);
}

async function registerWebhook(url: unknown, userId?: string) {
  return request(
    "/api/telegram/webhook/register",
    { method: "POST", body: JSON.stringify({ url }) },
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
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
  vi.clearAllMocks();
  mocks.getUser.mockImplementation(async (userId: string) => ({
    emailAddresses: [{
      emailAddress: userId === adminUserId ? adminEmail : "viewer@example.com",
    }],
  }));
});

afterEach(() => {
  delete process.env.PUBLIC_URL;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
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

describe("POST /telegram/poll", () => {
  it("rejects signed-out callers", async () => {
    const response = await startPoll("tonight");

    expect(response.status).toBe(401);
    expect(mocks.telegramPoll).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers", async () => {
    const response = await startPoll("tonight", viewerUserId);

    expect(response.status).toBe(403);
    expect(mocks.telegramPoll).not.toHaveBeenCalled();
  });

  it("starts the 'tonight' preset poll", async () => {
    mocks.telegramPoll.mockResolvedValue({ status: "sent", messageId: 11 });

    const response = await startPoll("tonight", adminUserId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "sent", messageId: 11 });
    expect(mocks.telegramPoll).toHaveBeenCalledWith("Mahjong tonight?");
  });

  it("starts the 'this_friday' preset poll", async () => {
    mocks.telegramPoll.mockResolvedValue({ status: "sent", messageId: 12 });

    const response = await startPoll("this_friday", adminUserId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "sent", messageId: 12 });
    expect(mocks.telegramPoll).toHaveBeenCalledWith("Mahjong this Friday?");
  });

  it("rejects an unknown preset", async () => {
    const response = await startPoll("next_week", adminUserId);

    expect(response.status).toBe(400);
    expect(mocks.telegramPoll).not.toHaveBeenCalled();
  });

  it("reports unavailability when Telegram is not configured", async () => {
    mocks.telegramPoll.mockResolvedValue({
      status: "skipped",
      reason: "not_configured",
    });

    const response = await startPoll("tonight", adminUserId);

    expect(response.status).toBe(503);
  });

  it("surfaces a failure to start the poll instead of swallowing it", async () => {
    mocks.telegramPoll.mockRejectedValue(new Error("Telegram is unavailable"));

    const response = await startPoll("tonight", adminUserId);

    expect(response.status).toBe(502);
  });
});

describe("GET /telegram/webhook/info", () => {
  it("rejects signed-out callers", async () => {
    const response = await getWebhookInfo();

    expect(response.status).toBe(401);
  });

  it("rejects non-admin callers", async () => {
    const response = await getWebhookInfo(viewerUserId);

    expect(response.status).toBe(403);
  });

  it("reports ok when the registered URL matches the expected URL", async () => {
    process.env.PUBLIC_URL = "https://mahjong.example.com";
    mocks.getTelegramWebhookInfo.mockResolvedValue({
      status: "ok",
      info: {
        url: "https://mahjong.example.com/api/telegram/webhook",
        pendingUpdateCount: 0,
        lastErrorDate: null,
        lastErrorMessage: null,
      },
    });

    const response = await getWebhookInfo(adminUserId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      registeredUrl: "https://mahjong.example.com/api/telegram/webhook",
      expectedUrl: "https://mahjong.example.com/api/telegram/webhook",
      pendingUpdateCount: 0,
      lastErrorMessage: null,
      lastErrorDate: null,
    });
  });

  it("reports mismatch when a different URL is registered", async () => {
    process.env.PUBLIC_URL = "https://mahjong.example.com";
    mocks.getTelegramWebhookInfo.mockResolvedValue({
      status: "ok",
      info: {
        url: "https://old-tunnel.example.com/api/telegram/webhook",
        pendingUpdateCount: 2,
        lastErrorDate: 1700000000,
        lastErrorMessage: "Wrong response from the webhook: 500",
      },
    });

    const response = await getWebhookInfo(adminUserId);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      pendingUpdateCount: number;
      lastErrorMessage: string | null;
    };
    expect(body.status).toBe("mismatch");
    expect(body.pendingUpdateCount).toBe(2);
    expect(body.lastErrorMessage).toBe("Wrong response from the webhook: 500");
  });

  it("reports unregistered when nothing is registered", async () => {
    process.env.PUBLIC_URL = "https://mahjong.example.com";
    mocks.getTelegramWebhookInfo.mockResolvedValue({
      status: "ok",
      info: { url: "", pendingUpdateCount: 0, lastErrorDate: null, lastErrorMessage: null },
    });

    const response = await getWebhookInfo(adminUserId);

    expect(((await response.json()) as { status: string }).status).toBe("unregistered");
  });

  it("reports unavailability when Telegram is not configured", async () => {
    mocks.getTelegramWebhookInfo.mockResolvedValue({
      status: "skipped",
      reason: "not_configured",
    });

    const response = await getWebhookInfo(adminUserId);

    expect(response.status).toBe(503);
  });
});

describe("POST /telegram/webhook/register", () => {
  it("rejects signed-out callers", async () => {
    const response = await registerWebhook("https://mahjong.example.com/api/telegram/webhook");

    expect(response.status).toBe(401);
    expect(mocks.setTelegramWebhook).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers", async () => {
    const response = await registerWebhook(
      "https://mahjong.example.com/api/telegram/webhook",
      viewerUserId,
    );

    expect(response.status).toBe(403);
    expect(mocks.setTelegramWebhook).not.toHaveBeenCalled();
  });

  it("registers the given URL and returns the freshly re-checked status", async () => {
    process.env.PUBLIC_URL = "https://mahjong.example.com";
    mocks.setTelegramWebhook.mockResolvedValue({ status: "registered" });
    mocks.getTelegramWebhookInfo.mockResolvedValue({
      status: "ok",
      info: {
        url: "https://mahjong.example.com/api/telegram/webhook",
        pendingUpdateCount: 0,
        lastErrorDate: null,
        lastErrorMessage: null,
      },
    });

    const response = await registerWebhook(
      "https://mahjong.example.com/api/telegram/webhook",
      adminUserId,
    );

    expect(response.status).toBe(200);
    expect(mocks.setTelegramWebhook).toHaveBeenCalledWith(
      "https://mahjong.example.com/api/telegram/webhook",
      "test-webhook-secret",
    );
    expect(((await response.json()) as { status: string }).status).toBe("ok");
  });

  it("rejects a non-https URL", async () => {
    const response = await registerWebhook("http://mahjong.example.com/api/telegram/webhook", adminUserId);

    expect(response.status).toBe(400);
    expect(mocks.setTelegramWebhook).not.toHaveBeenCalled();
  });

  it("rejects an unparseable URL", async () => {
    const response = await registerWebhook("not a url", adminUserId);

    expect(response.status).toBe(400);
    expect(mocks.setTelegramWebhook).not.toHaveBeenCalled();
  });

  it("fails clearly when the webhook secret is not configured", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    const response = await registerWebhook(
      "https://mahjong.example.com/api/telegram/webhook",
      adminUserId,
    );

    expect(response.status).toBe(500);
    expect(mocks.setTelegramWebhook).not.toHaveBeenCalled();
  });

  it("reports unavailability when Telegram is not configured", async () => {
    mocks.setTelegramWebhook.mockResolvedValue({
      status: "skipped",
      reason: "not_configured",
    });

    const response = await registerWebhook(
      "https://mahjong.example.com/api/telegram/webhook",
      adminUserId,
    );

    expect(response.status).toBe(503);
  });
});
