/**
 * The whole sign-in surface: one button.
 *
 * No email/password, no sign-up link, no "forgot password" — those would all
 * be dead ends, because the only way onto this app is to be one of the three
 * addresses listed in shared/team.ts.
 */

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export default function SignIn() {
  const { state, signIn, signOut, configured } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Forward Capital</h1>
          <p className="text-sm text-muted-foreground">Research Platform</p>
        </div>

        {!configured && (
          <div
            className="rounded-md border border-border bg-muted/40 p-4 text-left text-sm"
            data-testid="text-auth-not-configured"
          >
            <p className="font-medium">Sign-in isn't set up yet.</p>
            <p className="mt-1 text-muted-foreground">
              This app needs <code className="text-xs">VITE_SUPABASE_URL</code> and{" "}
              <code className="text-xs">VITE_SUPABASE_ANON_KEY</code> in the{" "}
              <code className="text-xs">.env</code> file, and Google turned on as a
              sign-in provider in the Supabase dashboard.
            </p>
          </div>
        )}

        {state.status === "not-on-team" && (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-left text-sm"
            data-testid="text-not-on-team"
          >
            <p className="font-medium">That account isn't on the team list.</p>
            <p className="mt-1 text-muted-foreground">
              You signed in as {state.email}. Sign in with your Stanford account
              instead.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={signOut}
              data-testid="button-sign-out-wrong-account"
            >
              Use a different account
            </Button>
          </div>
        )}

        {state.status !== "not-on-team" && (
          <Button
            className="w-full"
            disabled={!configured || state.status === "loading"}
            onClick={signIn}
            data-testid="button-sign-in-google"
          >
            {state.status === "loading" ? "Checking…" : "Sign in with Google"}
          </Button>
        )}

        <p className="text-xs leading-snug text-muted-foreground">
          Three people have access. Everyone else is turned away at this screen.
        </p>
      </div>
    </div>
  );
}
