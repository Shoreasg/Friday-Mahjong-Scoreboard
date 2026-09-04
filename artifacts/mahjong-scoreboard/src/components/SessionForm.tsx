import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { type MahjongSessionInput } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const sessionSchema = z.object({
  playedOn: z.string().min(1, "Date is required"),
  rounds: z.coerce.number().min(1).max(99),
  playerBalances: z.array(z.object({
    name: z.string().trim().min(1, "Player name is required").max(80),
    endingAmount: z.coerce.number().min(0, "Amount cannot be negative"),
    zhaHuCount: z.coerce.number().int("Use a whole number").min(0, "Count cannot be negative"),
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
  const form = useForm<z.infer<typeof sessionSchema>>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      playedOn: defaultValues?.playedOn || format(new Date(), "yyyy-MM-dd"),
      rounds: defaultValues?.rounds || 4,
      playerBalances: Array.from({ length: 4 }, (_, index) => {
        const player = defaultValues?.playerBalances?.[index];
        return player
          ? { ...player, zhaHuCount: player.zhaHuCount ?? 0 }
          : { name: "", endingAmount: 500, zhaHuCount: 0 };
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
        <div className={cn("space-y-6", compact && "min-h-0 flex-1 overflow-y-auto px-1 pb-6 pt-4")}>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="playedOn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date Played</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-played-on" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="rounds"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rounds Played</FormLabel>
                <FormControl>
                  <Input type="number" min="1" max="99" {...field} data-testid="input-rounds" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-foreground">Player balances</h3>
              <p className="text-sm text-muted-foreground">All four players start with $500. The highest ending balance wins.</p>
            </div>
          </div>

          <div className={cn("space-y-3", compact && "grid grid-cols-1 gap-3 space-y-0 sm:grid-cols-2")}>
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={`player-slot-${index}`}
                className={cn(
                  "grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-[1fr_9rem_7rem]",
                  compact && "grid-cols-2 gap-2 rounded-lg p-2.5 sm:grid-cols-2",
                )}
              >
                <div className="flex items-center justify-between col-span-full">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Player {index + 1}</span>
                  {!compact && (
                    <span className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-border">Starts at $500</span>
                  )}
                </div>
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.name`}
                  render={({ field }) => (
                    <FormItem className={cn(compact && "col-span-2")}>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Alice" {...field} data-testid={`input-player-name-${index}`} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.endingAmount`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ending ($)</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" step="0.01" {...field} data-testid={`input-player-balance-${index}`} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.zhaHuCount`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Zha Hu</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" step="1" {...field} data-testid={`input-player-zha-hu-${index}`} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ))}
          </div>
          {form.formState.errors.playerBalances?.root?.message && (
            <p className="text-sm font-medium text-destructive">
              {form.formState.errors.playerBalances.root.message}
            </p>
          )}
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Memorable Moments (Optional)</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Someone got a limit hand..." 
                  {...field} 
                  value={field.value || ""} 
                  data-testid="input-notes"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        </div>

        <div className={cn(
          "flex justify-end pt-2",
          compact && "sticky bottom-0 gap-2 border-t border-border bg-background py-4",
        )}>
          {compact && onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="lg" disabled={isSubmitting} data-testid="button-submit-session">
            {isSubmitting ? "Saving..." : compact ? "Save Changes" : "Save Record"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
