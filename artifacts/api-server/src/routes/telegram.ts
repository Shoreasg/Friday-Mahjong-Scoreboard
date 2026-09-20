import {
  SendTelegramBroadcastBody,
  SendTelegramBroadcastResponse,
  StartTelegramPollBody,
  StartTelegramPollResponse,
} from "@workspace/api-zod";
import { sendTelegramMessage, startTelegramPoll } from "@workspace/integrations-telegram";
import { Router, type IRouter } from "express";
import { requireAdmin } from "./requireAdmin";

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

export default router;
