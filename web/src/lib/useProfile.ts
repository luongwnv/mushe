import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabaseClient";
import type { Profile } from "./types";

/**
 * Reads the current user's profile row (created server-side by the
 * handle_new_user trigger on first login). Used for presence display.
 */
export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId!)
        .single();
      if (error) throw error;
      return data as Profile;
    },
  });
}
