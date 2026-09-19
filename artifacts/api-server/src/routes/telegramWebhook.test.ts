import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  telegramSend: vi.fn(),
  telegramPoll: vi.fn(),
  getTelegramChatId: vi.fn(),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: mocks.getUser } },
  clerkMiddleware:
    () =>
    (_req: unknown, _res: unknown, next: () => void) => {
      next();
    },
  getAuth: () => ({}),
}));

vi.mock("@workspace/integrations-telegram", () => ({
  sendTelegramMessage: mocks.telegramSend,
  startTelegramPoll: mocks.telegramPoll,
  getTelegramChatId: mocks.getTelegramChatId,
}));

import app from "../app";

const WEBHOOK_SECRET = "test-webhook-secret";
const CONFIGURED_CHAT_ID = "-100123";

let server: Server;
let baseUrl: string;

async function postUpdate(body: unknown, secretToken?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (secretToken !== undefined) {
    headers.set("x-telegram-bot-api-secret-token", secretToken);
  }
  return fetch(`${baseUrl}/api/telegram/webhook`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function messageUpdate(overrides: Record<string, unknown> = {}) {
  return {
    update_id: 1,
    message: {
      chat: { id: Number(CONFIGURED_CHAT_ID) },
      text: "/help",
      ...overrides,
    },
  };
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
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  vi.clearAllMocks();
  mocks.getTelegramChatId.mockReturnValue(CONFIGURED_CHAT_ID);
});

afterEach(() => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.SCOREBOARD_URL;
});

describe("POST /telegram/webhook", () => {
  it("rejects a request with a missing secret token", async () => {
    const response = await postUpdate(messageUpdate());

    expect(response.status).toBe(401);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });

  it("rejects a request with an incorrect secret token", async () => {
    const response = await postUpdate(messageUpdate(), "wrong-secret");

    expect(response.status).toBe(401);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });

  it("acknowledges and ignores updates when no webhook secret is configured", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    const response = await postUpdate(messageUpdate());

    expect(response.status).toBe(200);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });

  it("ignores an update from any chat other than the configured one", async () => {
    const response = await postUpdate(
      messageUpdate({ chat: { id: -999 } }),
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });

  it("acknowledges and ignores unknown commands", async () => {
    const response = await postUpdate(
      messageUpdate({ text: "/nonsense" }),
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });

  it("acknowledges a malformed payload", async () => {
    const response = await postUpdate({ not: "a valid update" }, WEBHOOK_SECRET);

    expect(response.status).toBe(200);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });

  it("acknowledges the update even when the handler throws", async () => {
    mocks.telegramSend.mockRejectedValue(new Error("Telegram is unavailable"));

    const response = await postUpdate(messageUpdate(), WEBHOOK_SECRET);

    expect(response.status).toBe(200);
  });

  it("replies to /help with the available commands and a scoreboard link", async () => {
    process.env.SCOREBOARD_URL = "https://scoreboard.example/app";
    mocks.telegramSend.mockResolvedValue({ status: "sent", messageId: 5 });

    const response = await postUpdate(messageUpdate(), WEBHOOK_SECRET);

    expect(response.status).toBe(200);
    expect(mocks.telegramSend).toHaveBeenCalledWith({
      text: expect.stringContaining("/help"),
    });
    expect(mocks.telegramSend).toHaveBeenCalledWith({
      text: expect.stringContaining("https://scoreboard.example/app"),
    });
  });

  it("logs a chat migration and sends nothing", async () => {
    const response = await postUpdate(
      messageUpdate({ migrate_to_chat_id: -200456, text: undefined }),
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(mocks.telegramSend).not.toHaveBeenCalled();
  });
});
