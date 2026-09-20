import {
  useGetTelegramWebhookInfo,
  useRegisterTelegramWebhook,
  getGetTelegramWebhookInfoQueryKey,
} from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Webhook } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { telegramFailureMessage } from "@/lib/telegram-errors";

const STATUS_LABEL: Record<string, string> = {
  ok: "OK",
  mismatch: "MISMATCH",
  unregistered: "NOT REGISTERED",
};

function statusBadgeVariant(status: string): "default" | "destructive" | "secondary" {
  if (status === "ok") return "default";
  if (status === "mismatch") return "destructive";
  return "secondary";
}

export function TelegramWebhookCard() {
  const { data, isLoading, error } = useGetTelegramWebhookInfo();
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (data) setUrl(data.expectedUrl);
  }, [data]);

  const registerMutation = useRegisterTelegramWebhook({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetTelegramWebhookInfoQueryKey(), updated);
        toast.success("Webhook registered");
      },
      onError: (mutationError) => {
        toast.error(telegramFailureMessage(mutationError, "Failed to register webhook"));
      },
    },
  });

  return (
    <Card className="bg-card">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Webhook className="w-6 h-6 text-foreground" strokeWidth={3} />
          <div className="text-sm text-foreground uppercase tracking-widest font-black">
            Telegram Webhook
          </div>
        </div>

        {isLoading ? (
          <p className="font-bold text-muted-foreground uppercase tracking-wide" data-testid="text-webhook-loading">
            Checking status...
          </p>
        ) : error ? (
          <p className="font-bold text-muted-foreground uppercase tracking-wide" data-testid="text-webhook-unconfigured">
            {telegramFailureMessage(error, "Could not load webhook status")}
          </p>
        ) : data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={statusBadgeVariant(data.status)} data-testid="badge-webhook-status">
                {STATUS_LABEL[data.status] ?? data.status.toUpperCase()}
              </Badge>
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground" data-testid="text-webhook-pending-count">
                {data.pendingUpdateCount} pending update{data.pendingUpdateCount === 1 ? "" : "s"}
              </span>
            </div>

            {data.registeredUrl && (
              <p className="break-all font-mono text-xs text-muted-foreground" data-testid="text-webhook-registered-url">
                Registered: {data.registeredUrl}
              </p>
            )}

            {data.lastErrorMessage && (
              <p className="font-bold text-destructive" data-testid="text-webhook-last-error">
                Last delivery error: {data.lastErrorMessage}
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://your-domain/api/telegram/webhook"
                data-testid="input-webhook-url"
              />
              <Button
                size="sm"
                disabled={!url.trim() || registerMutation.isPending}
                onClick={() => registerMutation.mutate({ data: { url: url.trim() } })}
                data-testid="button-webhook-register"
                className="shrink-0"
              >
                Register
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
