import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// Single shared Supabase client for auth, Postgres, and Realtime.
// PKCE flow is the default for OAuth in supabase-js v2 (browser-side).
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
  realtime: {
    params: {
      // Modest event rate for queue/playback updates.
      eventsPerSecond: 10,
    },
  },
});
