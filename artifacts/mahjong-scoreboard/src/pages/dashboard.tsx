import { useGetSessionSummary, useListSessions, useCreateSession, useDeleteSession, useUpdateSession, getGetSessionSummaryQueryKey, getListSessionsQueryKey } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SessionForm } from "@/components/SessionForm";
import { format, parseISO } from "date-fns";
import { Trophy, Plus, LogOut, Coins, Activity, Trash2, Edit2 } from "lucide-react";
import { useState } from "react";
import { useClerk } from "@clerk/react";
import { toast } from "sonner";
import type { MahjongSession } from "@workspace/api-client-react";

export default function Dashboard() {
  const { signOut } = useClerk();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  
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
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="animate-pulse flex flex-col items-center space-y-4">
          <div className="w-12 h-16 bg-primary/20 rounded-xl" />
          <div className="text-primary font-serif">Shuffling tiles...</div>
        </div>
      </div>
    );
  }

  const sortedWinners = summary?.winnerCounts 
    ? [...summary.winnerCounts].sort((a, b) => b.wins - a.wins) 
    : [];

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-4 py-4 sm:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-10 bg-primary rounded shadow-sm relative flex items-center justify-center">
              <div className="w-6 h-8 bg-card rounded-sm flex items-center justify-center">
                <span className="text-destructive font-serif text-lg leading-none">中</span>
              </div>
            </div>
            <h1 className="font-serif text-xl sm:text-2xl text-foreground font-semibold tracking-tight">Friday Mahjong</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={() => signOut({ redirectUrl: basePath || "/" })} data-testid="button-sign-out">
            <LogOut className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Sign Out</span>
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-12">
        {/* Summary Row */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-t-4 border-t-primary shadow-sm hover-elevate">
            <CardContent className="p-4 sm:p-6 flex flex-col items-center text-center">
              <Trophy className="w-6 h-6 text-primary mb-2 opacity-80" />
              <div className="text-3xl font-serif text-foreground" data-testid="text-total-sessions">{summary?.totalSessions || 0}</div>
              <div className="text-xs sm:text-sm text-muted-foreground mt-1 uppercase tracking-wider font-semibold">Sessions</div>
            </CardContent>
          </Card>
          <Card className="border-t-4 border-t-primary shadow-sm hover-elevate">
            <CardContent className="p-4 sm:p-6 flex flex-col items-center text-center">
              <Activity className="w-6 h-6 text-primary mb-2 opacity-80" />
              <div className="text-3xl font-serif text-foreground" data-testid="text-total-rounds">{summary?.totalRounds || 0}</div>
              <div className="text-xs sm:text-sm text-muted-foreground mt-1 uppercase tracking-wider font-semibold">Rounds</div>
            </CardContent>
          </Card>
          <Card className="border-t-4 border-t-destructive shadow-sm hover-elevate col-span-2 md:col-span-2">
            <CardContent className="p-4 sm:p-6 flex flex-col items-center text-center">
              <Coins className="w-6 h-6 text-destructive mb-2 opacity-80" />
              <div className="text-3xl font-serif text-foreground" data-testid="text-total-amount">
                ${summary?.totalAmount?.toFixed(2) || "0.00"}
              </div>
              <div className="text-xs sm:text-sm text-muted-foreground mt-1 uppercase tracking-wider font-semibold">Total Pot</div>
            </CardContent>
          </Card>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Leaderboard */}
          <section className="lg:col-span-1 space-y-4">
            <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
              <Trophy className="w-5 h-5 text-primary" /> 
              Leaderboard
            </h2>
            <Card>
              <CardContent className="p-0">
                {sortedWinners.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    No games recorded yet.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {sortedWinners.map((winner, index) => (
                      <li key={winner.winnerName} className="flex items-center justify-between p-4" data-testid={`row-winner-${index}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-serif text-sm font-bold ${
                            index === 0 ? 'bg-primary text-primary-foreground' : 
                            index === 1 ? 'bg-secondary text-secondary-foreground' : 
                            'bg-accent text-accent-foreground'
                          }`}>
                            {index + 1}
                          </div>
                          <span className="font-medium text-foreground">{winner.winnerName}</span>
                        </div>
                        <div className="text-sm font-semibold px-2 py-1 bg-muted rounded">
                          {winner.wins} {winner.wins === 1 ? 'win' : 'wins'}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>

          {/* History */}
          <section className="lg:col-span-2 space-y-4">
            <h2 className="font-serif text-xl text-foreground flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" /> 
              Session History
            </h2>
            
            <div className="space-y-4">
              {sessions?.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-12 text-center text-muted-foreground">
                    <div className="w-16 h-20 bg-muted mx-auto rounded mb-4 flex items-center justify-center">
                      <span className="text-2xl opacity-50 font-serif">發</span>
                    </div>
                    <p className="mb-4">The felt is empty. Time to shuffle some tiles!</p>
                    <Button onClick={() => setCreateOpen(true)} data-testid="button-first-session">
                      Record First Session
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                sessions?.map((session) => (
                  <Card key={session.id} className="hover-elevate transition-shadow" data-testid={`card-session-${session.id}`}>
                    <CardContent className="p-5">
                      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold text-primary">
                              {format(parseISO(session.playedOn), "MMMM d, yyyy")}
                            </span>
                            <span className="w-1 h-1 bg-border rounded-full" />
                            <span className="text-sm text-muted-foreground">{session.rounds} rounds</span>
                          </div>
                          <div className="text-lg font-serif">
                            Winner: <span className="text-primary font-semibold">{session.winnerName}</span>
                          </div>
                          {session.playerBalances.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {session.playerBalances.map((player) => (
                                <div
                                  key={player.name}
                                  className={`rounded-lg border px-3 py-2 text-sm ${
                                    player.name === session.winnerName
                                      ? "border-primary/30 bg-primary/10"
                                      : "border-border bg-muted/40"
                                  }`}
                                >
                                  <span className="font-medium text-foreground">{player.name}</span>
                                  <span className="ml-2 text-muted-foreground">${player.endingAmount.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-muted-foreground">Player balances were not recorded for this session.</p>
                          )}
                          {session.notes && (
                            <p className="mt-2 text-sm text-muted-foreground italic border-l-2 border-primary/20 pl-3 py-0.5">
                              "{session.notes}"
                            </p>
                          )}
                        </div>
                        
                        <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-4 sm:gap-2">
                          <div className="text-xl font-serif text-foreground bg-accent px-3 py-1 rounded">
                            ${session.totalAmount.toFixed(2)}
                          </div>
                          <div className="flex gap-2">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 px-2 text-muted-foreground hover:text-primary"
                              onClick={() => setEditSession(session)}
                              data-testid={`button-edit-${session.id}`}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 px-2 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                if (confirm("Delete this session?")) {
                                  deleteMutation.mutate({ id: session.id });
                                }
                              }}
                              data-testid={`button-delete-${session.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Floating Action Button */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger asChild>
          <Button 
            size="icon" 
            className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 w-14 h-14 rounded-full shadow-xl hover:scale-105 active:scale-95 transition-transform"
            data-testid="button-fab-create"
          >
            <Plus className="w-6 h-6" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Session</DialogTitle>
            <DialogDescription>
              Log the results of the Friday gathering.
            </DialogDescription>
          </DialogHeader>
          <SessionForm 
            onSubmit={(data) => createMutation.mutate({ data })}
            isSubmitting={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editSession} onOpenChange={(open) => !open && setEditSession(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Session</DialogTitle>
            <DialogDescription>
              Update the details for this session.
            </DialogDescription>
          </DialogHeader>
          {editSession && (
            <SessionForm 
              defaultValues={editSession}
              onSubmit={(data) => updateMutation.mutate({ id: editSession.id, data })}
              isSubmitting={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
