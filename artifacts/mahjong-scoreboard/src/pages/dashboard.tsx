import { useGetSessionSummary, useListSessions, useCreateSession, useDeleteSession, useUpdateSession, getGetSessionSummaryQueryKey, getListSessionsQueryKey } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SessionForm } from "@/components/SessionForm";
import { format, parseISO } from "date-fns";
import { Trophy, Plus, LogOut, Coins, Activity, Trash2, Edit2, ChevronDown, LogIn, Flame } from "lucide-react";
import { useState } from "react";
import { useClerk, useUser } from "@clerk/react";
import { toast } from "sonner";
import type { MahjongSession } from "@workspace/api-client-react";
import { Link } from "wouter";

function formatSignedCurrency(amount: number) {
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export default function Dashboard() {
  const { signOut } = useClerk();
  const { isSignedIn, user } = useUser();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const adminEmails = new Set(
    import.meta.env.VITE_ADMIN_EMAILS
      ?.split(",")
      .map((email: string) => email.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  const isAdmin = Boolean(
    isSignedIn &&
    adminEmails.size > 0 &&
    user?.emailAddresses.some(
      ({ emailAddress }) =>
        adminEmails.has(emailAddress.trim().toLocaleLowerCase()),
    ),
  );
  
  const { data: summary, isLoading: isLoadingSummary } = useGetSessionSummary();
  const { data: sessions, isLoading: isLoadingSessions } = useListSessions();

  const [createOpen, setCreateOpen] = useState(false);
  const [editSession, setEditSession] = useState<MahjongSession | null>(null);

  const createMutation = useCreateSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSessionSummaryQueryKey() });
        setCreateOpen(false);
        toast.success("Session recorded successfully");
      },
      onError: () => toast.error("Failed to record session")
    }
  });

  const updateMutation = useUpdateSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSessionSummaryQueryKey() });
        setEditSession(null);
        toast.success("Session updated successfully");
      },
      onError: () => toast.error("Failed to update session")
    }
  });

  const deleteMutation = useDeleteSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSessionSummaryQueryKey() });
        toast.success("Session deleted");
      },
      onError: () => toast.error("Failed to delete session")
    }
  });

  if (isLoadingSummary || isLoadingSessions) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="flex flex-col items-center space-y-6">
          <div className="w-16 h-24 bg-white border-4 border-black rounded-md shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] animate-bounce flex items-center justify-center">
             <div className="w-8 h-8 rounded-full bg-destructive border-2 border-black" />
          </div>
          <div className="text-black font-sans font-black text-2xl uppercase tracking-widest bg-white border-4 border-black px-6 py-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">Shuffling tiles...</div>
        </div>
      </div>
    );
  }

  const sortedWinners = summary?.winnerCounts 
    ? [...summary.winnerCounts].sort((a, b) => b.wins - a.wins) 
    : [];
  const sortedZhaHu = summary?.zhaHuCounts
    ? [...summary.zhaHuCounts].sort(
        (a, b) => b.count - a.count || a.playerName.localeCompare(b.playerName),
      )
    : [];

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b-4 border-black px-4 py-4 sm:px-8 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <div className="w-10 h-12 bg-white border-2 border-black rounded-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] relative flex items-center justify-center transform -rotate-6 hover:rotate-0 hover:-translate-y-1 transition-all cursor-pointer">
                <span className="text-destructive font-sans text-xl font-black leading-none mt-1">中</span>
              </div>
            </Link>
            <h1 className="font-sans text-2xl sm:text-3xl text-black font-black uppercase tracking-tight hidden sm:block">Friday Mahjong</h1>
          </div>
          {isSignedIn ? (
            <Button variant="outline" size="sm" onClick={() => signOut({ redirectUrl: `${basePath}/app` || "/app" })} data-testid="button-sign-out" className="border-2 font-black uppercase tracking-widest text-xs">
              <LogOut className="w-4 h-4 mr-2" strokeWidth={3} />
              <span className="hidden sm:inline">{isAdmin ? "Admin Out" : "Sign Out"}</span>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm" className="border-2 font-black uppercase tracking-widest text-xs">
              <Link href="/sign-in">
                <LogIn className="w-4 h-4 mr-2" strokeWidth={3} />
                <span className="hidden sm:inline">Admin In</span>
              </Link>
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-10 space-y-12">
        {/* Summary Row */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Card className="bg-secondary">
            <CardContent className="p-6 flex flex-col items-center text-center">
              <Trophy className="w-8 h-8 text-black mb-2" strokeWidth={3} />
              <div className="text-5xl font-sans font-black text-black" data-testid="text-total-sessions">{summary?.totalSessions || 0}</div>
              <div className="text-sm text-black mt-2 uppercase tracking-widest font-black">Sessions</div>
            </CardContent>
          </Card>
          <Card className="bg-accent">
            <CardContent className="p-6 flex flex-col items-center text-center">
              <Activity className="w-8 h-8 text-black mb-2" strokeWidth={3} />
              <div className="text-5xl font-sans font-black text-black" data-testid="text-total-rounds">{summary?.totalRounds || 0}</div>
              <div className="text-sm text-black mt-2 uppercase tracking-widest font-black">Rounds</div>
            </CardContent>
          </Card>
          <Card className="col-span-2 md:col-span-2 bg-white">
            <CardContent className="p-6">
              <div className="mb-4 flex items-center justify-center gap-2">
                <Coins className="w-6 h-6 text-black" strokeWidth={3} />
                <div className="text-sm text-black uppercase tracking-widest font-black">Cumulative Winnings</div>
              </div>
              {summary?.playerWinnings.length ? (
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {summary.playerWinnings.map((player) => (
                    <div
                      key={player.playerName.toLocaleLowerCase()}
                      className="flex min-w-0 items-center justify-between gap-2 border-2 border-black bg-muted px-3 py-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <span className="truncate font-black text-black uppercase">{player.playerName}</span>
                      <span
                        className={`shrink-0 font-mono font-bold text-lg ${
                          player.netAmount > 0
                            ? "text-primary border-b-2 border-primary drop-shadow-[1px_1px_0px_rgba(0,0,0,1)]"
                            : player.netAmount < 0
                              ? "text-destructive border-b-2 border-destructive"
                              : "text-black"
                        }`}
                        data-testid={`text-player-winnings-${player.playerName.toLocaleLowerCase()}`}
                      >
                        {formatSignedCurrency(player.netAmount)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center font-bold text-muted-foreground uppercase tracking-wide">
                  NO BALANCES RECORDED YET.
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Leaderboard */}
          <section className="lg:col-span-1 space-y-8">
            <div>
              <h2 className="font-sans font-black text-2xl text-black flex items-center gap-2 uppercase mb-4">
                <Trophy className="w-6 h-6 text-black" strokeWidth={3} />
                Leaderboard
              </h2>
              <Card className="bg-white overflow-hidden">
                <CardContent className="p-0">
                  {sortedWinners.length === 0 ? (
                    <div className="p-8 text-center font-bold text-muted-foreground uppercase tracking-wide">
                      NO GAMES RECORDED.
                    </div>
                  ) : (
                    <ul className="divide-y-2 divide-black">
                      {sortedWinners.map((winner, index) => (
                        <li key={winner.winnerName} className="flex items-center justify-between p-4" data-testid={`row-winner-${index}`}>
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center font-mono text-lg font-bold ${
                              index === 0 ? 'bg-secondary text-black' :
                              index === 1 ? 'bg-muted text-black' :
                              'bg-white text-black'
                            }`}>
                              {index + 1}
                            </div>
                            <span className="font-black text-lg text-black uppercase">{winner.winnerName}</span>
                          </div>
                          <div className="text-sm font-black px-3 py-1 bg-primary text-black border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] tracking-widest">
                            {winner.wins} {winner.wins === 1 ? 'WIN' : 'WINS'}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            <div>
              <h2 className="font-sans font-black text-2xl text-black flex items-center gap-2 uppercase mb-4">
                <Flame className="w-6 h-6 text-destructive" strokeWidth={3} />
                Zha Hu Board
              </h2>
              <Card className="bg-white overflow-hidden">
                <CardContent className="p-0">
                  {sortedZhaHu.length === 0 ? (
                    <div className="p-8 text-center font-bold text-muted-foreground uppercase tracking-wide">
                      NO ZHA HU RECORDED.
                    </div>
                  ) : (
                    <ul className="divide-y-2 divide-black">
                      {sortedZhaHu.map((player, index) => (
                        <li key={player.playerName.toLocaleLowerCase()} className="flex items-center justify-between p-4" data-testid={`row-zha-hu-${index}`}>
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center font-mono text-lg font-bold ${
                              index === 0 ? "bg-destructive text-white" :
                              index === 1 ? "bg-secondary text-black" :
                              "bg-white text-black"
                            }`}>
                              {index + 1}
                            </div>
                            <span className="font-black text-lg text-black uppercase">{player.playerName}</span>
                          </div>
                          <div className="text-sm font-black px-3 py-1 bg-muted border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-black tracking-widest">
                            {player.count} {player.count === 1 ? "TIME" : "TIMES"}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>

          {/* History */}
          <section className="lg:col-span-2 space-y-4">
            <h2 className="font-sans font-black text-2xl text-black flex items-center gap-2 uppercase mb-4">
              <Activity className="w-6 h-6 text-black" strokeWidth={3} />
              Session History
            </h2>
            
            <div className="space-y-6">
              {sessions?.length === 0 ? (
                <Card className="bg-white border-dashed border-4">
                  <CardContent className="p-16 text-center text-black flex flex-col items-center">
                    <div className="w-20 h-28 bg-muted border-4 border-black mx-auto rounded-md mb-6 flex items-center justify-center shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -rotate-3">
                      <span className="text-4xl font-sans font-black text-black">發</span>
                    </div>
                    <p className="mb-8 font-bold text-xl uppercase">The felt is empty. Time to play!</p>
                    <Button onClick={() => setCreateOpen(true)} data-testid="button-first-session" size="lg" className="border-4 text-lg px-8 py-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                      RECORD FIRST SESSION
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                sessions?.map((session) => (
                  <Card key={session.id} className="bg-white hover:-translate-y-[4px] hover:-translate-x-[4px] hover:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] transition-all" data-testid={`card-session-${session.id}`}>
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm font-black text-black bg-secondary border-2 border-black px-2.5 py-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] tracking-wide">
                              {format(parseISO(session.playedOn), "MMM d, yyyy").toUpperCase()}
                            </span>
                            <span className="text-sm font-bold text-black border-2 border-black px-2 py-1 tracking-wide bg-muted">{session.rounds} ROUNDS</span>
                          </div>
                          <div className="mt-5 text-xl font-sans font-black uppercase tracking-wide">
                            Winner: <span className="text-primary ml-2 bg-primary/20 px-2 py-1 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-black">{session.winnerName}</span>
                          </div>
                        </div>
                        {isAdmin && (
                          <div className="flex shrink-0 items-center gap-2">
                            <Button 
                              variant="outline"
                              size="icon"
                              className="h-10 w-10 border-2"
                              onClick={() => setEditSession(session)}
                              aria-label={`Edit session from ${session.playedOn}`}
                              data-testid={`button-edit-${session.id}`}
                            >
                              <Edit2 className="w-4 h-4" strokeWidth={3} />
                            </Button>
                            <Button 
                              variant="destructive"
                              size="icon"
                              className="h-10 w-10 border-2"
                              onClick={() => {
                                if (confirm("Delete this session forever?")) {
                                  deleteMutation.mutate({ id: session.id });
                                }
                              }}
                              aria-label={`Delete session from ${session.playedOn}`}
                              data-testid={`button-delete-${session.id}`}
                            >
                              <Trash2 className="w-4 h-4" strokeWidth={3} />
                            </Button>
                          </div>
                        )}
                      </div>

                      {session.playerBalances.length > 0 ? (
                        <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4">
                          {session.playerBalances.map((player) => (
                            <div
                              key={player.name}
                              className={`flex min-w-0 items-center justify-between gap-2 border-2 border-black px-3 py-2 sm:px-4 sm:py-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] ${
                                player.name === session.winnerName
                                  ? "bg-primary text-black"
                                  : "bg-white text-black"
                              }`}
                            >
                              <span className="truncate font-black uppercase text-sm sm:text-base tracking-wide">{player.name}</span>
                              <span className="flex shrink-0 items-center gap-3">
                                {player.zhaHuCount > 0 && (
                                  <span className="bg-destructive text-white border-2 border-black px-1.5 py-0.5 font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                    ZH {player.zhaHuCount}
                                  </span>
                                )}
                                <span className="font-mono font-bold text-base sm:text-lg">${player.endingAmount.toFixed(2)}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-4 text-xs font-bold text-muted-foreground uppercase">Player balances were not recorded.</p>
                      )}

                      {session.notes && (
                        <Collapsible className="mt-6 border-2 border-black bg-muted/30">
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" className="w-full flex justify-between h-10 px-4 text-sm font-bold text-black uppercase tracking-widest hover:bg-muted/50 rounded-none">
                              Memorable Moments
                              <ChevronDown className="h-5 w-5 transition-transform group-data-[state=open]:rotate-180" strokeWidth={3} />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="border-t-2 border-black bg-white p-4">
                            <p className="text-base font-bold text-black italic">
                              "{session.notes}"
                            </p>
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Floating Action Button */}
      {isAdmin && (
        <Button 
          size="icon" 
          className="fixed bottom-6 right-6 sm:bottom-10 sm:right-10 w-16 h-16 rounded-full shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-[4px] hover:-translate-x-[2px] hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] active:translate-y-[2px] active:translate-x-[2px] active:shadow-none transition-all z-40 bg-secondary text-black border-4 border-black"
          onClick={() => setCreateOpen(true)}
          data-testid="button-fab-create"
        >
          <Plus className="w-8 h-8" strokeWidth={3} />
        </Button>
      )}

      {/* Create Sheet */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="flex h-dvh w-full max-w-none flex-col overflow-hidden border-l-0 p-0 sm:w-[46rem] sm:max-w-[46rem] sm:border-l-4 sm:border-black">
          <SheetHeader className="shrink-0 px-6 py-6 pr-14 sm:px-8">
            <SheetTitle>Record Session</SheetTitle>
            <SheetDescription>
              Log the results of the Friday gathering.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 px-4 sm:px-8 bg-background pb-8 pt-4">
            <SessionForm 
              compact
              onSubmit={(data) => createMutation.mutate({ data })}
              onCancel={() => setCreateOpen(false)}
              isSubmitting={createMutation.isPending}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit Sheet */}
      <Sheet open={!!editSession} onOpenChange={(open) => !open && setEditSession(null)}>
        <SheetContent className="flex h-dvh w-full max-w-none flex-col overflow-hidden border-l-0 p-0 sm:w-[46rem] sm:max-w-[46rem] sm:border-l-4 sm:border-black">
          <SheetHeader className="shrink-0 px-6 py-6 pr-14 sm:px-8">
            <SheetTitle>Edit Session</SheetTitle>
            <SheetDescription>
              Update the details for this session.
            </SheetDescription>
          </SheetHeader>
          {editSession && (
            <div className="flex min-h-0 flex-1 px-4 sm:px-8 bg-background pb-8 pt-4">
              <SessionForm 
                compact
                defaultValues={editSession}
                onSubmit={(data) => updateMutation.mutate({ id: editSession.id, data })}
                onCancel={() => setEditSession(null)}
                isSubmitting={updateMutation.isPending}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
}