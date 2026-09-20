const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 5_000;
const ATTENDANCE_POLL_OPTIONS = ["Yes", "No", "Maybe"];

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

export type TelegramWebhookRegistrationResult =
  | { status: "registered" }
  | { status: "skipped"; reason: "not_configured" };

export type TelegramWebhookInfo = {
  url: string;
  pendingUpdateCount: number;
  lastErrorDate: number | null;
  lastErrorMessage: string | null;
};

export type TelegramWebhookInfoResult =
  | { status: "ok"; info: TelegramWebhookInfo }
  | { status: "skipped"; reason: "not_configured" };

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

export function getTelegramChatId(): string | null {
  return readConfiguration()?.chatId ?? null;
}

function isTelegramResponse(
  value: unknown,
): value is {
  ok: boolean;
  result?: unknown;
  description?: string;
} {
  return typeof value === "object" && value !== null && "ok" in value;
}

async function callTelegramMethod(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
  rejectionLabel: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${TELEGRAM_API_BASE_URL}/bot${encodeURIComponent(botToken)}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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
        `Telegram rejected ${rejectionLabel} (${response.status})${description}`,
      );
    }

    return payload.result;
  } catch (error) {
    if (error instanceof TelegramTransportError) {
      throw error;
    }

    throw new TelegramTransportError("Telegram request failed", error);
  } finally {
    clearTimeout(timeout);
  }
}

function messageIdFrom(result: unknown): number | null {
  if (typeof result !== "object" || result === null || !("message_id" in result)) {
    return null;
  }
  const messageId = (result as { message_id?: unknown }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

export async function sendTelegramMessage(
  options: TelegramMessageOptions,
): Promise<TelegramSendResult> {
  const configuration = readConfiguration();
  if (!configuration) {
    return { status: "skipped", reason: "not_configured" };
  }

  const result = await callTelegramMethod(
    configuration.botToken,
    "sendMessage",
    {
      chat_id: configuration.chatId,
      text: options.text,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
    },
    "the message",
  );

  return { status: "sent", messageId: messageIdFrom(result) };
}

export async function startTelegramPoll(
  question: string,
): Promise<TelegramSendResult> {
  const configuration = readConfiguration();
  if (!configuration) {
    return { status: "skipped", reason: "not_configured" };
  }

  const result = await callTelegramMethod(
    configuration.botToken,
    "sendPoll",
    {
      chat_id: configuration.chatId,
      question,
      options: ATTENDANCE_POLL_OPTIONS,
      is_anonymous: false,
    },
    "the poll",
  );

  return { status: "sent", messageId: messageIdFrom(result) };
}

export async function setTelegramWebhook(
  url: string,
  secretToken: string,
): Promise<TelegramWebhookRegistrationResult> {
  const configuration = readConfiguration();
  if (!configuration) {
    return { status: "skipped", reason: "not_configured" };
  }

  await callTelegramMethod(
    configuration.botToken,
    "setWebhook",
    { url, secret_token: secretToken },
    "the webhook registration",
  );

  return { status: "registered" };
}

export async function getTelegramWebhookInfo(): Promise<TelegramWebhookInfoResult> {
  const configuration = readConfiguration();
  if (!configuration) {
    return { status: "skipped", reason: "not_configured" };
  }

  const result = await callTelegramMethod(
    configuration.botToken,
    "getWebhookInfo",
    {},
    "the webhook info request",
  );

  const info = (result ?? {}) as Record<string, unknown>;
  return {
    status: "ok",
    info: {
      url: typeof info.url === "string" ? info.url : "",
      pendingUpdateCount:
        typeof info.pending_update_count === "number" ? info.pending_update_count : 0,
      lastErrorDate:
        typeof info.last_error_date === "number" ? info.last_error_date : null,
      lastErrorMessage:
        typeof info.last_error_message === "string" ? info.last_error_message : null,
    },
  };
}
