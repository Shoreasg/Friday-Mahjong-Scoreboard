import { lazy, Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Camera } from "lucide-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { type MahjongSessionInput } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const ChipStackScanner = lazy(() =>
  import("./ChipStackScanner").then((module) => ({
    default: module.ChipStackScanner,
  })),
);

const sessionSchema = z.object({
  playedOn: z.string().min(1, "Date is required"),
  rounds: z.coerce.number().min(1).max(99),
  playerBalances: z.array(z.object({
    name: z.string().trim().min(1, "Player name is required").max(80),
    endingAmount: z.coerce.number().min(0, "Amount cannot be negative"),
    zhaHuCount: z.coerce.number().int("Use a whole number").min(0, "Count cannot be negative"),
    xieXieKaiXiangCount: z.coerce.number().int("Use a whole number").min(0, "Count cannot be negative"),
  })).length(4, "Enter all four players"),
  notes: z.string().max(500).nullable().optional(),
});

type SessionFormProps = {
  defaultValues?: Partial<MahjongSessionInput> & { winnerName?: string };
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

  const form = useForm<z.infer<typeof sessionSchema>>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      playedOn: defaultValues?.playedOn || format(new Date(), "yyyy-MM-dd"),
      rounds: defaultValues?.rounds || 4,
      playerBalances: Array.from({ length: 4 }, (_, index) => {
        const player = defaultValues?.playerBalances?.[index];
        return player
          ? {
              ...player,
              zhaHuCount: player.zhaHuCount ?? 0,
              xieXieKaiXiangCount: player.xieXieKaiXiangCount ?? 0,
            }
          : {
              name: "",
              endingAmount: 500,
              zhaHuCount: 0,
              xieXieKaiXiangCount: 0,
            };
      }),
      notes: defaultValues?.notes || "",
    },
  });

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

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 bg-tile border-4 border-ink p-4 brutal-shadow">
            <div>
              <h3 className="font-black text-foreground uppercase tracking-widest text-lg">Player balances</h3>
              <p className="text-sm font-bold text-muted-foreground">
                All four players start with $500. Count each time “谢谢 Kai Xiang” is said.
              </p>
            </div>
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
                    <span className="bg-tile border-2 border-ink px-2.5 py-1 text-xs font-black text-foreground brutal-shadow-sm">Starts at $500</span>
                  )}
                </div>
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.name`}
                  render={({ field }) => (
                    <FormItem className={cn(compact && "col-span-3")}>
                      <FormLabel className="font-black uppercase tracking-wide text-xs">Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Alice" {...field} data-testid={`input-player-name-${index}`} className="border-2" />
                      </FormControl>
                      <FormMessage className="font-bold text-destructive text-xs" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.endingAmount`}
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between mb-2">
                        <FormLabel className="font-black uppercase tracking-wide text-xs mb-0">Ending ($)</FormLabel>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] border-2 border-ink brutal-shadow-sm bg-accent text-accent-foreground hover:bg-accent/80 shrink-0"
                          onClick={() => setScannerOpenFor(index)}
                          data-testid={`button-scan-chips-${index}`}
                        >
                          <Camera className="w-3 h-3 mr-1" /> SCAN
                        </Button>
                      </div>
                      <FormControl>
                        <Input type="number" min="0" step="0.01" {...field} data-testid={`input-player-balance-${index}`} className="border-2 font-mono" />
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
          <Button type="submit" size="lg" disabled={isSubmitting} data-testid="button-submit-session" className="border-2 text-sm brutal-shadow">
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
            playerName={form.getValues(`playerBalances.${scannerOpenFor}.name`) || `Player ${scannerOpenFor + 1}`}
            onApply={(amount) => {
              form.setValue(`playerBalances.${scannerOpenFor}.endingAmount`, amount, { shouldValidate: true });
            }}
          />
        )}
      </Suspense>
    </Form>
  );
}