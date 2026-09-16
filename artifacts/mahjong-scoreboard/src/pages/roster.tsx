import { useState } from "react";
import { useUser } from "@clerk/react";
import { Link } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, Check, Pencil, Users, X } from "lucide-react";
import {
  getGetSessionSummaryQueryKey,
  getListPlayersQueryKey,
  getListSessionsQueryKey,
  useListPlayers,
  useUpdatePlayer,
  type Player,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { queryClient } from "@/lib/queryClient";

function RosterRow({ player }: { player: Player }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.name);

  const updatePlayer = useUpdatePlayer({
    mutation: {
      onSuccess: (updated) => {
        // Sessions and leaderboards show names from the player record, so a
        // rename has to refresh them too.
        queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSessionSummaryQueryKey() });
        setEditing(false);
        toast.success(
          updated.name !== player.name
            ? `Renamed ${player.name} to ${updated.name}`
            : `${updated.name} is now ${updated.active ? "active" : "inactive"}`,
        );
      },
      onError: (error) => {
        toast.error(
          error.status === 409
            ? "Another player already has that name"
            : "Could not update the player",
        );
      },
    },
  });

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === player.name) {
      setName(player.name);
      setEditing(false);
      return;
    }
    updatePlayer.mutate({ id: player.id, data: { name: trimmed } });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-4 p-4" data-testid={`row-player-${player.id}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveName();
            }}
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoFocus
              aria-label={`New name for ${player.name}`}
              className="h-10 border-2 font-bold"
              data-testid={`input-rename-${player.id}`}
            />
            <Button type="submit" size="icon" className="h-10 w-10 shrink-0 border-2" disabled={updatePlayer.isPending} aria-label="Save name">
              <Check className="size-4" strokeWidth={3} />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-10 w-10 shrink-0 border-2"
              onClick={() => {
                setName(player.name);
                setEditing(false);
              }}
              aria-label="Cancel rename"
            >
              <X className="size-4" strokeWidth={3} />
            </Button>
          </form>
        ) : (
          <>
            <span className="truncate text-lg font-black uppercase text-foreground">{player.name}</span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={() => setEditing(true)}
              aria-label={`Rename ${player.name}`}
              data-testid={`button-rename-${player.id}`}
            >
              <Pencil className="size-4" strokeWidth={3} />
            </Button>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <span className="border-2 border-ink bg-muted px-3 py-1 font-mono text-sm font-black brutal-shadow-sm">
          {player.sessionCount} {player.sessionCount === 1 ? "SESSION" : "SESSIONS"}
        </span>
        <label className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
          <Switch
            checked={player.active}
            disabled={updatePlayer.isPending}
            onCheckedChange={(active) =>
              updatePlayer.mutate({ id: player.id, data: { active } })
            }
            data-testid={`switch-active-${player.id}`}
          />
          {player.active ? "Active" : "Inactive"}
        </label>
      </div>
    </li>
  );
}

export default function Roster() {
  const { isLoaded } = useUser();
  const isAdmin = useIsAdmin();
  const { data: players, isLoading } = useListPlayers();

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name),
  );

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      <header className="sticky top-0 z-10 border-b-4 border-ink bg-tile px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Button asChild variant="outline" size="sm" className="border-2 text-xs font-black uppercase tracking-widest">
            <Link href="/app">
              <ArrowLeft className="mr-2 size-4" strokeWidth={3} />
              Scoreboard
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-8">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black uppercase text-foreground">
            <Users className="size-7" strokeWidth={3} />
            Player Roster
          </h1>
          <p className="mt-2 font-bold text-muted-foreground">
            Renaming a player updates every past session and leaderboard. Inactive players
            keep their history but aren't offered when recording a new session.
          </p>
        </div>

        {!isLoaded || isLoading ? (
          <p className="font-black uppercase tracking-widest text-muted-foreground">Loading roster...</p>
        ) : !isAdmin ? (
          <Card className="bg-card">
            <CardContent className="p-8 text-center font-black uppercase text-foreground" data-testid="text-roster-admin-only">
              The roster is only available to admins.
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden bg-card">
            <CardContent className="p-0">
              {sortedPlayers.length === 0 ? (
                <p className="p-8 text-center font-bold uppercase text-muted-foreground">
                  No players yet. Add them while recording a session.
                </p>
              ) : (
                <ul className="divide-y-2 divide-ink">
                  {sortedPlayers.map((player) => (
                    <RosterRow key={player.id} player={player} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
