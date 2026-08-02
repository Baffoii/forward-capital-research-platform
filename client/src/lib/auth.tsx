/**
 * Signed-in state for the whole app.
 *
 * Deliberately small. There is one question this answers — "who is using this
 * browser right now" — and three actions: sign in, sign out, wait.
 *
 * There are no roles and no permissions. If you're one of the three people in
 * shared/team.ts you can do everything; if you aren't, you can't do anything.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./supabase-client";
import { isTeamMember, normalizeEmail, shortName } from "@shared/team";

export interface SignedInUser {
  id: string;
  email: string;
  /** e.g. "maasg" — what we show in the UI. */
  name: string;
}

type AuthState =
  | { status: "loading" }
  /** Signed out, or never signed in. */
  | { status: "signed-out" }
  /** Signed in with Google, but not one of the three allowed addresses. */
  | { status: "not-on-team"; email: string }
  | { status: "signed-in"; user: SignedInUser };

interface AuthContextValue {
  state: AuthState;
  /** Convenience: the user, or null. Most components only need this. */
  user: SignedInUser | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  configured: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function stateFromSession(session: Session | null): AuthState {
  if (!session?.user) return { status: "signed-out" };
  const email = normalizeEmail(session.user.email);
  if (!isTeamMember(email)) return { status: "not-on-team", email };
  return {
    status: "signed-in",
    user: { id: session.user.id, email, name: shortName(email) },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(
    supabaseConfigured ? { status: "loading" } : { status: "signed-out" },
  );

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setState(stateFromSession(data.session));
    });

    // Covers the OAuth redirect landing, token refreshes, and sign-out in
    // another tab.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(stateFromSession(session));
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Come back to wherever the app is served from. The hash router
        // sorts out which page after the session is picked up.
        redirectTo: window.location.origin + window.location.pathname,
      },
    });
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setState({ status: "signed-out" });
  };

  const user = state.status === "signed-in" ? state.user : null;

  return (
    <AuthContext.Provider value={{ state, user, signIn, signOut, configured: supabaseConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
