import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Home() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 inset-x-0 h-64 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
      
      <main className="flex-1 flex flex-col items-center justify-center px-6 relative z-10 text-center py-20">
        
        {/* Logo Mark */}
        <div className="mb-8 w-24 h-32 bg-primary rounded-xl shadow-lg relative flex items-center justify-center transform -rotate-6 hover:rotate-0 transition-transform duration-500">
          <div className="absolute inset-2 bg-card rounded-lg flex items-center justify-center shadow-inner">
            <div className="w-10 h-10 rounded-full bg-destructive flex items-center justify-center" />
            <div className="absolute bottom-4 font-serif font-bold text-primary text-xl">中</div>
          </div>
        </div>

        <h1 className="text-4xl sm:text-6xl font-serif text-foreground font-bold tracking-tight mb-6">
          The <span className="text-primary italic">Friday</span> Ritual
        </h1>
        
        <p className="text-lg sm:text-xl text-muted-foreground max-w-lg mb-10 leading-relaxed">
          The felt is ready. The tiles are shuffled. Keep track of the weekly Mahjong battles, track the winners, and build the legacy of your group.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
          <Link href="/sign-in" className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8" data-testid="link-sign-in">
              Enter the Parlor
            </Button>
          </Link>
        </div>
      </main>

      <footer className="py-6 text-center text-muted-foreground text-sm z-10 relative">
        <p>A dedicated scoreboard for the Friday night crew.</p>
      </footer>
    </div>
  );
}
