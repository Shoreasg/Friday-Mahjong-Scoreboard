const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 5_000;

export type TelegramMessageOptions = {
  text: string;
  parseMode?: "HTML";
};

export type TelegramSendResult =
  | {
      status: "sent";
      messageId: number | null;
    }
  | {
      status: "skipped";
      reason: "not_configured";
    };

type TelegramConfiguration = {
  botToken: string;
  chatId: string;
};

export class TelegramTransportError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TelegramTransportError";
    this.cause = cause;
  }
}

function readConfiguration(): TelegramConfiguration | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!botToken || !chatId) {
    return null;
  }

  return { botToken, chatId };
}

export function isTelegramConfigured(): boolean {
  return readConfiguration() !== null;
}

function isTelegramResponse(
  value: unknown,
): value is {
  ok: boolean;
  result?: { message_id?: number };
  description?: string;
} {
  return typeof value === "object" && value !== null && "ok" in value;
}

export async function sendTelegramMessage(
  options: TelegramMessageOptions,
): Promise<TelegramSendResult> {
  const configuration = readConfiguration();
  if (!configuration) {
    return { status: "skipped", reason: "not_configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${TELEGRAM_API_BASE_URL}/bot${encodeURIComponent(configuration.botToken)}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: configuration.chatId,
          text: options.text,
          ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
        }),
        signal: controller.signal,
      },
    );

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new TelegramTransportError(
        `Telegram returned an invalid response (${response.status})`,
        error,
      );
    }

    if (!response.ok || !isTelegramResponse(payload) || !payload.ok) {
      const description =
        isTelegramResponse(payload) && payload.description
          ? `: ${payload.description}`
          : "";
      throw new TelegramTransportError(
        `Telegram rejected the message (${response.status})${description}`,
      );
    }

    return {
      status: "sent",
      messageId:
        typeof payload.result?.message_id === "number"
          ? payload.result.message_id
          : null,
    };
  } catch (error) {
    if (error instanceof TelegramTransportError) {
      throw error;
    }

    throw new TelegramTransportError("Telegram request failed", error);
  } finally {
    clearTimeout(timeout);
  }
}