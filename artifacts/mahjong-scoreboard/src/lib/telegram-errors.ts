/** Every Telegram-backed endpoint returns 503 the same way when the bot isn't configured. */
export function telegramFailureMessage(error: unknown, action: string): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 503) return "Telegram is not configured";
  return action;
}
