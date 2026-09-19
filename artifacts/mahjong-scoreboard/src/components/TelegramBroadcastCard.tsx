import { useSendTelegramBroadcast } from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const TELEGRAM_MESSAGE_LIMIT = 4096;

function broadcastFailureMessage(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 503) return "Telegram is not configured";
  return "Failed to send broadcast";
}

export function TelegramBroadcastCard() {
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const broadcastMutation = useSendTelegramBroadcast({
    mutation: {
      onSuccess: () => {
        setConfirmOpen(false);
        setMessage("");
        toast.success("Message posted to the group chat");
      },
      onError: (error) => {
        setConfirmOpen(false);
        toast.error(broadcastFailureMessage(error));
      },
    },
  });

  const trimmed = message.trim();
  const overLimit = message.length > TELEGRAM_MESSAGE_LIMIT;
  const canSend = trimmed.length > 0 && !overLimit;

  return (
    <Card className="bg-card">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Send className="w-6 h-6 text-foreground" strokeWidth={3} />
          <div className="text-sm text-foreground uppercase tracking-widest font-black">
            Telegram Broadcast
          </div>
        </div>
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Message the group chat..."
          rows={3}
          data-testid="input-telegram-broadcast"
        />
        <div className="mt-2 flex items-center justify-between">
          <span
            className={`text-xs font-bold uppercase tracking-wide ${
              overLimit ? "text-destructive" : "text-muted-foreground"
            }`}
            data-testid="text-telegram-character-count"
          >
            {message.length} / {TELEGRAM_MESSAGE_LIMIT}
          </span>
          <Button
            size="sm"
            disabled={!canSend}
            onClick={() => setConfirmOpen(true)}
            data-testid="button-telegram-broadcast"
          >
            Send
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-telegram-broadcast-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Post this to the group chat?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="whitespace-pre-wrap rounded-md border-2 border-ink bg-muted p-3 text-left text-sm font-bold text-foreground">
                {trimmed}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={broadcastMutation.isPending}
              onClick={() => broadcastMutation.mutate({ data: { message: trimmed } })}
              data-testid="button-telegram-broadcast-confirm"
            >
              Send to group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
