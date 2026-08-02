import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider, useAuth } from "@/lib/auth";
import SignIn from "@/pages/sign-in";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import ThesisWorkspace from "@/pages/thesis-workspace";
import CompanyIntelligence from "@/pages/company-intelligence";
import SignalFeed from "@/pages/signal-feed";
import ResearchInbox from "@/pages/research-inbox";
import Watchlist from "@/pages/watchlist";
import SourceManagement from "@/pages/source-management";
import AuditLogPage from "@/pages/audit-log";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/thesis" component={ThesisWorkspace} />
      <Route path="/companies/:id" component={CompanyIntelligence} />
      <Route path="/signals" component={SignalFeed} />
      <Route path="/inbox" component={ResearchInbox} />
      <Route path="/watchlist" component={Watchlist} />
      <Route path="/sources" component={SourceManagement} />
      <Route path="/audit" component={AuditLogPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * Nothing renders until we know who's here. There is no partially-signed-in
 * state and no public page — every view in this app is either about our
 * positions or about our own behaviour.
 */
function Gate() {
  const { state } = useAuth();

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Checking your sign-in…
      </div>
    );
  }

  if (state.status !== "signed-in") return <SignIn />;

  return (
    <Router hook={useHashLocation}>
      <AppRouter />
    </Router>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Gate />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
