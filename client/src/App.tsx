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
import HandoffNew from "@/pages/handoff-new";
import Handoffs, { HandoffDetail } from "@/pages/handoffs";
import Journal, { JournalEntry } from "@/pages/journal";
import Precommitments from "@/pages/precommitments";
import DigestPage from "@/pages/digest";
import Briefing from "@/pages/briefing";
import ResearchQueue from "@/pages/research-queue";

function AppRouter() {
  return (
    <Switch>
      {/* The briefing is the landing view: this app is opened after a gap,
          and "where did I leave off" beats "here is everything". */}
      <Route path="/" component={Briefing} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/thesis" component={ThesisWorkspace} />
      <Route path="/companies/:id" component={CompanyIntelligence} />
      <Route path="/signals" component={SignalFeed} />
      <Route path="/inbox" component={ResearchInbox} />
      <Route path="/watchlist" component={Watchlist} />
      <Route path="/sources" component={SourceManagement} />
      <Route path="/audit" component={AuditLogPage} />
      {/* Short route on purpose — this gets typed on a phone between classes,
          and it opens straight into the textarea with nothing in the way. */}
      <Route path="/h" component={HandoffNew} />
      <Route path="/handoffs" component={Handoffs} />
      <Route path="/handoffs/:id" component={HandoffDetail} />
      <Route path="/journal" component={Journal} />
      <Route path="/journal/:id" component={JournalEntry} />
      <Route path="/precommitments" component={Precommitments} />
      <Route path="/digest" component={DigestPage} />
      <Route path="/queue" component={ResearchQueue} />
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
