import { SignIn } from "@clerk/react";

export default function SignInPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8 relative overflow-hidden">
      {/* Decorative neo-brutalist background */}
      <div className="absolute top-20 left-20 w-32 h-32 bg-secondary border-4 border-black rounded-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -z-10" />
      <div className="absolute bottom-20 right-20 w-40 h-40 bg-primary border-4 border-black rotate-12 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -z-10" />
      <div className="absolute top-1/4 right-1/4 w-20 h-20 bg-destructive border-4 border-black rotate-45 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] -z-10" />

      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}