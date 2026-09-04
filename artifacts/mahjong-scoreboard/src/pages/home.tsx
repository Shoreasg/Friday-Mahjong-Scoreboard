import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background relative overflow-hidden">
      <div className="absolute right-5 top-5 z-20 sm:right-8 sm:top-8">
        <ThemeToggle />
      </div>
      {/* Decorative neo-brutalist elements */}
      <div className="absolute top-10 left-10 w-24 h-24 sm:w-32 sm:h-32 bg-secondary border-4 border-ink rounded-full brutal-shadow-lg -z-10 animate-bounce" style={{ animationDuration: '3s' }} />
      <div className="absolute bottom-32 right-10 w-32 h-32 sm:w-48 sm:h-48 bg-primary border-4 border-ink rotate-12 brutal-shadow-lg -z-10" />
      <div className="absolute top-1/4 right-20 w-16 h-16 bg-destructive border-4 border-ink rotate-45 brutal-shadow -z-10" />
      <div className="absolute bottom-20 left-1/4 w-20 h-20 bg-accent border-4 border-ink -rotate-12 shadow-[6px_6px_0_hsl(var(--brutal-shadow))] -z-10" />
      
      <main className="flex-1 flex flex-col items-center justify-center px-6 relative z-10 text-center py-20 max-w-4xl mx-auto w-full">
        
        {/* Logo Mark */}
        <div className="mb-12 w-32 h-40 bg-tile border-4 border-ink rounded-md brutal-shadow-xl relative flex flex-col items-center justify-center transform -rotate-6 hover:rotate-0 transition-transform duration-300 group">
          <div className="w-16 h-16 rounded-full bg-destructive border-4 border-ink brutal-shadow flex items-center justify-center mb-6 group-hover:scale-110 transition-transform" />
          <div className="absolute bottom-4 font-sans font-black text-foreground text-4xl">中</div>
        </div>

        <h1 className="text-6xl sm:text-7xl md:text-8xl font-sans text-foreground font-black tracking-tight mb-8 uppercase [text-shadow:6px_6px_0_hsl(var(--primary))]">
          The <span className="bg-primary text-primary-foreground px-4 py-1 border-4 border-ink shadow-[6px_6px_0_hsl(var(--brutal-shadow))] rotate-3 inline-block mx-2 [text-shadow:none]">Friday</span> Ritual
        </h1>
        
        <p className="text-xl sm:text-2xl text-foreground font-bold max-w-2xl mb-14 leading-relaxed bg-tile border-4 border-ink p-6 sm:p-8 brutal-shadow-lg -rotate-1">
          The felt is ready. The tiles are shuffled. Keep track of the weekly Mahjong battles, track the winners, and build the legacy of your group.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-6 w-full sm:w-auto">
          <Link href="/app" className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto text-xl h-16 px-10 border-4 shadow-[6px_6px_0_hsl(var(--brutal-shadow))]" data-testid="link-sign-in">
              ENTER SCOREBOARD
            </Button>
          </Link>
          <Link href="/sign-in" className="w-full sm:w-auto">
            <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-16 px-10 border-4 bg-secondary text-secondary-foreground shadow-[6px_6px_0_hsl(var(--brutal-shadow))]">
              ADMIN SIGN IN
            </Button>
          </Link>
        </div>
      </main>

      <footer className="py-8 px-16 text-center text-foreground font-black text-sm sm:text-base tracking-widest z-10 relative bg-tile border-t-4 border-ink flex justify-center items-center">
        <span>A DEDICATED SCOREBOARD FOR THE FRIDAY NIGHT CREW.</span>
      </footer>
    </div>
  );
}