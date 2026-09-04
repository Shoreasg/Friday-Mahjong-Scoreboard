import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background relative overflow-hidden">
      {/* Decorative neo-brutalist elements */}
      <div className="absolute top-10 left-10 w-24 h-24 sm:w-32 sm:h-32 bg-secondary border-4 border-black rounded-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -z-10 animate-bounce" style={{ animationDuration: '3s' }} />
      <div className="absolute bottom-32 right-10 w-32 h-32 sm:w-48 sm:h-48 bg-primary border-4 border-black rotate-12 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -z-10" />
      <div className="absolute top-1/4 right-20 w-16 h-16 bg-destructive border-4 border-black rotate-45 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -z-10" />
      <div className="absolute bottom-20 left-1/4 w-20 h-20 bg-accent border-4 border-black -rotate-12 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] -z-10" />
      
      <main className="flex-1 flex flex-col items-center justify-center px-6 relative z-10 text-center py-20 max-w-4xl mx-auto w-full">
        
        {/* Logo Mark */}
        <div className="mb-12 w-32 h-40 bg-white border-4 border-black rounded-md shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] relative flex flex-col items-center justify-center transform -rotate-6 hover:rotate-0 transition-transform duration-300 group">
          <div className="w-16 h-16 rounded-full bg-destructive border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform" />
          <div className="absolute bottom-4 font-sans font-black text-black text-4xl">中</div>
        </div>

        <h1 className="text-6xl sm:text-7xl md:text-8xl font-sans text-black font-black tracking-tight mb-8 uppercase" style={{ textShadow: '6px 6px 0px #00e599' }}>
          The <span className="bg-primary text-black px-4 py-1 border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] rotate-3 inline-block mx-2" style={{ textShadow: 'none' }}>Friday</span> Ritual
        </h1>
        
        <p className="text-xl sm:text-2xl text-black font-bold max-w-2xl mb-14 leading-relaxed bg-white border-4 border-black p-6 sm:p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -rotate-1">
          The felt is ready. The tiles are shuffled. Keep track of the weekly Mahjong battles, track the winners, and build the legacy of your group.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-6 w-full sm:w-auto">
          <Link href="/app" className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto text-xl h-16 px-10 border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]" data-testid="link-sign-in">
              ENTER SCOREBOARD
            </Button>
          </Link>
          <Link href="/sign-in" className="w-full sm:w-auto">
            <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-16 px-10 border-4 border-black bg-secondary shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
              ADMIN SIGN IN
            </Button>
          </Link>
        </div>
      </main>

      <footer className="py-8 text-center text-black font-black text-sm sm:text-base tracking-widest z-10 relative bg-white border-t-4 border-black flex justify-center items-center">
        <span>A DEDICATED SCOREBOARD FOR THE FRIDAY NIGHT CREW.</span>
      </footer>
    </div>
  );
}