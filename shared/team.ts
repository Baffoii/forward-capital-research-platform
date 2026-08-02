/**
 * The whole access-control model for this app.
 *
 * Three known people. One list. That's it — there is deliberately no sign-up
 * page, no roles, no permissions table, and no user-management screen. Adding
 * a fourth person means editing this array and redeploying, which is the right
 * amount of ceremony for a three-person fund.
 *
 * Shared by the browser (to show a clear "you're not on the list" message) and
 * by the server (which is the gate that actually matters — the browser copy is
 * a courtesy, not security).
 */

export const TEAM_EMAILS = [
  "magniac@stanford.edu",
  "maasg@stanford.edu",
  "rchen23@stanford.edu",
] as const;

export type TeamEmail = (typeof TEAM_EMAILS)[number];

/**
 * Google addresses are case-insensitive and can arrive with surrounding
 * whitespace from an OAuth payload, so compare on a normalized form rather
 * than with `includes()` on the raw string.
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function isTeamMember(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return TEAM_EMAILS.some((allowed) => allowed.toLowerCase() === normalized);
}

/**
 * Short label for a teammate, used anywhere a person shows up in the UI or in
 * a notification ("handed to rchen23"). Full email addresses make sentences
 * unreadable and add nothing when there are only three of us.
 */
export function shortName(email: string | null | undefined): string {
  const normalized = normalizeEmail(email);
  if (!normalized) return "someone";
  return normalized.split("@")[0];
}
