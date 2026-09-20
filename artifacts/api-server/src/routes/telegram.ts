import {
  GetTelegramWebhookInfoResponse,
  RegisterTelegramWebhookBody,
  RegisterTelegramWebhookResponse,
  SendTelegramBroadcastBody,
  SendTelegramBroadcastResponse,
  StartTelegramPollBody,
  StartTelegramPollResponse,
} from "@workspace/api-zod";
import {
  getTelegramWebhookInfo,
  sendTelegramMessage,
  setTelegramWebhook,
  startTelegramPoll,
} from "@workspace/integrations-telegram";
import { Router, type IRouter, type Request } from "express";
import { requireAdmin } from "./requireAdmin";

const WEBHOOK_PATH = "/api/telegram/webhook";

/**
 * The URL the server expects to be registered with Telegram: PUBLIC_URL if
 * set, otherwise derived from the request's own (possibly forwarded) origin.
 * Mirrors scoreboardUrl()'s fallback, since both answer "what is my own
 * public address" for a request that may be behind a proxy.
 */
function expectedWebhookUrl(req: Request): string {
  const configuredBase = process.env.PUBLIC_URL?.trim();
  if (configuredBase) {
    return `${configuredBase.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
  }

  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}${WEBHOOK_PATH}`;
}

function webhookStatus(
  registeredUrl: string,
  expectedUrl: string,
): "ok" | "mismatch" | "unregistered" {
  if (!registeredUrl) return "unregistered";
  return registeredUrl === expectedUrl ? "ok" : "mismatch";
}

const router: IRouter = Router();

const POLL_QUESTIONS: Record<string, string> = {
  tonight: "Mahjong tonight?",
  this_friday: "Mahjong this Friday?",
};

router.post("/telegram/broadcast", async (req, res): Promise<void> => {
  const userId = await requireAdmin(req, res);
  if (!userId) return;

  const parsed = SendTelegramBroadcastBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await sendTelegramMessage({ text: parsed.data.message });
    if (result.status === "skipped") {
      res.status(503).json({ error: "Telegram is not configured" });
      return;
    }

    res.json(SendTelegramBroadcastResponse.parse(result));
  } catch (error) {
    req.log.warn({ err: error }, "Telegram broadcast failed");
    res.status(502).json({ error: "Failed to send broadcast" });
  }
});

router.post("/telegram/poll", async (req, res): Promise<void> => {
  const userId = await requireAdmin(req, res);
  if (!userId) return;

  const parsed = StartTelegramPollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await startTelegramPoll(POLL_QUESTIONS[parsed.data.preset]);
    if (result.status === "skipped") {
      res.status(503).json({ error: "Telegram is not configured" });
      return;
    }

    res.json(StartTelegramPollResponse.parse(result));
  } catch (error) {
    req.log.warn({ err: error }, "Telegram poll failed");
    res.status(502).json({ error: "Failed to start poll" });
  }
});

router.get("/telegram/webhook/info", async (req, res): Promise<void> => {
  const userId = await requireAdmin(req, res);
  if (!userId) return;

  const result = await getTelegramWebhookInfo();
  if (result.status === "skipped") {
    res.status(503).json({ error: "Telegram is not configured" });
    return;
  }

  const expectedUrl = expectedWebhookUrl(req);
  res.json(
    GetTelegramWebhookInfoResponse.parse({
      status: webhookStatus(result.info.url, expectedUrl),
      registeredUrl: result.info.url,
      expectedUrl,
      pendingUpdateCount: result.info.pendingUpdateCount,
      lastErrorMessage: result.info.lastErrorMessage,
      lastErrorDate: result.info.lastErrorDate,
    }),
  );
});

router.post("/telegram/webhook/register", async (req, res): Promise<void> => {
  const userId = await requireAdmin(req, res);
  if (!userId) return;

  const parsed = RegisterTelegramWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { url } = parsed.data;
  if (!URL.canParse(url) || !url.startsWith("https://")) {
    res.status(400).json({ error: `"${url}" is not a valid https:// URL` });
    return;
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    res.status(500).json({ error: "TELEGRAM_WEBHOOK_SECRET is not configured" });
    return;
  }

  const registration = await setTelegramWebhook(url, secret);
  if (registration.status === "skipped") {
    res.status(503).json({ error: "Telegram is not configured" });
    return;
  }

  const info = await getTelegramWebhookInfo();
  if (info.status === "skipped") {
    res.status(503).json({ error: "Telegram is not configured" });
    return;
  }

  const expectedUrl = expectedWebhookUrl(req);
  res.json(
    RegisterTelegramWebhookResponse.parse({
      status: webhookStatus(info.info.url, expectedUrl),
      registeredUrl: info.info.url,
      expectedUrl,
      pendingUpdateCount: info.info.pendingUpdateCount,
      lastErrorMessage: info.info.lastErrorMessage,
      lastErrorDate: info.info.lastErrorDate,
    }),
  );
});

export default router;
