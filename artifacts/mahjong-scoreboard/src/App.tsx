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
    colorPrimary: "hsl(150, 73%, 22%)",
    colorForeground: "hsl(150, 40%, 15%)",
    colorMutedForeground: "hsl(150, 20%, 40%)",
    colorDanger: "hsl(5, 80%, 55%)",
    colorBackground: "hsl(40, 30%, 99%)",
    colorInput: "hsl(40, 30%, 99%)",
    colorInputForeground: "hsl(150, 40%, 15%)",
    colorNeutral: "hsl(40, 20%, 86%)",
    fontFamily: "Outfit, sans-serif",
    borderRadius: "1rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border border-card-border",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-serif text-2xl text-foreground font-semibold",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "font-medium text-foreground",
    formFieldLabel: "font-semibold text-foreground",
    footerActionLink: "text-primary font-medium hover:underline",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground font-medium",
    identityPreviewEditButton: "text-primary hover:text-primary/80",
    formFieldSuccessText: "text-primary",
    alertText: "text-destructive font-medium",
    logoBox: "mb-2 justify-center",
    logoImage: "h-16 w-auto",
    socialButtonsBlockButton: "border-border hover:bg-muted/50 rounded-xl h-12",
    formButtonPrimary: "bg-primary hover:bg-primary/90 text-primary-foreground rounded-full h-12 text-base font-semibold transition-all active:scale-[0.98]",
    formFieldInput: "flex h-12 w-full rounded-xl border border-input bg-card px-4 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
    footerAction: "bg-muted py-6 px-4 -mx-8 -mb-8 mt-6 border-t border-border",
    dividerLine: "bg-border",
    alert: "border-destructive/20 bg-destructive/5 text-destructive",
    otpCodeFieldInput: "border-border rounded-lg",
    formFieldRow: "gap-4",
    main: "px-8 pt-8",
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

function AppRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Dashboard />
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
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
            title: "Welcome back",
            subtitle: "Enter the Mahjong parlor",
          },
        },
        signUp: {
          start: {
            title: "Join the Table",
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
          <Route path="/app" component={AppRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route>
            <div className="min-h-screen flex items-center justify-center flex-col text-center px-4">
              <h1 className="text-4xl font-serif text-primary mb-2">404</h1>
              <p className="text-muted-foreground mb-6">This tile cannot be found.</p>
              <Button onClick={() => setLocation("/")}>Return to Table</Button>
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
