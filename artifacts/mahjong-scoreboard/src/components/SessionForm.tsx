import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { type MahjongSessionInput } from "@workspace/api-client-react";

const sessionSchema = z.object({
  playedOn: z.string().min(1, "Date is required"),
  rounds: z.coerce.number().min(1).max(99),
  totalAmount: z.coerce.number().min(0, "Amount must be positive"),
  winnerName: z.string().min(1, "Winner name is required").max(80),
  notes: z.string().max(500).nullable().optional(),
});

type SessionFormProps = {
  defaultValues?: Partial<MahjongSessionInput>;
  onSubmit: (data: MahjongSessionInput) => void;
  isSubmitting?: boolean;
};

export function SessionForm({ defaultValues, onSubmit, isSubmitting }: SessionFormProps) {
  const form = useForm<z.infer<typeof sessionSchema>>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      playedOn: defaultValues?.playedOn || format(new Date(), "yyyy-MM-dd"),
      rounds: defaultValues?.rounds || 4,
      totalAmount: defaultValues?.totalAmount || 0,
      winnerName: defaultValues?.winnerName || "",
      notes: defaultValues?.notes || "",
    },
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

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="winnerName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Winner Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Alice" {...field} data-testid="input-winner-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="totalAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Total Pot ($)</FormLabel>
                <FormControl>
                  <Input type="number" min="0" step="0.01" {...field} data-testid="input-total-amount" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
