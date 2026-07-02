import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

interface AuthState {
  session: Session | null;
  loading: boolean;
}

/**
 * Tracks the current Supabase auth session. The profiles row is created
 * server-side by the handle_new_user trigger, so the client only reads.
 */
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

// import.meta.env.BASE_URL reflects Vite's `base` config (e.g. "/mushe/"),
// so the redirect lands back on the deployed app path, not just the origin.
export async function signInWithGoogle(): Promise<void> {
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}auth/callback`,
    },
  });
}

export interface EmailAuthResult {
  /** True when sign-up succeeded but the email still needs confirming. */
  needsConfirmation: boolean;
}

/**
 * Sign up with email + password. Supabase sends a confirmation email; the link
 * brings the user back to /auth/callback where the session is established.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<EmailAuthResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}auth/callback` },
  });
  if (error) throw error;
  // When confirmation is required, Supabase returns a user but no session.
  return { needsConfirmation: !data.session };
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}auth/callback` },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
