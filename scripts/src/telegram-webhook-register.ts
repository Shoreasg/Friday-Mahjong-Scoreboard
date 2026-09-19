import { setTelegramWebhook } from "@workspace/integrations-telegram";

async function registerWebhook(): Promise<void> {
  const url = process.argv[2] ?? process.env.TELEGRAM_WEBHOOK_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!url) {
    console.error(
      "Usage: pnpm --filter @workspace/scripts run telegram:webhook:register <url>\n" +
        "(or set TELEGRAM_WEBHOOK_URL). The url must be the public HTTPS address of\n" +
        "the deployed /api/telegram/webhook endpoint.",
    );
    process.exitCode = 1;
    return;
  }

  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET must be set before registering the webhook.");
    process.exitCode = 1;
    return;
  }

  const result = await setTelegramWebhook(url, secret);
  if (result.status === "skipped") {
    console.error(
      "Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing).",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Webhook registered at ${url}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await registerWebhook();
}
