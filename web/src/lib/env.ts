// Centralized, validated access to Vite env vars. Throws early with a clear
// message if a required var is missing so misconfiguration is obvious in dev.

function required(name: string): string {
  const value = import.meta.env[name as keyof ImportMetaEnv] as string | undefined;
  if (!value) {
    throw new Error(
      `Missing env var ${name}. Copy web/.env.example to web/.env and fill it in.`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required("VITE_SUPABASE_URL"),
  supabaseAnonKey: required("VITE_SUPABASE_ANON_KEY"),
  // Resolver is optional at boot; features that need it fail at call time.
  resolverUrl: (import.meta.env.VITE_RESOLVER_URL as string | undefined) ?? "http://localhost:8787",
};
