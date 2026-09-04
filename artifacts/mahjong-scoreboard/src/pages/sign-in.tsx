import { SignIn } from "@clerk/react";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function SignInPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8 relative overflow-hidden">
      <div className="absolute right-5 top-5 z-20 sm:right-8 sm:top-8">
        <ThemeToggle />
      </div>
      {/* Decorative neo-brutalist background */}
      <div className="absolute top-20 left-20 w-32 h-32 bg-secondary border-4 border-ink rounded-full brutal-shadow-lg -z-10" />
      <div className="absolute bottom-20 right-20 w-40 h-40 bg-primary border-4 border-ink rotate-12 brutal-shadow-lg -z-10" />
      <div className="absolute top-1/4 right-1/4 w-20 h-20 bg-destructive border-4 border-ink rotate-45 shadow-[6px_6px_0_hsl(var(--brutal-shadow))] -z-10" />

      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}