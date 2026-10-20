import { useRef, useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import {
  getGetReservationEventQueryKey,
  getListReservationEventsQueryKey,
  useCancelReservationEvent,
  useCreateReservationEvent,
  useGetReservationEvent,
  useJoinReservationEvent,
  useLeaveReservationEvent,
  useListReservationEvents,
  useRetryReservationNotification,
  useUpdateReservationEvent,
  type ReservationEvent,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { reservationSignInPath } from "@/lib/reservation-routing";
import { getReservationViewModel } from "@/lib/reservation-view-model";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useUser } from "@clerk/react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  LogIn,
  RotateCw,
  Users,
} from "lucide-react";

function singaporeDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((part) => part.type === "year")?.value);
  const m = Number(parts.find((part) => part.type === "month")?.value);
  const d = Number(parts.find((part) => part.type === "day")?.value);
  const date = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatEventDate(event: ReservationEvent) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: event.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(event.startsAt));
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function authDestination(path: string) {
  return reservationSignInPath(path);
}

function readableError(error: unknown) {
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === "object") {
    const payload = data as { error?: unknown; code?: unknown };
    if (payload.code === "EVENT_STARTED") return "This event has already started. Reservations are locked.";
    if (payload.code === "EVENT_CANCELLED") return "This event was cancelled. Reservations are locked.";
    if (payload.code === "START_NOT_FUTURE") return "Choose a future Singapore date and time.";
    if (payload.code === "MANAGER_REQUIRED") return "Only the event creator or an admin can manage this event.";
    if (payload.code === "NOT_RETRYABLE") return "This notification is no longer eligible for retry.";
    if (payload.code === "UNAUTHORIZED") return "Your sign-in has expired. Sign in again to continue.";
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  }
  if ((error as { status?: number } | null)?.status === 401) {
    return "Your sign-in has expired. Sign in again to continue.";
  }
  return "That request could not be completed. Please try again.";
}

function EventTopbar({ title = "Friday Mahjong" }: { title?: string }) {
  return (
    <header className="sticky top-0 z-20 border-b-4 border-ink bg-tile px-4 py-3 sm:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <Link href="/app" className="flex min-w-0 items-center gap-3" data-testid="link-scoreboard-home">
          <span className="flex h-11 w-9 shrink-0 -rotate-3 items-center justify-center border-2 border-ink bg-tile text-2xl font-black text-destructive brutal-shadow-sm">中</span>
          <span className="truncate font-sans text-lg font-black uppercase tracking-tight sm:text-2xl">{title}</span>
        </Link>
        <Link href="/app/reservations" className="inline-flex items-center gap-2 border-2 border-ink bg-secondary px-3 py-2 text-xs font-black uppercase tracking-wider brutal-shadow-sm transition-transform hover:-translate-y-0.5 sm:text-sm" data-testid="link-reservations">
          <CalendarDays className="h-4 w-4" strokeWidth={3} />
          <span>Seats</span>
        </Link>
      </div>
    </header>
  );
}

function Notice({ children, tone = "error" }: { children: React.ReactNode; tone?: "error" | "info" }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-3 border-2 border-ink p-4 font-bold brutal-shadow-sm ${tone === "error" ? "bg-destructive text-destructive-foreground" : "bg-accent text-accent-foreground"}`}>
      <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={3} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function idempotencyRequest(ref: React.MutableRefObject<string>) {
  const headers = Object.defineProperty({}, "Idempotency-Key", {
    enumerable: true,
    get: () => ref.current,
  });
  return { headers };
}

function useReservationMutations(eventId: number | null) {
  const [, navigate] = useLocation();
  const keyRef = useRef("");
  const request = idempotencyRequest(keyRef);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | undefined>();
  const refresh = (event: ReservationEvent) => {
    setError("");
    setErrorStatus(undefined);
    queryClient.setQueryData(getGetReservationEventQueryKey(event.id), event);
    queryClient.invalidateQueries({ queryKey: getListReservationEventsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetReservationEventQueryKey(event.id) });
  };
  const onError = (cause: unknown) => {
    setError(readableError(cause));
    setErrorStatus((cause as { status?: number } | null)?.status);
  };
  const create = useCreateReservationEvent({
    request,
    mutation: {
      onSuccess: (event) => {
        refresh(event);
        navigate(`/app/reservations/${event.id}`);
      },
      onError,
    },
  });
  const update = useUpdateReservationEvent({ request, mutation: { onSuccess: refresh, onError } });
  const join = useJoinReservationEvent({ request, mutation: { onSuccess: refresh, onError } });
  const leave = useLeaveReservationEvent({ request, mutation: { onSuccess: refresh, onError } });
  const cancel = useCancelReservationEvent({ request, mutation: { onSuccess: refresh, onError } });
  const retry = useRetryReservationNotification({ request, mutation: { onSuccess: refresh, onError } });

  const run = (action: () => void) => {
    keyRef.current = crypto.randomUUID();
    setError("");
    setErrorStatus(undefined);
    action();
  };
  return {
    create, update, join, leave, cancel, retry, run, error, errorStatus, setError,
    pending: create.isPending || update.isPending || join.isPending || leave.isPending || cancel.isPending || retry.isPending,
    signInLink: authDestination(eventId === null ? "/app/reservations" : `/app/reservations/${eventId}`),
  };
}

export function ReservationsPage() {
  const { isLoaded, isSignedIn } = useUser();
  const [date, setDate] = useState(singaporeDate(1));
  const [startTime, setStartTime] = useState("19:30");
  const [enrollCreator, setEnrollCreator] = useState(false);
  const mutations = useReservationMutations(null);
  const { data: events, isLoading, isError, error, refetch } = useListReservationEvents({
    query: {
      queryKey: getListReservationEventsQueryKey(),
      enabled: isLoaded && isSignedIn === true,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });
  const pending = mutations.pending;
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutations.run(() => mutations.create.mutate({ data: { date, startTime, enrollCreator } }));
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-16">
      <EventTopbar />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-8 grid gap-6 border-b-4 border-ink pb-8 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 border-2 border-ink bg-secondary px-3 py-1 font-mono text-xs font-bold uppercase tracking-widest brutal-shadow-sm">
              <CalendarDays className="h-4 w-4" /> Table bookings
            </p>
            <h1 className="max-w-3xl text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">Find your next<br className="hidden sm:block" /> Friday seat.</h1>
            <p className="mt-4 max-w-2xl text-base font-semibold text-muted-foreground sm:text-lg">Four seats at the table. A fair, visible queue when it fills. Every time shown in Singapore local time.</p>
          </div>
          <div className="flex items-center gap-3 border-2 border-ink bg-tile px-4 py-3 brutal-shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center border-2 border-ink bg-primary"><Users className="h-5 w-5" strokeWidth={3} /></div>
            <div><p className="font-mono text-2xl font-bold leading-none">{events?.filter((event) => event.status === "open").length ?? "—"}</p><p className="mt-1 text-[10px] font-black uppercase tracking-widest">Open tables</p></div>
          </div>
        </div>

        {isLoaded && !isSignedIn && (
          <Notice tone="info">
            <p>Sign in to see live event availability and reserve your own seat.</p>
            <Link href={authDestination("/app/reservations")} className="mt-3 inline-flex items-center gap-2 border-2 border-ink bg-tile px-3 py-2 text-xs font-black uppercase tracking-wider text-foreground brutal-shadow-sm">
              <LogIn className="h-4 w-4" /> Sign in
            </Link>
          </Notice>
        )}
        {mutations.error && (
          <div className="mb-6">
            <Notice>
              <p>{mutations.error}</p>
              {mutations.errorStatus === 401 && <Link href={mutations.signInLink} className="mt-2 inline-block border-b-2 border-current text-sm font-black uppercase">Sign in again</Link>}
            </Notice>
          </div>
        )}
        {isError && (
          <div className="mb-6">
            <Notice>
              <p>{readableError(error)}</p>
              {(error as { status?: number })?.status === 401 && <Link href={mutations.signInLink} className="mt-2 inline-block border-b-2 border-current text-sm font-black uppercase">Sign in</Link>}
              <button type="button" onClick={() => refetch()} className="ml-3 mt-2 inline-flex items-center gap-2 border-b-2 border-current text-sm font-black uppercase"><RotateCw className="h-4 w-4" /> Try again</button>
            </Notice>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <section aria-labelledby="event-list-heading">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">The calendar</p>
                <h2 id="event-list-heading" className="mt-1 text-2xl font-black uppercase sm:text-3xl">Upcoming tables</h2>
              </div>
              <button type="button" onClick={() => refetch()} aria-label="Refresh events" className="flex h-10 w-10 items-center justify-center border-2 border-ink bg-tile brutal-shadow-sm transition-transform hover:-translate-y-0.5"><RotateCw className="h-4 w-4" /></button>
            </div>
            {!isLoaded || (isSignedIn && isLoading) ? (
              <div aria-busy="true" className="space-y-4">
                {[0, 1, 2].map((item) => <div key={item} className="h-36 animate-pulse border-2 border-ink bg-muted/60 brutal-shadow-sm" />)}
              </div>
            ) : !isSignedIn ? (
              <p className="border-l-4 border-secondary py-2 pl-3 text-sm font-semibold text-muted-foreground">Sign in to view upcoming tables and their availability.</p>
            ) : events?.length ? (
              <div className="space-y-4">
                {events.map((event) => (
                  <Link key={event.id} href={`/app/reservations/${event.id}`} className="group block" data-testid={`event-card-${event.id}`}>
                    <Card className={`overflow-hidden transition-transform group-hover:-translate-y-1 group-hover:-translate-x-1 group-hover:shadow-[8px_8px_0_hsl(var(--brutal-shadow))] ${event.status === "cancelled" ? "bg-muted" : "bg-card"}`}>
                      <CardContent className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
                        <div className="flex min-w-0 gap-4">
                          <div className={`flex h-[76px] w-[66px] shrink-0 flex-col items-center justify-center border-2 border-ink ${event.status === "cancelled" ? "bg-muted" : "bg-primary"} brutal-shadow-sm`}>
                            <span className="font-mono text-2xl font-bold leading-none">{new Intl.DateTimeFormat("en-SG", { timeZone: event.timeZone, day: "2-digit" }).format(new Date(event.startsAt))}</span>
                            <span className="mt-1 text-[10px] font-black uppercase tracking-widest">{new Intl.DateTimeFormat("en-SG", { timeZone: event.timeZone, month: "short" }).format(new Date(event.startsAt))}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-lg font-black uppercase sm:text-xl">{formatEventDate(event)}</h3>
                              <span className={`border-2 border-ink px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${event.status === "open" ? "bg-primary" : event.status === "started" ? "bg-accent" : "bg-muted"}`}>{event.status}</span>
                            </div>
                            <p className="mt-2 flex items-center gap-2 font-mono text-sm font-bold"><Clock3 className="h-4 w-4" />{event.startTime} SGT <span className="text-muted-foreground">·</span> Host: {event.creator.displayName}</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-4 border-t-2 border-ink/20 pt-3 sm:block sm:border-0 sm:pt-0 sm:text-right">
                          <div className="flex items-center gap-2 font-mono text-sm font-bold sm:justify-end"><Users className="h-4 w-4" />{event.confirmed.length}/4 seated</div>
                          <p className="mt-1 text-xs font-bold text-muted-foreground sm:text-right">{event.waiting.length} waiting</p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : !isError ? (
              <Card className="border-dashed border-4 bg-card">
                <CardContent className="flex flex-col items-center px-6 py-12 text-center">
                  <div className="mb-5 flex h-20 w-16 -rotate-3 items-center justify-center border-4 border-ink bg-tile text-3xl font-black text-destructive brutal-shadow-lg">中</div>
                  <h3 className="text-xl font-black uppercase">No tables on the calendar</h3>
                  <p className="mt-2 max-w-sm font-semibold text-muted-foreground">Start a new night and send the event link to the crew.</p>
                </CardContent>
              </Card>
            ) : null}
          </section>

          <aside className="lg:sticky lg:top-24">
            <Card className="overflow-hidden bg-secondary">
              <div className="flex items-center justify-between border-b-2 border-ink px-5 py-4">
                <div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">Make it a date</p><h2 className="text-xl font-black uppercase">Set the table</h2></div>
                <CalendarDays className="h-7 w-7" strokeWidth={3} />
              </div>
              <CardContent className="p-5">
                <form onSubmit={submit} className="space-y-4" data-testid="form-create-reservation">
                  <label className="block text-xs font-black uppercase tracking-widest">Singapore date
                    <input required type="date" min={singaporeDate()} value={date} onChange={(event) => setDate(event.target.value)} className="mt-2 h-12 w-full border-2 border-ink bg-tile px-3 font-mono text-base font-bold brutal-shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="input-event-date" />
                  </label>
                  <label className="block text-xs font-black uppercase tracking-widest">Start time · SGT
                    <input required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-2 h-12 w-full border-2 border-ink bg-tile px-3 font-mono text-base font-bold brutal-shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="input-event-time" />
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 border-2 border-ink bg-tile p-3 text-sm font-bold leading-snug">
                    <input type="checkbox" checked={enrollCreator} onChange={(event) => setEnrollCreator(event.target.checked)} className="mt-0.5 h-5 w-5 accent-[hsl(var(--primary))]" data-testid="input-enroll-creator" />
                    <span>Reserve a seat for me too <span className="block text-xs font-semibold text-muted-foreground">Optional. Leave unchecked to create the event only.</span></span>
                  </label>
                  <Button type="submit" disabled={pending || isSignedIn !== true} className="h-12 w-full border-2 text-sm font-black uppercase tracking-widest brutal-shadow-sm" data-testid="button-create-event">
                    {mutations.create.isPending ? "Creating table…" : "Create event"}
                  </Button>
                  {isLoaded && !isSignedIn && <p className="text-center text-xs font-bold">Sign in before creating a table.</p>}
                </form>
              </CardContent>
            </Card>
            <p className="mt-4 border-l-4 border-primary pl-3 text-xs font-semibold leading-relaxed text-muted-foreground">A confirmed place or waitlist position is decided by the live event service, not this page.</p>
          </aside>
        </div>
      </main>
    </div>
  );
}

function ParticipantLine({ name, label, isCaller, index }: { name: string; label: string; isCaller: boolean; index: number }) {
  return (
    <li className="flex items-center gap-3 border-b border-ink/15 py-3 last:border-0" data-testid={`participant-${label.toLowerCase()}-${index}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center border-2 border-ink font-mono text-sm font-bold ${label === "Seat" ? "bg-primary" : "bg-accent"} brutal-shadow-sm`}>{index}</span>
      <span className="min-w-0 flex-1 truncate font-bold">{name}{isCaller && <span className="ml-2 border border-ink bg-secondary px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase">You</span>}</span>
      <span className="font-mono text-[10px] font-bold uppercase text-muted-foreground">{label} {index}</span>
    </li>
  );
}

export function ReservationEventPage() {
  const params = useParams<{ eventId: string }>();
  const rawId = Number(params.eventId);
  const validId = Number.isSafeInteger(rawId) && rawId > 0;
  const eventId = validId ? rawId : 0;
  const { isLoaded, isSignedIn } = useUser();
  const mutations = useReservationMutations(validId ? eventId : null);
  const { data: event, isLoading, isError, error, refetch } = useGetReservationEvent(eventId, {
    query: {
      enabled: validId && isLoaded && isSignedIn === true,
      queryKey: getGetReservationEventQueryKey(eventId),
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const busy = mutations.pending;

  const beginEdit = () => {
    if (!event) return;
    setDate(event.date);
    setStartTime(event.startTime);
    setEditing(true);
    mutations.setError("");
  };
  const saveEdit = (submitEvent: React.FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    mutations.run(() => mutations.update.mutate({ eventId, data: { date, startTime } }));
    setEditing(false);
  };
  const view = event ? getReservationViewModel(event) : null;
  const lockReason = view?.lockReason ?? null;

  return (
    <div className="min-h-[100dvh] bg-background pb-16">
      <EventTopbar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
        <Link href="/app/reservations" className="mb-6 inline-flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest hover:underline" data-testid="link-back-events"><ArrowLeft className="h-4 w-4" /> All events</Link>
        {!validId ? (
          <Notice><p>This event link is not valid.</p></Notice>
        ) : !isLoaded || (isSignedIn && isLoading) ? (
          <div aria-busy="true" className="space-y-5">
            <div className="h-56 animate-pulse border-2 border-ink bg-muted/60" />
            <div className="grid gap-5 md:grid-cols-2"><div className="h-64 animate-pulse border-2 border-ink bg-muted/60" /><div className="h-64 animate-pulse border-2 border-ink bg-muted/60" /></div>
          </div>
        ) : !isSignedIn ? (
          <Card className="bg-card">
            <CardContent className="space-y-4 p-6 sm:p-10">
              <Notice tone="info">
                <p>Sign in to view this event and its participant list.</p>
                <Link href={authDestination(`/app/reservations/${eventId}`)} className="mt-3 inline-flex items-center gap-2 border-2 border-ink bg-tile px-3 py-2 text-xs font-black uppercase tracking-wider text-foreground brutal-shadow-sm"><LogIn className="h-4 w-4" /> Sign in to open event</Link>
              </Notice>
            </CardContent>
          </Card>
        ) : isError || !event ? (
          <Card className="bg-card">
            <CardContent className="space-y-4 p-6 sm:p-10">
              <Notice>
                <p>{readableError(error)}</p>
                {(error as { status?: number })?.status === 401 && <Link href={authDestination(`/app/reservations/${eventId}`)} className="mt-2 inline-flex items-center gap-2 border-b-2 border-current text-sm font-black uppercase"><LogIn className="h-4 w-4" /> Sign in to open event</Link>}
                {(error as { status?: number })?.status !== 401 && <button type="button" onClick={() => refetch()} className="mt-2 inline-flex items-center gap-2 border-b-2 border-current text-sm font-black uppercase"><RotateCw className="h-4 w-4" /> Try again</button>}
              </Notice>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {mutations.error && <Notice><p>{mutations.error}</p>{mutations.errorStatus === 401 && <Link href={mutations.signInLink} className="mt-2 inline-block border-b-2 border-current text-sm font-black uppercase">Sign in again</Link>}</Notice>}
            <Card className="overflow-hidden bg-card">
              <div className={`h-2 ${event.status === "open" ? "bg-primary" : event.status === "started" ? "bg-accent" : "bg-muted"}`} />
              <CardContent className="p-5 sm:p-8">
                <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      <span className={`border-2 border-ink px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-widest ${event.status === "open" ? "bg-primary" : event.status === "started" ? "bg-accent" : "bg-muted"}`}>{event.status}</span>
                      <span className="border-2 border-ink bg-tile px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-widest">{event.timeZone}</span>
                    </div>
                    <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Mahjong night · hosted by {event.creator.displayName}</p>
                    <h1 className="mt-2 max-w-3xl text-4xl font-black uppercase leading-[0.95] sm:text-6xl">{formatEventDate(event)}</h1>
                    <p className="mt-4 flex items-center gap-2 font-mono text-lg font-bold"><Clock3 className="h-5 w-5" /> {event.startTime} SGT <span className="text-muted-foreground">·</span> Four seats</p>
                  </div>
                  <div className="grid w-full grid-cols-2 border-2 border-ink bg-secondary sm:max-w-[250px]">
                    <div className="border-r-2 border-ink p-3 text-center"><p className="font-mono text-3xl font-bold">{event.confirmed.length}<span className="text-lg">/4</span></p><p className="text-[10px] font-black uppercase tracking-widest">Seated</p></div>
                    <div className="p-3 text-center"><p className="font-mono text-3xl font-bold">{event.waiting.length}</p><p className="text-[10px] font-black uppercase tracking-widest">Waiting</p></div>
                  </div>
                </div>
                {lockReason && <div className="mt-6"><Notice tone="info"><p>{lockReason}</p></Notice></div>}
                {event.callerState === "confirmed" && <p className="mt-5 inline-flex items-center gap-2 border-2 border-ink bg-primary px-3 py-2 text-sm font-black uppercase brutal-shadow-sm"><Check className="h-4 w-4" strokeWidth={3} /> Your seat is confirmed</p>}
                {event.callerState === "waiting" && <p className="mt-5 inline-flex items-center gap-2 border-2 border-ink bg-accent px-3 py-2 text-sm font-black uppercase brutal-shadow-sm"><Users className="h-4 w-4" strokeWidth={3} /> You are on the waitlist · position {view?.callerWaitPosition ?? "—"}</p>}
                {!isSignedIn && <p className="mt-5 text-sm font-bold text-muted-foreground">Sign in to reserve your own seat. Opening this link never joins you automatically.</p>}
              </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-6">
                <Card className="bg-card">
                  <div className="flex items-center justify-between border-b-2 border-ink px-5 py-4">
                    <div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Capacity four</p><h2 className="text-xl font-black uppercase">Confirmed seats</h2></div>
                    <span className="font-mono text-sm font-bold">{event.confirmed.length} / 4</span>
                  </div>
                  <CardContent className="p-5">
                    <ol className="space-y-0">
                      {[1, 2, 3, 4].map((seat) => {
                        const participant = event.confirmed.find((person) => person.seat === seat);
                        return participant ? (
                          <ParticipantLine key={participant.enrollmentId} index={seat} label="Seat" name={participant.displayName} isCaller={participant.isCaller} />
                        ) : (
                          <li key={seat} className="flex items-center gap-3 border-b border-dashed border-ink/25 py-3 last:border-0" data-testid={`seat-open-${seat}`}>
                            <span className="flex h-9 w-9 items-center justify-center border-2 border-dashed border-ink/40 font-mono text-sm font-bold text-muted-foreground">{seat}</span>
                            <span className="font-semibold text-muted-foreground">Open seat</span>
                          </li>
                        );
                      })}
                    </ol>
                  </CardContent>
                </Card>
                <Card className="bg-card">
                  <div className="flex items-center justify-between border-b-2 border-ink px-5 py-4">
                    <div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">First in, first up</p><h2 className="text-xl font-black uppercase">Waiting list</h2></div>
                    <span className="font-mono text-sm font-bold">{event.waiting.length} queued</span>
                  </div>
                  <CardContent className="p-5">
                    {event.waiting.length ? (
                      <ol>{event.waiting.map((participant) => <ParticipantLine key={participant.enrollmentId} index={participant.position} label="Wait" name={participant.displayName} isCaller={participant.isCaller} />)}</ol>
                    ) : (
                      <p className="border border-dashed border-ink/30 py-7 text-center text-sm font-semibold text-muted-foreground">No one is waiting yet.</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <aside className="space-y-5">
                <Card className="bg-secondary">
                  <div className="border-b-2 border-ink px-5 py-4"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em]">Your reservation</p><h2 className="text-xl font-black uppercase">Take your place</h2></div>
                  <CardContent className="space-y-3 p-5">
                    {view?.canJoin && <Button disabled={busy || !isSignedIn} onClick={() => mutations.run(() => mutations.join.mutate({ eventId }))} className="h-12 w-full border-2 border-ink text-sm font-black uppercase tracking-wider brutal-shadow-sm" data-testid="button-join-event">{mutations.join.isPending ? "Reserving…" : event.confirmed.length < 4 ? "Reserve a seat" : "Join the waitlist"}</Button>}
                    {view?.canLeave && <Button disabled={busy || !isSignedIn} variant="outline" onClick={() => mutations.run(() => mutations.leave.mutate({ eventId }))} className="h-12 w-full border-2 border-ink bg-tile text-sm font-black uppercase tracking-wider brutal-shadow-sm" data-testid="button-leave-event">{mutations.leave.isPending ? "Updating…" : "Leave reservation"}</Button>}
                    {!isSignedIn && <Link href={authDestination(`/app/reservations/${eventId}`)} className="flex h-12 items-center justify-center gap-2 border-2 border-ink bg-tile text-sm font-black uppercase tracking-wider brutal-shadow-sm"><LogIn className="h-4 w-4" /> Sign in to reserve</Link>}
                    {!lockReason && event.callerState === "none" && !event.allowedActions.join && <p className="text-center text-xs font-bold text-muted-foreground">A reservation is not available for your account right now.</p>}
                    {lockReason && <p className="text-center text-xs font-bold text-muted-foreground">The event is locked; no reservation changes can be made.</p>}
                    <p className="border-t-2 border-ink/20 pt-3 text-xs font-semibold leading-relaxed">Seat changes are always confirmed by the server. Your account can only change its own reservation.</p>
                  </CardContent>
                </Card>

                    {(view?.canEdit || view?.canCancel) && (
                  <Card className="bg-card">
                    <div className="border-b-2 border-ink px-5 py-4"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Creator / admin</p><h2 className="text-lg font-black uppercase">Event controls</h2></div>
                    <CardContent className="space-y-3 p-5">
                          {view?.canEdit && !editing && <Button type="button" variant="outline" onClick={beginEdit} disabled={busy} className="h-11 w-full border-2 border-ink font-black uppercase tracking-wider" data-testid="button-edit-event">Change date or time</Button>}
                          {editing && view?.canEdit && (
                        <form onSubmit={saveEdit} className="space-y-3" data-testid="form-edit-event">
                          <label className="block text-xs font-black uppercase tracking-widest">Singapore date<input required type="date" min={singaporeDate()} value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-11 w-full border-2 border-ink bg-tile px-3 font-mono font-bold" /></label>
                          <label className="block text-xs font-black uppercase tracking-widest">Start time · SGT<input required type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 h-11 w-full border-2 border-ink bg-tile px-3 font-mono font-bold" /></label>
                          <div className="flex gap-2"><Button type="submit" disabled={busy} className="flex-1 border-2 border-ink font-black uppercase">Save time</Button><Button type="button" variant="outline" onClick={() => setEditing(false)} className="border-2 border-ink font-black uppercase">Close</Button></div>
                        </form>
                      )}
                          {view?.canCancel && <Button type="button" variant="destructive" disabled={busy} onClick={() => { if (window.confirm("Cancel this Mahjong event? Participant history will remain visible, but no further seat changes will be allowed.")) mutations.run(() => mutations.cancel.mutate({ eventId })); }} className="h-11 w-full border-2 border-ink font-black uppercase tracking-wider brutal-shadow-sm" data-testid="button-cancel-event">{mutations.cancel.isPending ? "Cancelling…" : "Cancel event"}</Button>}
                    </CardContent>
                  </Card>
                )}
                <Card className="bg-tile">
                  <div className="border-b-2 border-ink px-5 py-4"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Delivery record</p><h2 className="text-lg font-black uppercase">Notifications</h2></div>
                  <CardContent className="p-5">
                    {event.notifications.length ? (
                      <ul className="space-y-3">
                        {event.notifications.map((notification) => (
                          <li key={notification.id} className="border-2 border-ink bg-background p-3" data-testid={`notification-${notification.id}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div><p className="text-sm font-black uppercase">{notification.kind}</p><p className="mt-1 font-mono text-[10px] font-bold uppercase">{notification.status} · {notification.attempts} {notification.attempts === 1 ? "attempt" : "attempts"}</p></div>
                              <span className={`border border-ink px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${notification.status === "sent" ? "bg-primary" : notification.status === "failed" ? "bg-destructive text-destructive-foreground" : "bg-secondary"}`}>{notification.status}</span>
                            </div>
                            <p className="mt-2 text-[11px] font-semibold text-muted-foreground">Created {formatCreatedAt(notification.createdAt)}</p>
                            {notification.sentAt && <p className="mt-1 text-[11px] font-semibold">Acknowledged {formatCreatedAt(notification.sentAt)}</p>}
                            {notification.failureCode && <p className="mt-1 font-mono text-[10px] font-bold uppercase text-destructive">{notification.failureCode}</p>}
                            {notification.status === "pending" && <p className="mt-2 border-l-2 border-secondary pl-2 text-[11px] font-bold">Pending delivery · not sent</p>}
                            {notification.status === "processing" && <p className="mt-2 border-l-2 border-accent pl-2 text-[11px] font-bold">Delivery is processing. No send confirmation yet.</p>}
                            {notification.canRetry && event.allowedActions.retryNotification && <Button type="button" disabled={busy} onClick={() => mutations.run(() => mutations.retry.mutate({ eventId, notificationId: notification.id }))} variant="outline" className="mt-3 h-9 w-full border-2 border-ink bg-secondary text-xs font-black uppercase tracking-wider" data-testid={`button-retry-notification-${notification.id}`}>{mutations.retry.isPending ? "Re-queueing…" : <><RotateCw className="mr-2 h-4 w-4" /> Re-queue delivery</>}</Button>}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm font-semibold text-muted-foreground">No notification records.</p>}
                  </CardContent>
                </Card>
                <p className="text-[11px] font-semibold text-muted-foreground">Event created {formatCreatedAt(event.createdAt)}. Live updates check every 30 seconds and when you return to this tab.</p>
              </aside>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
