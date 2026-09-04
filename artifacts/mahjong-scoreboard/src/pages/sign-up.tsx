import { SignUp } from "@clerk/react";

export default function SignUpPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8 relative overflow-hidden">
      {/* Decorative neo-brutalist background */}
      <div className="absolute top-20 right-20 w-32 h-32 bg-accent border-4 border-black rounded-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -z-10" />
      <div className="absolute bottom-20 left-20 w-40 h-40 bg-primary border-4 border-black -rotate-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -z-10" />

      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}