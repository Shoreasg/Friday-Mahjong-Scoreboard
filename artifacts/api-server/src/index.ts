import app from "./app";
import { logger } from "./lib/logger";
import {
  isTelegramConfigured,
  setTelegramCommands,
} from "@workspace/integrations-telegram";

const TELEGRAM_COMMANDS = [
  { command: "help", description: "Show the available commands" },
  { command: "last", description: "The most recent session's result" },
  {
    command: "standings",
    description: "The cumulative net winnings leaderboard",
  },
];

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info(
    { port, telegramConfigured: isTelegramConfigured() },
    "Server listening",
  );

  // Fire-and-forget: registering the command menu is a convenience for the
  // Telegram client UI, not something the server's readiness depends on.
  setTelegramCommands(TELEGRAM_COMMANDS).catch((error) => {
    logger.warn({ err: error }, "Failed to register Telegram command menu");
  });
});
