import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTelegramMessage } from "./index";

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
      new Response(JSON.stringify({
        ok: true,
        result: { message_id: 42 },
      }), { status: 200 }),
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
      new Response(JSON.stringify({
        ok: false,
        description: "Bad Request: can't parse entities",
      }), { status: 400 }),
    );

    await expect(
      sendTelegramMessage({ text: "invalid" }),
    ).rejects.toThrow("Telegram rejected the message (400)");
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
});