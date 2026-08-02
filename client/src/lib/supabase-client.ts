/**
 * Browser-side Supabase client, used for one thing only: signing in with
 * Google and holding the resulting session.
 *
 * All data still comes from our own Express API. This client never queries
 * tables directly — it just proves who you are, and the access token it
 * hands out gets attached to every API call (see lib/queryClient.ts).
 *
 * The anon key is meant to be public; it identifies the project, it doesn't
 * grant access. Access is decided server-side in server/auth.ts.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Missing config is a setup mistake, not a crash. Returning null lets the
 * sign-in screen say what's wrong instead of the whole app white-screening
 * on a blank .env — which is exactly the situation where a readable message
 * matters most.
 */
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The app is served under a hash router, so the OAuth redirect lands
        // back with its own hash fragment. Let Supabase consume it.
        detectSessionInUrl: true,
      },
    })
  : null;

/**
 * The token to put on API calls. Reads from the stored session, refreshing it
 * first if it's about to expire, so a tab left open over a weekend doesn't
 * start 401-ing. Returns null when nobody is signed in.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
