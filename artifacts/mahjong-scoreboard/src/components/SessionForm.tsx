import { lazy, Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Camera, Lock, LockOpen } from "lucide-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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
import { useListPlayers, type MahjongSessionInput } from "@workspace/api-client-react";
import {
  allocationAgainstBasePot,
  CUSTOMARY_BASE_POT,
  perPlayerShare,
  validateBasePot,
  validateSession,
} from "@workspace/session-rules";
import { PlayerPicker } from "./PlayerPicker";
import { cn } from "@/lib/utils";

const ChipStackScanner = lazy(() =>
  import("./ChipStackScanner").then((module) => ({
    default: module.ChipStackScanner,
  })),
);

const sessionSchema = z.object({
  playedOn: z.string().min(1, "Date is required"),
  rounds: z.coerce.number().min(1).max(99),
  basePot: z.coerce.number().superRefine((basePot, ctx) => {
    const error = validateBasePot(basePot);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }),
  playerBalances: z.array(z.object({
    playerId: z.number({ error: "Choose a player" }).int().positive("Choose a player"),
    endingAmount: z.coerce.number().int("Use whole dollars").min(0, "Amount cannot be negative"),
    zhaHuCount: z.coerce.number().int("Use a whole number").min(0, "Count cannot be negative"),
    xieXieKaiXiangCount: z.coerce.number().int("Use a whole number").min(0, "Count cannot be negative"),
  })).length(4, "Enter all four players"),
  notes: z.string().max(500).nullable().optional(),
}).superRefine((session, ctx) => {
  const error = validateSession(session);
  if (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["playerBalances"], message: error });
  }
});

type SessionFormProps = {
  defaultValues?: Partial<MahjongSessionInput>;
  onSubmit: (data: MahjongSessionInput) => void;
  isSubmitting?: boolean;
  compact?: boolean;
  onCancel?: () => void;
};

export function SessionForm({
  defaultValues,
  onSubmit,
  isSubmitting,
  compact = false,
  onCancel,
}: SessionFormProps) {
  const [scannerOpenFor, setScannerOpenFor] = useState<number | null>(null);
  // Changing the base of a saved session rewrites every player's result for
  // that night, so it stays read-only until deliberately unlocked.
  const isExistingSession = defaultValues?.basePot !== undefined;
  const [basePotUnlocked, setBasePotUnlocked] = useState(!isExistingSession);
  const [confirmUnlockOpen, setConfirmUnlockOpen] = useState(false);
  const { data: roster = [] } = useListPlayers();

  const form = useForm<z.infer<typeof sessionSchema>>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      playedOn: defaultValues?.playedOn || format(new Date(), "yyyy-MM-dd"),
      rounds: defaultValues?.rounds || 4,
      basePot: defaultValues?.basePot ?? CUSTOMARY_BASE_POT,
      playerBalances: Array.from({ length: 4 }, (_, index) => {
        const player = defaultValues?.playerBalances?.[index];
        return player
          ? {
              ...player,
              zhaHuCount: player.zhaHuCount ?? 0,
              xieXieKaiXiangCount: player.xieXieKaiXiangCount ?? 0,
            }
          : {
              playerId: undefined as unknown as number,
              endingAmount: perPlayerShare(CUSTOMARY_BASE_POT),
              zhaHuCount: 0,
              xieXieKaiXiangCount: 0,
            };
      }),
      notes: defaultValues?.notes || "",
    },
  });

  const basePot = Number(form.watch("basePot"));
  const basePotValid = validateBasePot(basePot) === null;
  const endingAmounts = form
    .watch("playerBalances")
    .map((player) => Number(player.endingAmount) || 0);
  const allocation = allocationAgainstBasePot(basePotValid ? basePot : 0, endingAmounts);
  const seatPlayerIds = form.watch("playerBalances").map((player) => player.playerId);
  const canSubmit =
    basePotValid &&
    allocation.status === "balanced" &&
    seatPlayerIds.every((playerId) => Number.isInteger(playerId) && playerId > 0);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn(compact && "flex min-h-0 flex-1 flex-col")}
      >
        <div className={cn("space-y-8", compact && "min-h-0 flex-1 overflow-y-auto px-1 pb-6")}>
        <div className="grid grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="playedOn"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-black uppercase tracking-wide">Date Played</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-played-on" />
                </FormControl>
                <FormMessage className="font-bold text-destructive" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="rounds"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-black uppercase tracking-wide">Rounds</FormLabel>
                <FormControl>
                  <Input type="number" min="1" max="99" {...field} data-testid="input-rounds" />
                </FormControl>
                <FormMessage className="font-bold text-destructive" />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="basePot"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-black uppercase tracking-wide">Base Pot ($)</FormLabel>
              <div className="flex items-center gap-3">
                <FormControl>
                  <Input
                    type="number"
                    min="4"
                    step="4"
                    {...field}
                    readOnly={!basePotUnlocked}
                    aria-readonly={!basePotUnlocked}
                    data-testid="input-base-pot"
                    className={cn("font-mono", !basePotUnlocked && "bg-muted cursor-not-allowed")}
                  />
                </FormControl>
                {!basePotUnlocked && (
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 gap-2 border-2 text-xs font-black uppercase"
                    onClick={() => setConfirmUnlockOpen(true)}
                    data-testid="button-unlock-base-pot"
                  >
                    <Lock className="size-4" />
                    Unlock
                  </Button>
                )}
                {isExistingSession && basePotUnlocked && (
                  <LockOpen className="size-5 shrink-0 text-destructive" aria-label="Base pot unlocked" />
                )}
              </div>
              <p className="text-sm font-bold text-muted-foreground" data-testid="text-per-player-share">
                {basePotValid
                  ? `$${perPlayerShare(basePot)} per player`
                  : "Enter a whole-dollar base that divides evenly among four players"}
              </p>
              <FormMessage className="font-bold text-destructive" />
            </FormItem>
          )}
        />

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 bg-tile border-4 border-ink p-4 brutal-shadow">
            <div>
              <h3 className="font-black text-foreground uppercase tracking-widest text-lg">Player balances</h3>
              <p className="text-sm font-bold text-muted-foreground">
                {basePotValid
                  ? `Each player starts with $${perPlayerShare(basePot)}.`
                  : "Set the base pot first."}{" "}
                Count each time “谢谢 Kai Xiang” is said.
              </p>
            </div>
          </div>

          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-2 border-4 border-ink p-3 font-mono font-black brutal-shadow-sm",
              allocation.status === "balanced" && "bg-primary text-primary-foreground",
              allocation.status === "under" && "bg-secondary text-secondary-foreground",
              allocation.status === "over" && "bg-destructive text-destructive-foreground",
            )}
            role="status"
            aria-live="polite"
            data-testid="text-allocation-tally"
          >
            <span>Allocated ${allocation.allocated} of ${basePotValid ? basePot : "—"}</span>
            <span className="uppercase">
              {allocation.status === "balanced"
                ? "Balanced"
                : allocation.status === "under"
                  ? `$${allocation.remaining} left to allocate`
                  : `Over by $${-allocation.remaining}`}
            </span>
          </div>

          <div className={cn("space-y-5 mt-4", compact && "grid grid-cols-1 gap-5 space-y-0 sm:grid-cols-2")}>
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={`player-slot-${index}`}
                className={cn(
                  "grid grid-cols-1 items-end gap-4 border-4 border-ink bg-tile p-5 brutal-shadow sm:grid-cols-[1fr_9rem_7rem_9rem]",
                  compact && "grid-cols-3 gap-4 p-4 sm:grid-cols-3",
                )}
              >
                <div className="flex items-center justify-between col-span-full mb-1">
                  <span className="text-sm font-black uppercase text-secondary-foreground bg-secondary border-2 border-ink px-2 py-1 brutal-shadow-sm tracking-widest">Player {index + 1}</span>
                  {!compact && (
                    <span className="bg-tile border-2 border-ink px-2.5 py-1 text-xs font-black text-foreground brutal-shadow-sm">
                      {basePotValid ? `Starts at $${perPlayerShare(basePot)}` : "Set base pot"}
                    </span>
                  )}
                </div>
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.playerId`}
                  render={({ field }) => (
                    <FormItem className={cn(compact && "col-span-3")}>
                      <FormLabel className="font-black uppercase tracking-wide text-xs">Player</FormLabel>
                      <FormControl>
                        <PlayerPicker
                          roster={roster}
                          value={field.value}
                          onChange={(playerId) => field.onChange(playerId)}
                          otherSeatPlayerIds={
                            new Set(seatPlayerIds.filter((_, seat) => seat !== index))
                          }
                          seatLabel={`Seat ${index + 1}`}
                          data-testid={`input-player-${index}`}
                        />
                      </FormControl>
                      <FormMessage className="font-bold text-destructive text-xs" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.endingAmount`}
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel className="font-black uppercase tracking-wide text-xs">Ending ($)</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" step="1" {...field} data-testid={`input-player-balance-${index}`} className="border-2 font-mono" />
                      </FormControl>
                      <FormMessage className="font-bold text-destructive text-xs" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.zhaHuCount`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-black uppercase tracking-wide text-xs">Zha Hu</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" step="1" {...field} data-testid={`input-player-zha-hu-${index}`} className="border-2 font-mono" />
                      </FormControl>
                      <FormMessage className="font-bold text-destructive text-xs" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.xieXieKaiXiangCount`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-black uppercase tracking-wide text-xs">
                        谢谢 Kai Xiang
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          {...field}
                          data-testid={`input-player-xie-xie-kai-xiang-${index}`}
                          className="border-2 font-mono"
                        />
                      </FormControl>
                      <FormMessage className="font-bold text-destructive text-xs" />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="col-span-full h-10 w-full gap-2 border-2 border-ink bg-accent px-3 text-xs font-black uppercase tracking-widest text-accent-foreground brutal-shadow-sm hover:bg-accent/80"
                  onClick={() => setScannerOpenFor(index)}
                  data-testid={`button-scan-chips-${index}`}
                  aria-label={`Scan chip stacks for Player ${index + 1} ending balance`}
                >
                  <Camera className="size-4 shrink-0" />
                  Scan chips for ending balance
                </Button>
              </div>
            ))}
          </div>
          {form.formState.errors.playerBalances?.root?.message && (
            <p className="text-sm font-black uppercase text-destructive-foreground bg-destructive border-2 border-ink p-2 brutal-shadow-sm">
              {form.formState.errors.playerBalances.root.message}
            </p>
          )}
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="pt-2">
              <FormLabel className="font-black uppercase tracking-wide">Memorable Moments (Optional)</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Someone got a limit hand..." 
                  {...field} 
                  value={field.value || ""} 
                  data-testid="input-notes"
                  className="min-h-[100px]"
                />
              </FormControl>
              <FormMessage className="font-bold text-destructive" />
            </FormItem>
          )}
        />
        </div>

        <div className={cn(
          "flex justify-end gap-4 pt-6 mt-2",
          compact && "sticky bottom-0 border-t-4 border-ink bg-background py-6 px-1",
        )}>
          {compact && onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} className="text-sm">
              CANCEL
            </Button>
          )}
          <Button type="submit" size="lg" disabled={isSubmitting || !canSubmit} data-testid="button-submit-session" className="border-2 text-sm brutal-shadow">
            {isSubmitting ? "SAVING..." : compact ? "SAVE CHANGES" : "SAVE RECORD"}
          </Button>
        </div>
      </form>
      <Suspense fallback={
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-tile border-4 border-ink p-6 brutal-shadow-lg text-center flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-ink bg-primary rounded-full animate-ping" />
            <p className="font-black uppercase tracking-widest text-sm">Loading Scanner...</p>
          </div>
        </div>
      }>
        {scannerOpenFor !== null && (
          <ChipStackScanner
            open={true}
            onOpenChange={(open) => {
              if (!open) setScannerOpenFor(null);
            }}
            playerName={
              roster.find(
                (player) => player.id === form.getValues(`playerBalances.${scannerOpenFor}.playerId`),
              )?.name ?? `Player ${scannerOpenFor + 1}`
            }
            onApply={(amount) => {
              form.setValue(`playerBalances.${scannerOpenFor}.endingAmount`, Math.round(amount), { shouldValidate: true });
            }}
          />
        )}
      </Suspense>
      <AlertDialog open={confirmUnlockOpen} onOpenChange={setConfirmUnlockOpen}>
        <AlertDialogContent className="border-4 border-ink brutal-shadow-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-black uppercase">Change the base pot?</AlertDialogTitle>
            <AlertDialogDescription className="font-bold">
              The base pot sets what every player started with. Changing it rewrites the
              net winnings for all four players in this session, and the ending amounts
              will need to add up to the new base before you can save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-2 font-black uppercase">Keep locked</AlertDialogCancel>
            <AlertDialogAction
              className="border-2 border-ink bg-destructive font-black uppercase text-destructive-foreground"
              onClick={() => setBasePotUnlocked(true)}
              data-testid="button-confirm-unlock-base-pot"
            >
              Unlock base pot
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Form>
  );
}