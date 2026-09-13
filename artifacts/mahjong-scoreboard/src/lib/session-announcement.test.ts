import assert from "node:assert/strict";
import test from "node:test";
import { getSessionCreationNotification } from "./session-announcement.ts";

test("uses a success toast when Telegram posts the session", () => {
  assert.deepEqual(
    getSessionCreationNotification({ status: "sent", messageId: 42 }),
    {
      variant: "success",
      message: "Session recorded and posted to Telegram",
    },
  );
});

test("explains when Telegram is not configured", () => {
  assert.deepEqual(
    getSessionCreationNotification({
      status: "skipped",
      reason: "not_configured",
    }),
    {
      variant: "success",
      message: "Session recorded; Telegram is not configured",
    },
  );
});

test("warns when Telegram delivery fails after saving", () => {
  assert.deepEqual(
    getSessionCreationNotification({
      status: "failed",
      reason: "delivery_failed",
    }),
    {
      variant: "warning",
      message: "Session recorded, but Telegram could not post the result",
    },
  );
});