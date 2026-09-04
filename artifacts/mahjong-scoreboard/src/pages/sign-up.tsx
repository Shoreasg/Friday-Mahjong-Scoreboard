import { SignUp } from "@clerk/react";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function SignUpPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8 relative overflow-hidden">
      <div className="absolute right-5 top-5 z-20 sm:right-8 sm:top-8">
        <ThemeToggle />
      </div>
      {/* Decorative neo-brutalist background */}
      <div className="absolute top-20 right-20 w-32 h-32 bg-accent border-4 border-ink rounded-full brutal-shadow-lg -z-10" />
      <div className="absolute bottom-20 left-20 w-40 h-40 bg-primary border-4 border-ink -rotate-6 brutal-shadow-lg -z-10" />

      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}