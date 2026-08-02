/**
 * Who is making this request.
 *
 * Sign-in happens entirely in the browser through Supabase Auth's Google
 * provider. The browser then sends the resulting access token on every API
 * call as `Authorization: Bearer <token>`. This file is the server-side gate:
 * it asks Supabase whether the token is real, then checks the email against
 * the three-person allowlist in shared/team.ts.
 *
 * Two separate doors, on purpose:
 *
 *   - `requireUser`      — a signed-in teammate. Everything a human touches.
 *   - `requireAdminToken`— the pre-existing shared secret for ingestion and
 *                          scheduled jobs (server/routes.ts). Untouched. A
 *                          cron job has no Google account, so it can't use
 *                          the first door.
 *
 * Nothing here writes to `human_events`. Logging what a person did is a
 * deliberate act at the call site, not a side effect of authenticating —
 * otherwise every page poll becomes an "event" and the logs turn to noise.
 */

import type { Request, Response, NextFunction } from "express";
import { supabase } from "./supabase";
import { isTeamMember, normalizeEmail } from "@shared/team";

export interface TeamUser {
  /** Supabase auth uid — the stable id every human_events row carries. */
  id: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TeamUser;
    }
  }
}

/**
 * Verifying a token costs a round trip to Supabase. A single page load fires
 * several API calls with the same token, so cache the answer briefly.
 *
 * 60 seconds is short enough that removing someone from the allowlist takes
 * effect almost immediately, and long enough that one page load is one
 * verification instead of eight.
 */
const VERIFY_CACHE_TTL_MS = 60_000;
const verifyCache = new Map<string, { user: TeamUser | null; expiresAt: number }>();

function readCache(token: string): { user: TeamUser | null } | undefined {
  const hit = verifyCache.get(token);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    verifyCache.delete(token);
    return undefined;
  }
  return { user: hit.user };
}

function writeCache(token: string, user: TeamUser | null) {
  // Bound the map so a stream of junk tokens can't grow it without limit.
  if (verifyCache.size > 200) verifyCache.clear();
  verifyCache.set(token, { user, expiresAt: Date.now() + VERIFY_CACHE_TTL_MS });
}

export function bearerToken(req: Request): string | null {
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Returns the signed-in teammate, or null. Never throws — a bad token is an
 * ordinary outcome, not an exception.
 */
export async function resolveUser(req: Request): Promise<TeamUser | null> {
  const token = bearerToken(req);
  if (!token) return null;

  const cached = readCache(token);
  if (cached) return cached.user;

  let user: TeamUser | null = null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    const email = normalizeEmail(data?.user?.email);
    if (!error && data?.user && isTeamMember(email)) {
      user = { id: data.user.id, email };
    }
  } catch {
    // Network trouble reaching Supabase reads as "not signed in" rather than
    // a 500. The client's response to both is the same: show sign-in.
    user = null;
  }

  writeCache(token, user);
  return user;
}

/** Hard gate. Use on everything a person does. */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = await resolveUser(req);
  if (!user) {
    return res.status(401).json({
      error: "Sign in with your team Google account to use this.",
    });
  }
  req.user = user;
  next();
}

/**
 * Soft gate: attaches the user if there is one, but lets the request through
 * either way. Used by endpoints that a scheduled job also calls, where the
 * work is the same but the human_events row should only be written when an
 * actual person is behind the request.
 */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  req.user = (await resolveUser(req)) ?? undefined;
  next();
}

/** Test seam — lets a test clear state between cases. */
export function __clearVerifyCache() {
  verifyCache.clear();
}
