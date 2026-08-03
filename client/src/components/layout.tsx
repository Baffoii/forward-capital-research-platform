import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Menu } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SectionLabel } from "@/components/kit";
import { cn } from "@/lib/utils";
import type { ResearchInboxItem, Signal, WatchlistItem } from "@shared/schema";

// The nav is numbered and split into the two things this app does: hold a
// thesis to account, and take evidence in. Order is the reading order of the
// briefing — verdict first, provenance last.
const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ href: string; label: string; testId: string; count?: "signals" | "watchlist" | "inbox" }>;
}> = [
  {
    label: "Thesis",
    items: [
      { href: "/", label: "Briefing", testId: "dashboard" },
      { href: "/thesis", label: "Thesis Workspace", testId: "thesis" },
      { href: "/signals", label: "Signal Feed", testId: "signals", count: "signals" },
      { href: "/watchlist", label: "Watchlist", testId: "watchlist", count: "watchlist" },
    ],
  },
  {
    label: "Intake",
    items: [
      { href: "/inbox", label: "Research Inbox", testId: "inbox", count: "inbox" },
      { href: "/sources", label: "Sources", testId: "sources" },
      { href: "/audit", label: "Compliance & Audit", testId: "audit" },
    ],
  },
];

export interface SubNavItem {
  /** The nav href this sits beneath. */
  under: string;
  label: string;
}

function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-label="Forward Capital logo">
      <rect x="2" y="2" width="28" height="28" rx="6" fill="var(--fc-teal)" />
      <path
        d="M9 22V10h11M9 16h8"
        stroke="var(--fc-teal-ink)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M22 9l4 4-4 4" stroke="#faf9f6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CountBadge({ value, tone }: { value: number; tone: "neutral" | "attention" }) {
  return (
    <span
      className={cn(
        "ml-auto rounded px-[5px] py-[3px] font-mono text-[10px] font-semibold leading-none",
        tone === "attention" ? "bg-fc-ochre text-white" : "bg-fc-rule text-fc-ink-2"
      )}
    >
      {value}
    </span>
  );
}

function NavContent({ subNav, onNavigate }: { subNav?: SubNavItem; onNavigate?: () => void }) {
  const [location] = useLocation();

  // Counts are the same cached queries the pages use, so this costs one fetch
  // each on first load and nothing after.
  const { data: signals } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });
  const { data: watchlist } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });
  const { data: inbox } = useQuery<ResearchInboxItem[]>({ queryKey: ["/api/inbox"] });

  const pendingInbox = inbox?.filter((i) => i.status === "pending").length ?? 0;
  const counts = {
    signals: signals?.length ?? 0,
    watchlist: watchlist?.length ?? 0,
    inbox: pendingInbox,
  };

  let index = 0;

  return (
    <div className="flex h-full flex-col bg-fc-paper-sunk">
      <div className="flex items-center gap-2.5 px-[18px] pb-5 pt-5">
        <Logo />
        <div>
          <div className="font-display text-[13px] font-semibold leading-tight text-fc-ink" data-testid="text-app-name">
            Forward Capital
          </div>
          <div className="text-[10.5px] leading-tight text-fc-ink-2">Research Platform</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <SectionLabel className="px-[18px] pb-2.5 pt-2">{group.label}</SectionLabel>
            <div className="flex flex-col gap-0.5 px-2.5 pb-3">
              {group.items.map((item) => {
                index += 1;
                const active = location === item.href;
                const count = item.count ? counts[item.count] : undefined;
                const showSub = subNav?.under === item.href;
                return (
                  <div key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      data-testid={`link-nav-${item.testId}`}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-[11px] py-2 text-[13px] leading-none transition-colors",
                        active
                          ? "bg-fc-teal-wash font-display font-semibold text-fc-teal-deep"
                          : "text-fc-ink-2 hover:bg-fc-chip"
                      )}
                    >
                      <span className={cn("font-mono text-[11px] font-semibold", active ? "opacity-70" : "opacity-40")}>
                        {String(index).padStart(2, "0")}
                      </span>
                      <span className="truncate">{item.label}</span>
                      {count != null && count > 0 && (
                        <CountBadge value={count} tone={item.count === "inbox" ? "attention" : "neutral"} />
                      )}
                    </Link>
                    {showSub && (
                      <div
                        className="truncate py-2 pl-[26px] pr-[11px] text-[12.5px] leading-none text-fc-teal"
                        data-testid="text-nav-subitem"
                      >
                        ↳ {subNav.label}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Standing guardrail. Present on every screen, never behind a click. */}
      <div className="m-3 rounded-lg border border-fc-rule bg-fc-chip p-3">
        <SectionLabel className="mb-[7px]">Guardrails</SectionLabel>
        <p className="text-[11px] leading-[1.55] text-fc-ink-2" data-testid="text-guardrails">
          Evidence-weighing tool only. Not a stock-tip generator. No trade execution path exists in this app.
        </p>
      </div>
    </div>
  );
}

export function AppLayout({ children, subNav }: { children: ReactNode; subNav?: SubNavItem }) {
  return (
    <div className="flex min-h-screen w-full bg-fc-paper text-fc-ink">
      <aside className="hidden w-[232px] shrink-0 border-r border-fc-rule md:block">
        <div className="sticky top-0 h-screen">
          <NavContent subNav={subNav} />
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-fc-rule bg-fc-surface px-4 py-3 md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                className="rounded-md border border-fc-rule-strong p-1.5 text-fc-ink"
                data-testid="button-open-nav"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[232px] border-fc-rule bg-fc-paper-sunk p-0">
              <NavContent subNav={subNav} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-display text-sm font-semibold">Forward Capital</span>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
