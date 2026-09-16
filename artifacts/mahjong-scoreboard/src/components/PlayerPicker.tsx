import { useState } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  getListPlayersQueryKey,
  useCreatePlayer,
  type Player,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { queryClient } from "@/lib/queryClient";
import { playerPickerOptions } from "@/lib/player-picker";
import { cn } from "@/lib/utils";

type PlayerPickerProps = {
  roster: Player[];
  value: number | undefined;
  onChange: (playerId: number) => void;
  otherSeatPlayerIds: ReadonlySet<number>;
  seatLabel: string;
  "data-testid"?: string;
};

export function PlayerPicker({
  roster,
  value,
  onChange,
  otherSeatPlayerIds,
  seatLabel,
  "data-testid": testId,
}: PlayerPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = roster.find((player) => player.id === value);
  const options = playerPickerOptions(roster, query, otherSeatPlayerIds, value);

  const createPlayer = useCreatePlayer({
    mutation: {
      onSuccess: async (player) => {
        // Wait for the refreshed roster so the new player is immediately
        // selectable in every seat, not just this one.
        await queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey() });
        onChange(player.id);
        setQuery("");
        setOpen(false);
        toast.success(`Added ${player.name} to the roster`);
      },
      onError: (error) => {
        toast.error(
          error.status === 409
            ? "That player already exists — check the roster for an inactive match"
            : "Could not add that player",
        );
      },
    },
  });

  function choose(playerId: number) {
    onChange(playerId);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`${seatLabel} player`}
          className={cn(
            "h-10 w-full justify-between border-2 px-3 font-bold normal-case",
            !selected && "text-muted-foreground",
          )}
          data-testid={testId}
        >
          <span className="truncate">{selected?.name ?? "Choose a player"}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 border-2 border-ink p-0" align="start">
        {/* Filtering is done by playerPickerOptions so the create option and
            the seat exclusions follow the same name-matching rules. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type a name..."
            value={query}
            onValueChange={setQuery}
            data-testid={testId ? `${testId}-search` : undefined}
          />
          <CommandList>
            <CommandEmpty className="px-3 py-4 text-sm font-bold text-muted-foreground">
              {options.unavailableMatch?.reason === "seated"
                ? `${options.unavailableMatch.player.name} is already in another seat.`
                : options.unavailableMatch?.reason === "inactive"
                  ? `${options.unavailableMatch.player.name} is inactive. Reactivate them from the roster.`
                  : "No players yet. Type a name to add one."}
            </CommandEmpty>
            {options.players.length > 0 && (
              <CommandGroup heading="Players">
                {options.players.map((player) => (
                  <CommandItem
                    key={player.id}
                    value={String(player.id)}
                    onSelect={() => choose(player.id)}
                    className="font-bold"
                  >
                    <Check className={cn("mr-2 size-4", player.id === value ? "opacity-100" : "opacity-0")} />
                    {player.name}
                    {!player.active && (
                      <span className="ml-auto text-xs uppercase text-muted-foreground">inactive</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {options.newPlayerName && (
              <CommandGroup heading="New player">
                <CommandItem
                  value={`create:${options.newPlayerName}`}
                  disabled={createPlayer.isPending}
                  onSelect={() =>
                    createPlayer.mutate({ data: { name: options.newPlayerName! } })
                  }
                  className="font-bold"
                  data-testid={testId ? `${testId}-create` : undefined}
                >
                  <UserPlus className="mr-2 size-4" />
                  {createPlayer.isPending ? "Adding..." : `Add “${options.newPlayerName}”`}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
