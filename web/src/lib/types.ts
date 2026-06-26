// Domain types mirroring the Supabase schema (see supabase/migrations).
// Kept hand-written for the MVP; can later be replaced by `supabase gen types`.

export type PlaybackMode = "synced" | "host_only";
export type MemberRole = "host" | "member";
export type QueueStatus = "queued" | "playing" | "played" | "skipped";
export type TrackSource = "youtube" | "spotify";

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  host_id: string;
  playback_mode: PlaybackMode;
  is_active: boolean;
  created_at: string;
}

export interface RoomMember {
  room_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
}

export interface QueueItem {
  id: string;
  room_id: string;
  added_by: string | null;
  source: TrackSource;
  source_id: string; // final playable YouTube video id
  spotify_id: string | null;
  title: string;
  artist: string | null;
  duration_ms: number | null;
  thumbnail_url: string | null;
  vote_count: number;
  position: number | null;
  status: QueueStatus;
  added_at: string;
  played_at: string | null;
}

export type RepeatMode = "off" | "one" | "all";

export interface PlaybackState {
  room_id: string;
  current_item_id: string | null;
  is_playing: boolean;
  position_ms: number;
  started_at: string | null; // server-time anchor
  updated_at: string;
  repeat_mode: RepeatMode;
  shuffle: boolean;
}

// Presence payload tracked on the room channel (ephemeral; not persisted).
export interface PresenceMeta {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

// A resolved track returned by the Node resolver service.
export interface ResolvedTrack {
  source: TrackSource;
  source_id: string;
  spotify_id: string | null;
  title: string;
  artist: string | null;
  duration_ms: number | null;
  thumbnail_url: string | null;
}
