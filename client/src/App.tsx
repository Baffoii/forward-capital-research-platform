import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import ThesisWorkspace from "@/pages/thesis-workspace";
import CompanyIntelligence from "@/pages/company-intelligence";
import SignalFeed from "@/pages/signal-feed";
import ResearchInbox from "@/pages/research-inbox";
import Watchlist from "@/pages/watchlist";
import SourceManagement from "@/pages/source-management";
import AuditLogPage from "@/pages/audit-log";
import OpportunityBoard from "@/pages/opportunity-board";

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
      <Route path="/board" component={OpportunityBoard} />
      <Route path="/audit" component={AuditLogPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
