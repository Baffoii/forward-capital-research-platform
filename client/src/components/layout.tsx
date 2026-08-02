import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  FlaskConical,
  Building2,
  Rss,
  Inbox,
  ListChecks,
  Database,
  ShieldCheck,
  Send,
  NotebookPen,
  Target,
  Newspaper,
  Compass,
  Timer,
  Menu,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/", label: "Where You Left Off", icon: Compass, testId: "briefing" },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testId: "dashboard" },
  { href: "/thesis", label: "Thesis Workspace", icon: FlaskConical, testId: "thesis" },
  { href: "/signals", label: "Signal Feed", icon: Rss, testId: "signals" },
  { href: "/inbox", label: "Research Inbox", icon: Inbox, testId: "inbox" },
  { href: "/handoffs", label: "Handoffs", icon: Send, testId: "handoffs" },
  { href: "/journal", label: "Decision Journal", icon: NotebookPen, testId: "journal" },
  { href: "/precommitments", label: "Decided in Advance", icon: Target, testId: "precommitments" },
  { href: "/digest", label: "This Week", icon: Newspaper, testId: "digest" },
  { href: "/queue", label: "What's Worth an Hour", icon: Timer, testId: "queue" },
  { href: "/watchlist", label: "Watchlist", icon: ListChecks, testId: "watchlist" },
  { href: "/sources", label: "Source Management", icon: Database, testId: "sources" },
  { href: "/audit", label: "Compliance & Audit Log", icon: ShieldCheck, testId: "audit" },
];

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-label="Forward Capital logo">
      <rect x="2" y="2" width="28" height="28" rx="6" className="fill-sidebar-primary" />
      <path
        d="M9 22V10h11M9 16h8"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-sidebar"
      />
      <path
        d="M22 9l4 4-4 4"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-sidebar-primary-foreground"
      />
    </svg>
  );
}

function NavContent() {
  const [location] = useLocation();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-5">
        <Logo />
        <div>
          <div className="font-sans text-sm font-semibold leading-tight text-sidebar-foreground" data-testid="text-app-name">
            Forward Capital
          </div>
          <div className="text-[11px] leading-tight text-sidebar-foreground/60">Research Platform</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {NAV_ITEMS.map((item) => {
          const active = location === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <a
                data-testid={`link-nav-${item.testId}`}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </a>
            </Link>
          );
        })}
      </nav>
      <SignedInAs />
      <div className="border-t border-sidebar-border px-4 py-3 text-[11px] leading-snug text-sidebar-foreground/50">
        Not a stock-tip generator. Not trade-execution software. Evidence-weighing tool only.
      </div>
    </div>
  );
}

function SignedInAs() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-sidebar-border px-4 py-3">
      <span
        className="truncate text-xs text-sidebar-foreground/70"
        title={user.email}
        data-testid="text-signed-in-as"
      >
        {user.name}
      </span>
      <button
        onClick={signOut}
        className="shrink-0 text-xs text-sidebar-foreground/50 underline-offset-2 hover:text-sidebar-foreground hover:underline"
        data-testid="button-sign-out"
      >
        Sign out
      </button>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
        <NavContent />
      </aside>
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="button-open-nav">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-60 bg-sidebar p-0">
              <NavContent />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <Logo />
            <span className="text-sm font-semibold">Forward Capital</span>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
