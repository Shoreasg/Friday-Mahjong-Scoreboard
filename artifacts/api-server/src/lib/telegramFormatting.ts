// Shared by every Telegram HTML message the API server sends (announcements,
// broadcasts, and the /last and /standings replies) so there is exactly one
// place a hostile player name or note has to be escaped correctly.

export function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatNetPosition(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatMoney(Math.abs(value))}`;
}
