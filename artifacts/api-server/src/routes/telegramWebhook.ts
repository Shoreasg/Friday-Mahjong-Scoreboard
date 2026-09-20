import {
  getTelegramChatId,
  sendTelegramMessage,
} from "@workspace/integrations-telegram";
import {
  isInProfit,
  netWinnings,
  perPlayerShare,
} from "@workspace/session-rules";
import { Router, type IRouter, type Request } from "express";
import { z } from "@workspace/api-zod";
import { scoreboardUrl } from "./scoreboardUrl";
import {
  getSessionSummary,
  loadAllPlayerNames,
  playerName,
} from "../lib/session-summary";
import {
  escapeTelegramHtml,
  formatMoney,
  formatNetPosition,
} from "../lib/telegramFormatting";

const router: IRouter = Router();

const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/*
 * Hand-written and deliberately narrow: this endpoint is excluded from the
 * OpenAPI contract (Telegram must never be reachable from browser code), so
 * there is no generated schema to reuse. It parses only the fields the
 * handler actually reads.
 */
const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      chat: z.object({ id: z.number() }),
      text: z.string().optional(),
      migrate_to_chat_id: z.number().optional(),
      migrate_from_chat_id: z.number().optional(),
    })
    .optional(),
});

function helpReplyText(req: Request): string {
  return [
    "I post session announcements and answer a couple of commands here.",
    "",
    "Commands:",
    "/help — show this message",
    "/last — the most recent session's result",
    "/standings — the cumulative net winnings leaderboard",
    "",
    `Scoreboard: ${scoreboardUrl(req)}`,
  ].join("\n");
}

const NO_SESSIONS_REPLY_TEXT = "No sessions have been recorded yet.";

async function lastReplyText(req: Request): Promise<string> {
  const { latestSession } = await getSessionSummary();
  if (!latestSession) return NO_SESSIONS_REPLY_TEXT;

  const names = await loadAllPlayerNames();
  const nameOf = (playerId: number) =>
    escapeTelegramHtml(playerName(names, playerId));
  const { basePot, playerBalances: players } = latestSession;

  const playerLines = players
    .map((player) =>
      [
        `• <b>${nameOf(player.playerId)}</b>`,
        `${formatMoney(player.endingAmount)} (${formatNetPosition(netWinnings(player.endingAmount, basePot))})`,
        `诈胡 ${player.zhaHuCount}`,
        `谢谢开相 ${player.xieXieKaiXiangCount}`,
      ].join(" · "),
    )
    .join("\n");
  const winners = players
    .filter((player) => isInProfit(player.endingAmount, basePot))
    .map((player) => nameOf(player.playerId));

  return [
    `<b>Last session · ${escapeTelegramHtml(latestSession.playedOn)}</b>`,
    winners.length > 0
      ? `Winner: ${winners.join(", ")}`
      : "Nobody finished in profit",
    "",
    playerLines,
    "",
    `<b>Rounds</b>: ${latestSession.rounds}`,
    `<b>Base pot</b>: ${formatMoney(basePot)} (${formatMoney(perPlayerShare(basePot))} per player)`,
    "",
    `<a href="${escapeTelegramHtml(scoreboardUrl(req))}">Open the scoreboard</a>`,
  ].join("\n");
}

async function standingsReplyText(): Promise<string> {
  const { playerWinnings, profitNightCounts } = await getSessionSummary();
  if (playerWinnings.length === 0) return NO_SESSIONS_REPLY_TEXT;

  const winsByPlayer = new Map(
    profitNightCounts.map((row) => [row.playerId, row.nights]),
  );
  const lines = playerWinnings.map((row, index) => {
    const wins = winsByPlayer.get(row.playerId) ?? 0;
    return `${index + 1}. <b>${escapeTelegramHtml(row.playerName)}</b> — ${formatNetPosition(row.netAmount)} · ${wins} win${wins === 1 ? "" : "s"}`;
  });

  return ["<b>Standings</b>", "", ...lines].join("\n");
}

function commandFrom(text: string | undefined): string | null {
  if (!text || !text.startsWith("/")) return null;
  return text.trim().split(/\s+/)[0]!.split("@")[0]!;
}

async function handleUpdate(
  update: z.infer<typeof TelegramUpdateSchema>,
  req: Request,
): Promise<void> {
  const message = update.message;
  if (!message) return;

  if (
    message.migrate_to_chat_id !== undefined ||
    message.migrate_from_chat_id !== undefined
  ) {
    req.log.error(
      {
        migrateToChatId: message.migrate_to_chat_id,
        migrateFromChatId: message.migrate_from_chat_id,
      },
      "Telegram group migrated to a new chat id — update TELEGRAM_CHAT_ID or all future sends will silently stop",
    );
    return;
  }

  const configuredChatId = getTelegramChatId();
  if (!configuredChatId || String(message.chat.id) !== configuredChatId) {
    return;
  }

  const command = commandFrom(message.text);
  switch (command) {
    case "/help":
      await sendTelegramMessage({ text: helpReplyText(req) });
      return;
    case "/last":
      await sendTelegramMessage({
        text: await lastReplyText(req),
        parseMode: "HTML",
      });
      return;
    case "/standings":
      await sendTelegramMessage({
        text: await standingsReplyText(),
        parseMode: "HTML",
      });
      return;
    default:
      return;
  }
}

router.post("/telegram/webhook", async (req, res): Promise<void> => {
  // Every authentic update must be acknowledged successfully, including
  // unknown commands, malformed payloads, and handler exceptions — a
  // non-2xx response makes Telegram retry the same update indefinitely,
  // turning one bad message into a poison pill.
  try {
    const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!configuredSecret) {
      res.sendStatus(200);
      return;
    }

    if (req.header(WEBHOOK_SECRET_HEADER) !== configuredSecret) {
      req.log.warn(
        "Telegram webhook request had a missing or incorrect secret token",
      );
      res.sendStatus(401);
      return;
    }

    const parsed = TelegramUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn(
        { err: parsed.error },
        "Telegram webhook received a malformed update",
      );
      res.sendStatus(200);
      return;
    }

    await handleUpdate(parsed.data, req);
    res.sendStatus(200);
  } catch (error) {
    req.log.error({ err: error }, "Telegram webhook handler failed");
    res.sendStatus(200);
  }
});

export default router;
