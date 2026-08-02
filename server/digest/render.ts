/**
 * Turning a digest into the email people actually read.
 *
 * Split out of ./build.ts, which imports the database and therefore can't be
 * unit tested on bare node. That split matters more than it looks: the first
 * real bug in this feature was a wording bug — an empty week reported as
 * "nothing at all was recorded" when seventy-one events existed and simply
 * weren't from this week. It read as a broken pipeline. Copy is behaviour, and
 * behaviour that isn't tested is behaviour nobody checked.
 */

export interface RenderableItem {
  candidate: {
    id: string;
    ticker?: string | null;
    headline: string;
    detail?: string | null;
  };
  reasons: string[];
  isExitSignal: boolean;
}

export interface RenderableDigest {
  items: RenderableItem[];
  suppressed: number;
  suppressedSummary: string | null;
}

/**
 * Plain text, complete on its own.
 *
 * Someone should be able to read this on a phone on Monday morning and know
 * whether anything needs them, without opening the app.
 */
export function renderDigestEmail(digest: RenderableDigest): string {
  if (digest.items.length === 0) {
    // `suppressed + items` is the candidate count, so zero of both means the
    // window was genuinely empty. That is a DIFFERENT thing from "things
    // happened and none of them mattered", and usually means a sync stopped
    // running rather than that the week was quiet. Conflating the two tells
    // someone their pipeline is fine when it isn't, or that it's broken when
    // it's merely been a slow week.
    const nothingArrived = digest.suppressed === 0;

    return [
      nothingArrived
        ? "Nothing was recorded at all this week — no filings, price moves or score changes came in."
        : "Nothing happened this week that clears the bar for your attention.",
      nothingArrived
        ? "If that's surprising, the daily sync may not have run. Older events are still there; this is about this week only."
        : digest.suppressedSummary ??
          "Everything that did happen scored below the bar.",
      "Nothing has been traded. This is a summary, not advice.",
    ].join("\n\n");
  }

  const parts: string[] = [
    `${digest.items.length} thing${digest.items.length === 1 ? "" : "s"} worth your attention this week.`,
  ];

  digest.items.forEach((item, index) => {
    const lines: string[] = [
      `${index + 1}. ${item.candidate.ticker ? `${item.candidate.ticker} — ` : ""}${item.candidate.headline}`,
    ];
    if (item.isExitSignal) {
      lines.push(
        "   ⤷ This is the thesis completing, not confirmation. It's a reason to think about trimming.",
      );
    }
    if (item.candidate.detail) lines.push(`   ${item.candidate.detail}`);
    lines.push(`   Why this made the list: ${item.reasons.join("; ")}`);
    parts.push(lines.join("\n"));
  });

  if (digest.suppressedSummary) parts.push(digest.suppressedSummary);
  parts.push("Nothing has been traded. This is a summary, not advice.");

  return parts.join("\n\n");
}
