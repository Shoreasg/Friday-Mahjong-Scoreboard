import { getTelegramWebhookInfo } from "@workspace/integrations-telegram";

async function printWebhookInfo(): Promise<void> {
  const result = await getTelegramWebhookInfo();

  if (result.status === "skipped") {
    console.error(
      "Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing).",
    );
    process.exitCode = 1;
    return;
  }

  const { info } = result;
  console.log(`Registered URL: ${info.url || "(none — webhook is not registered)"}`);
  console.log(`Pending updates: ${info.pendingUpdateCount}`);
  if (info.lastErrorMessage) {
    const when = info.lastErrorDate
      ? new Date(info.lastErrorDate * 1000).toISOString()
      : "unknown time";
    console.log(`Last delivery error (${when}): ${info.lastErrorMessage}`);
  } else {
    console.log("Last delivery error: none");
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await printWebhookInfo();
}
