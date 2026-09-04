import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { type MahjongSessionInput } from "@workspace/api-client-react";
import { Plus, Trash2 } from "lucide-react";

const sessionSchema = z.object({
  playedOn: z.string().min(1, "Date is required"),
  rounds: z.coerce.number().min(1).max(99),
  playerBalances: z.array(z.object({
    name: z.string().trim().min(1, "Player name is required").max(80),
    endingAmount: z.coerce.number().min(0, "Amount cannot be negative"),
  })).min(1, "Add at least one player"),
  notes: z.string().max(500).nullable().optional(),
});

type SessionFormProps = {
  defaultValues?: Partial<MahjongSessionInput> & { winnerName?: string };
  onSubmit: (data: MahjongSessionInput) => void;
  isSubmitting?: boolean;
};

export function SessionForm({ defaultValues, onSubmit, isSubmitting }: SessionFormProps) {
  const form = useForm<z.infer<typeof sessionSchema>>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      playedOn: defaultValues?.playedOn || format(new Date(), "yyyy-MM-dd"),
      rounds: defaultValues?.rounds || 4,
      playerBalances: defaultValues?.playerBalances?.length
        ? defaultValues.playerBalances
        : [{ name: defaultValues?.winnerName || "", endingAmount: 500 }],
      notes: defaultValues?.notes || "",
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "playerBalances",
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
              <p className="text-sm text-muted-foreground">Everyone starts with $500. The highest ending balance wins.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ name: "", endingAmount: 500 })}
              data-testid="button-add-player"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add player
            </Button>
          </div>

          <div className="space-y-3">
            {fields.map((player, index) => (
              <div key={player.id} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-[1fr_9rem_auto]">
                <div className="flex items-center justify-between sm:col-span-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Player {index + 1}</span>
                  <span className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-border">Starts at $500</span>
                </div>
                <FormField
                  control={form.control}
                  name={`playerBalances.${index}.name`}
                  render={({ field }) => (
                    <FormItem>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={fields.length === 1}
                  onClick={() => remove(index)}
                  aria-label={`Remove player ${index + 1}`}
                  data-testid={`button-remove-player-${index}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
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

        <div className="pt-2 flex justify-end">
          <Button type="submit" size="lg" disabled={isSubmitting} data-testid="button-submit-session">
            {isSubmitting ? "Saving..." : "Save Record"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
