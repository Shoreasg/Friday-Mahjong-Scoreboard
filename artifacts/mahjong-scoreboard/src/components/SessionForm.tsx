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
          <div className="flex items-center justify-between gap-4 bg-white border-4 border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div>
              <h3 className="font-black text-black uppercase tracking-widest text-lg">Player balances</h3>
              <p className="text-sm font-bold text-muted-foreground">All four players start with $500. Highest ending wins.</p>
            </div>
          </div>

          <div className={cn("space-y-5 mt-4", compact && "grid grid-cols-1 gap-5 space-y-0 sm:grid-cols-2")}>
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={`player-slot-${index}`}
                className={cn(
                  "grid grid-cols-1 items-end gap-4 border-4 border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:grid-cols-[1fr_9rem_7rem]",
                  compact && "grid-cols-2 gap-4 p-4 sm:grid-cols-2",
                )}
              >
                <div className="flex items-center justify-between col-span-full mb-1">
                  <span className="text-sm font-black uppercase text-black bg-secondary border-2 border-black px-2 py-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] tracking-widest">Player {index + 1}</span>
                  {!compact && (
                    <span className="bg-white border-2 border-black px-2.5 py-1 text-xs font-black text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">Starts at $500</span>
                  )}
                </div>
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.name`}
                  render={({ field }) => (
                    <FormItem className={cn(compact && "col-span-2")}>
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
                      <FormLabel className="font-black uppercase tracking-wide text-xs">Ending ($)</FormLabel>
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
              </div>
            ))}
          </div>
          {form.formState.errors.playerBalances?.root?.message && (
            <p className="text-sm font-black uppercase text-white bg-destructive border-2 border-black p-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
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
          compact && "sticky bottom-0 border-t-4 border-black bg-background py-6 px-1",
        )}>
          {compact && onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} className="text-sm">
              CANCEL
            </Button>
          )}
          <Button type="submit" size="lg" disabled={isSubmitting} data-testid="button-submit-session" className="border-2 text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            {isSubmitting ? "SAVING..." : compact ? "SAVE CHANGES" : "SAVE RECORD"}
          </Button>
        </div>
      </form>
    </Form>
  );
}