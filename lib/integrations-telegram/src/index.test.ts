import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTelegramChatId,
  getTelegramWebhookInfo,
  sendTelegramMessage,
  setTelegramCommands,
  setTelegramWebhook,
  startTelegramPoll,
} from "./index";

const originalEnvironment = {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
};

describe("Telegram transport", () => {
  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    if (originalEnvironment.botToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalEnvironment.botToken;
    }
    if (originalEnvironment.chatId === undefined) {
      delete process.env.TELEGRAM_CHAT_ID;
    } else {
      process.env.TELEGRAM_CHAT_ID = originalEnvironment.chatId;
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads configuration lazily and skips without credentials", async () => {
    const result = await sendTelegramMessage({ text: "hello" });

    expect(result).toEqual({ status: "skipped", reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends an HTML message using the configured chat", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 42 },
        }),
        { status: 200 },
      ),
    );

    const result = await sendTelegramMessage({
      text: "<b>Hello</b>",
      parseMode: "HTML",
    });

    expect(result).toEqual({ status: "sent", messageId: 42 });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: "-100123",
          text: "<b>Hello</b>",
          parse_mode: "HTML",
        }),
      }),
    );
  });

  it("maps Telegram API rejection to a transport error", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          description: "Bad Request: can't parse entities",
        }),
        { status: 400 },
      ),
    );

    await expect(sendTelegramMessage({ text: "invalid" })).rejects.toThrow(
      "Telegram rejected the message (400)",
    );
  });

  it("aborts requests after the bounded timeout", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const request = expect(
      sendTelegramMessage({ text: "slow" }),
    ).rejects.toThrow("Telegram request failed");
    await vi.advanceTimersByTimeAsync(5_000);

    await request;
  });

  it("reports the configured chat id, or null when unconfigured", () => {
    expect(getTelegramChatId()).toBeNull();

    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    expect(getTelegramChatId()).toBe("-100123");
  });

  it("starts a non-anonymous Yes/No/Maybe poll using the configured chat", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 9 },
        }),
        { status: 200 },
      ),
    );

    const result = await startTelegramPoll("Mahjong tonight?");

    expect(result).toEqual({ status: "sent", messageId: 9 });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/sendPoll",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: "-100123",
          question: "Mahjong tonight?",
          options: ["Yes", "No", "Maybe"],
          is_anonymous: false,
        }),
      }),
    );
  });

  it("skips starting a poll without credentials", async () => {
    const result = await startTelegramPoll("Mahjong tonight?");

    expect(result).toEqual({ status: "skipped", reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("registers a webhook with its secret token", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );

    const result = await setTelegramWebhook(
      "https://example.com/api/telegram/webhook",
      "shh-its-a-secret",
    );

    expect(result).toEqual({ status: "registered" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/setWebhook",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://example.com/api/telegram/webhook",
          secret_token: "shh-its-a-secret",
        }),
      }),
    );
  });

  it("skips registering a webhook without credentials", async () => {
    const result = await setTelegramWebhook("https://example.com", "secret");

    expect(result).toEqual({ status: "skipped", reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports webhook info including the last delivery error", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            url: "https://example.com/api/telegram/webhook",
            pending_update_count: 2,
            last_error_date: 1700000000,
            last_error_message: "Wrong response from the webhook: 500",
          },
        }),
        { status: 200 },
      ),
    );

    const result = await getTelegramWebhookInfo();

    expect(result).toEqual({
      status: "ok",
      info: {
        url: "https://example.com/api/telegram/webhook",
        pendingUpdateCount: 2,
        lastErrorDate: 1700000000,
        lastErrorMessage: "Wrong response from the webhook: 500",
      },
    });
  });

  it("skips fetching webhook info without credentials", async () => {
    const result = await getTelegramWebhookInfo();

    expect(result).toEqual({ status: "skipped", reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("registers the bot's command menu", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "-100123";
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }),
    );

    const result = await setTelegramCommands([
      { command: "help", description: "Show the available commands" },
    ]);

    expect(result).toEqual({ status: "set" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/setMyCommands",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          commands: [
            { command: "help", description: "Show the available commands" },
          ],
        }),
      }),
    );
  });

  it("skips registering the command menu without credentials", async () => {
    const result = await setTelegramCommands([
      { command: "help", description: "Show the available commands" },
    ]);

    expect(result).toEqual({ status: "skipped", reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
