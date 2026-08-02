/**
 * Writing a handoff. Route: /h — short on purpose, so it's fast to type or
 * bookmark on a phone.
 *
 * This page has to work in under ten seconds from a locked phone between
 * classes. That constraint drives everything about it:
 *
 *   - No app chrome, no sidebar, no navigation to get through.
 *   - The textarea is focused on load. You open the page and start typing.
 *   - ONE input. Not a form with labelled fields for ticker, findings, open
 *     questions and sources — that would not get filled in, and the team would
 *     go back to texting each other. Sorting happens afterwards.
 *   - Assigning is one tap on a name, and it's optional.
 *
 * The sorted version appears after saving and is editable there, because it
 * will sometimes be wrong.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { TEAM_EMAILS, shortName } from "@shared/team";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function HandoffNew() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Straight into typing. The whole point of a dedicated route.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const teammates = TEAM_EMAILS.filter((email) => email !== user?.email);

  async function save() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/handoffs", {
        rawText: text,
        assigneeEmail: assignee,
      });
      const { packet } = await res.json();
      navigate(`/handoffs/${packet.id}`);
    } catch (err: any) {
      setError(err?.message ?? "Couldn't save that. Try again.");
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background p-4 text-foreground">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-base font-semibold">Hand something over</h1>
          <button
            onClick={() => navigate("/handoffs")}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            data-testid="link-handoff-list"
          >
            See all
          </button>
        </div>

        <p className="text-xs leading-snug text-muted-foreground">
          Write it however it comes out. We'll sort it into what you found, what's
          still open and what they need to decide — and you can fix that afterwards.
        </p>

        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter to send, same as every messaging app they already use.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
          }}
          placeholder="ok so VRT backlog came in at 1.95bn vs 2.4 last q, margin flat which is the bit that bugs me. their 10-Q p.14. haven't checked whether the contracts have escalators — that's the thing that decides whether we keep it. can you look?"
          className="min-h-[45vh] flex-1 resize-none text-base leading-relaxed"
          data-testid="input-handoff-raw"
        />

        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            Who's it for? (optional — leave it and anyone can pick it up)
          </div>
          <div className="flex flex-wrap gap-2">
            {teammates.map((email) => (
              <button
                key={email}
                onClick={() => setAssignee(assignee === email ? null : email)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  assignee === email
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/40"
                }`}
                data-testid={`button-assign-${shortName(email)}`}
              >
                {shortName(email)}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" data-testid="text-handoff-error">
            {error}
          </p>
        )}

        <Button
          onClick={save}
          disabled={!text.trim() || saving}
          size="lg"
          className="h-12 w-full text-base"
          data-testid="button-save-handoff"
        >
          {saving ? "Sending…" : assignee ? `Send to ${shortName(assignee)}` : "Send"}
        </Button>

        <p className="pb-2 text-center text-[11px] leading-snug text-muted-foreground">
          If nobody says they've got it within 48 hours, everyone gets told.
        </p>
      </div>
    </div>
  );
}
