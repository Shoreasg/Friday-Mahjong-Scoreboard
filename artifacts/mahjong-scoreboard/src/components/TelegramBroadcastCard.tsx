import { useSendTelegramBroadcast, useStartTelegramPoll } from "@workspace/api-client-react";
import type { TelegramPollInputPreset } from "@workspace/api-client-react";
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
import { ListChecks, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const TELEGRAM_MESSAGE_LIMIT = 4096;

const POLL_PRESETS: { preset: TelegramPollInputPreset; label: string }[] = [
  { preset: "tonight", label: "Mahjong tonight?" },
  { preset: "this_friday", label: "Mahjong this Friday?" },
];

function telegramFailureMessage(error: unknown, action: string): string {
  const status = (error as { status?: number } | null)?.status;
  if (status === 503) return "Telegram is not configured";
  return action;
}

export function TelegramBroadcastCard() {
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPoll, setPendingPoll] = useState<(typeof POLL_PRESETS)[number] | null>(null);

  const broadcastMutation = useSendTelegramBroadcast({
    mutation: {
      onSuccess: () => {
        setConfirmOpen(false);
        setMessage("");
        toast.success("Message posted to the group chat");
      },
      onError: (error) => {
        setConfirmOpen(false);
        toast.error(telegramFailureMessage(error, "Failed to send broadcast"));
      },
    },
  });

  const pollMutation = useStartTelegramPoll({
    mutation: {
      onSuccess: () => {
        setPendingPoll(null);
        toast.success("Poll posted to the group chat");
      },
      onError: (error) => {
        setPendingPoll(null);
        toast.error(telegramFailureMessage(error, "Failed to start poll"));
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

        <div className="mt-6 border-t-2 border-ink pt-4">
          <div className="mb-3 flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-foreground" strokeWidth={3} />
            <div className="text-xs text-foreground uppercase tracking-widest font-black">
              Attendance Poll
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {POLL_PRESETS.map((poll) => (
              <Button
                key={poll.preset}
                size="sm"
                variant="outline"
                onClick={() => setPendingPoll(poll)}
                data-testid={`button-telegram-poll-${poll.preset}`}
              >
                {poll.label}
              </Button>
            ))}
          </div>
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

      <AlertDialog
        open={pendingPoll !== null}
        onOpenChange={(open) => !open && setPendingPoll(null)}
      >
        <AlertDialogContent data-testid="dialog-telegram-poll-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Start "{pendingPoll?.label}" poll?</AlertDialogTitle>
            <AlertDialogDescription>
              Posts a non-anonymous Yes / No / Maybe poll to the group chat. Votes and
              the tally are visible to everyone in the chat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pollMutation.isPending}
              onClick={() =>
                pendingPoll &&
                pollMutation.mutate({ data: { preset: pendingPoll.preset } })
              }
              data-testid="button-telegram-poll-confirm"
            >
              Start poll
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
