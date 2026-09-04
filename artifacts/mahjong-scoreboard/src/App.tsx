import { useEffect, useRef } from "react";
import { ClerkProvider, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Home from "./pages/home";
import Dashboard from "./pages/dashboard";
import SignInPage from "./pages/sign-in";
import SignUpPage from "./pages/sign-up";
import { Button } from "@/components/ui/button";

// Ensure Clerk key is available
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(154, 100%, 45%)",
    colorForeground: "hsl(0, 0%, 0%)",
    colorMutedForeground: "hsl(0, 0%, 25%)",
    colorDanger: "hsl(0, 100%, 60%)",
    colorBackground: "hsl(0, 0%, 100%)",
    colorInput: "hsl(0, 0%, 100%)",
    colorInputForeground: "hsl(0, 0%, 0%)",
    colorNeutral: "hsl(0, 0%, 0%)",
    fontFamily: "Bricolage Grotesque, sans-serif",
    borderRadius: "4px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-md w-[440px] max-w-full overflow-hidden shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] border-2 border-black",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-sans text-3xl text-black font-black uppercase tracking-tight",
    headerSubtitle: "text-muted-foreground font-medium text-lg",
    socialButtonsBlockButtonText: "font-bold text-black uppercase tracking-wide",
    formFieldLabel: "font-bold text-black uppercase text-xs tracking-wide",
    footerActionLink: "text-black font-black border-b-2 border-primary hover:bg-primary/20 uppercase text-sm",
    footerActionText: "text-muted-foreground font-bold",
    dividerText: "text-black font-black uppercase text-xs tracking-widest",
    identityPreviewEditButton: "text-black hover:text-primary",
    formFieldSuccessText: "text-primary font-bold",
    alertText: "text-black font-bold",
    logoBox: "mb-6 justify-center hidden", // hide the default logo since we use custom ones mostly
    logoImage: "h-16 w-auto",
    socialButtonsBlockButton: "border-2 border-black hover:-translate-y-[2px] hover:-translate-x-[2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-y-0 active:translate-x-0 active:shadow-none transition-all bg-white rounded-md h-12",
    formButtonPrimary: "bg-primary border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-[2px] hover:-translate-x-[2px] hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none text-black rounded-md h-12 text-base font-black transition-all uppercase tracking-widest",
    formFieldInput: "flex h-12 w-full rounded-md border-2 border-black bg-white px-4 py-2 text-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all font-bold placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:translate-x-[4px] focus-visible:translate-y-[4px] focus-visible:shadow-none",
    footerAction: "bg-muted py-6 px-4 -mx-8 -mb-8 mt-8 border-t-2 border-black",
    dividerLine: "bg-black h-0.5",
    alert: "border-2 border-black bg-destructive text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-md",
    otpCodeFieldInput: "border-2 border-black rounded-md font-mono text-xl",
    formFieldRow: "gap-5",
    main: "px-8 pt-10",
  },
};

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/app" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClientHook = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClientHook.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClientHook]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "WELCOME BACK",
            subtitle: "Enter the Mahjong parlor",
          },
        },
        signUp: {
          start: {
            title: "JOIN THE TABLE",
            subtitle: "Create your player account",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/app" component={Dashboard} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route>
            <div className="min-h-screen flex items-center justify-center flex-col text-center px-4 relative overflow-hidden bg-background">
              <div className="absolute top-1/4 left-1/4 w-24 h-24 bg-destructive border-4 border-black rotate-45 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -z-10" />
              <div className="absolute bottom-1/4 right-1/3 w-32 h-32 bg-secondary border-4 border-black rounded-full shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -z-10 animate-pulse" style={{ animationDuration: '4s' }} />

              <h1 className="text-8xl sm:text-9xl font-sans font-black text-black mb-4 drop-shadow-[6px_6px_0px_#00E599]">404</h1>
              <p className="text-xl sm:text-2xl font-bold text-black mb-10 bg-white border-4 border-black p-4 sm:px-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -rotate-1">This tile cannot be found.</p>

              <Button onClick={() => setLocation("/")} className="text-lg h-16 px-10 border-4 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                RETURN TO TABLE
              </Button>
            </div>
          </Route>
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
      <Toaster />
    </WouterRouter>
  );
}