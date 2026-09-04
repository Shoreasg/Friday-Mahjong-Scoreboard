import { useEffect, useRef } from "react";
import { ClerkProvider, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark as clerkDark, shadcn } from "@clerk/themes";
import { ThemeProvider, useTheme } from "next-themes";
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

function getClerkAppearance(isDark: boolean) {
  return {
  theme: isDark ? [clerkDark, shadcn] : shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(154, 100%, 45%)",
    colorForeground: isDark ? "hsl(48, 100%, 96%)" : "hsl(0, 0%, 0%)",
    colorMutedForeground: isDark ? "hsl(220, 12%, 75%)" : "hsl(0, 0%, 25%)",
    colorDanger: "hsl(0, 100%, 60%)",
    colorBackground: isDark ? "hsl(225, 20%, 16%)" : "hsl(0, 0%, 100%)",
    colorInput: isDark ? "hsl(225, 20%, 16%)" : "hsl(0, 0%, 100%)",
    colorInputForeground: isDark ? "hsl(48, 100%, 96%)" : "hsl(0, 0%, 0%)",
    colorNeutral: isDark ? "hsl(48, 100%, 96%)" : "hsl(0, 0%, 0%)",
    fontFamily: "Bricolage Grotesque, sans-serif",
    borderRadius: "4px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card text-card-foreground rounded-md w-[440px] max-w-full overflow-hidden brutal-shadow-lg border-2 border-ink",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-sans text-3xl text-foreground font-black uppercase tracking-tight",
    headerSubtitle: "text-muted-foreground font-medium text-lg",
    socialButtonsBlockButtonText: "font-bold text-foreground uppercase tracking-wide",
    formFieldLabel: "font-bold text-foreground uppercase text-xs tracking-wide",
    footerActionLink: "text-foreground font-black border-b-2 border-primary hover:bg-primary/20 uppercase text-sm",
    footerActionText: "text-muted-foreground font-bold",
    dividerText: "text-foreground font-black uppercase text-xs tracking-widest",
    identityPreviewEditButton: "text-foreground hover:text-primary",
    formFieldSuccessText: "text-primary font-bold",
    alertText: "text-destructive-foreground font-bold",
    logoBox: "mb-6 justify-center hidden", // hide the default logo since we use custom ones mostly
    logoImage: "h-16 w-auto",
    socialButtonsBlockButton: "border-2 border-ink hover:-translate-y-[2px] hover:-translate-x-[2px] hover:brutal-shadow active:translate-y-0 active:translate-x-0 active:shadow-none transition-all bg-tile text-foreground rounded-md h-12",
    formButtonPrimary: "bg-primary border-2 border-ink brutal-shadow hover:-translate-y-[2px] hover:-translate-x-[2px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none text-black rounded-md h-12 text-base font-black transition-all uppercase tracking-widest",
    formFieldInput: "flex h-12 w-full rounded-md border-2 border-ink bg-tile text-foreground px-4 py-2 text-sm brutal-shadow transition-all font-bold placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:translate-x-[4px] focus-visible:translate-y-[4px] focus-visible:shadow-none",
    footerAction: "bg-muted py-6 px-4 -mx-8 -mb-8 mt-8 border-t-2 border-ink",
    dividerLine: "bg-ink h-0.5",
    alert: "border-2 border-ink bg-destructive text-destructive-foreground brutal-shadow rounded-md",
    otpCodeFieldInput: "border-2 border-ink rounded-md font-mono text-xl",
    formFieldRow: "gap-5",
    main: "px-8 pt-10",
  },
  };
}

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
  const { resolvedTheme } = useTheme();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={getClerkAppearance(resolvedTheme === "dark")}
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
              <div className="absolute top-1/4 left-1/4 w-24 h-24 bg-destructive border-4 border-ink rotate-45 brutal-shadow-lg -z-10" />
              <div className="absolute bottom-1/4 right-1/3 w-32 h-32 bg-secondary border-4 border-ink rounded-full brutal-shadow-lg -z-10 animate-pulse" style={{ animationDuration: '4s' }} />

              <h1 className="text-8xl sm:text-9xl font-sans font-black text-foreground mb-4 [text-shadow:6px_6px_0_hsl(var(--primary))]">404</h1>
              <p className="text-xl sm:text-2xl font-bold text-foreground mb-10 bg-tile border-4 border-ink p-4 sm:px-8 brutal-shadow-lg -rotate-1">This tile cannot be found.</p>

              <Button onClick={() => setLocation("/")} className="text-lg h-16 px-10 border-4 shadow-[6px_6px_0_hsl(var(--brutal-shadow))]">
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
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="mahjong-theme">
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
        <Toaster />
      </WouterRouter>
    </ThemeProvider>
  );
}