import type { TelegramAnnouncementOutcome } from "@workspace/api-client-react";

export type SessionCreationNotification = {
  variant: "success" | "warning";
  message: string;
};

export function getSessionCreationNotification(
  announcement: TelegramAnnouncementOutcome,
): SessionCreationNotification {
  if (announcement.status === "failed") {
    return {
      variant: "warning",
      message: "Session recorded, but Telegram could not post the result",
    };
  }

  if (announcement.status === "skipped") {
    return {
      variant: "success",
      message: "Session recorded; Telegram is not configured",
    };
  }

  return {
    variant: "success",
    message: "Session recorded and posted to Telegram",
  };
}