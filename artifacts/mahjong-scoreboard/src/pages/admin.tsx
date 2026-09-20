import { Link, Redirect } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AdminListCard } from "@/components/AdminListCard";
import { TelegramBroadcastCard } from "@/components/TelegramBroadcastCard";
import { TelegramWebhookCard } from "@/components/TelegramWebhookCard";
import { useAdminStatus } from "@/hooks/use-is-admin";

export default function Admin() {
  const { isAdmin, isLoading } = useAdminStatus();

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <p className="font-black uppercase tracking-widest text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return <Redirect to="/app" />;
  }

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

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-8">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black uppercase text-foreground">
            <ShieldCheck className="size-7" strokeWidth={3} />
            Admin
          </h1>
          <p className="mt-2 font-bold text-muted-foreground">
            Admin-only tools for the group chat and site configuration.
          </p>
        </div>

        <TelegramBroadcastCard />
        <TelegramWebhookCard />
        <AdminListCard />
      </main>
    </div>
  );
}
