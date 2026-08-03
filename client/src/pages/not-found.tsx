import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-fc-paper p-6">
      <div className="w-full max-w-md rounded-lg border border-fc-rule bg-fc-surface p-6">
        <div className="mb-3 flex items-center gap-2">
          <AlertCircle className="h-6 w-6 text-fc-oxide" />
          <h1 className="font-display text-lg font-semibold text-fc-ink">404 — page not found</h1>
        </div>
        <p className="text-[13px] leading-relaxed text-fc-ink-3">
          That route isn't part of the research platform. Head back to the briefing to pick up the thesis.
        </p>
        <a
          href="#/"
          className="mt-4 inline-block rounded-md bg-fc-teal px-4 py-2 font-display text-[12.5px] font-semibold text-white"
          data-testid="link-back-to-briefing"
        >
          Back to briefing
        </a>
      </div>
    </div>
  );
}
