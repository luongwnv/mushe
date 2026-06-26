import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/useAuth";
import { useProfile } from "../../lib/useProfile";
import { syncClock } from "../../lib/sync";
import type { PresenceMeta, Room } from "../../lib/types";
import { useRoomChannel } from "./useRoomChannel";
import { usePlayback, useQueue } from "./useRoomData";
import ListenerRoster from "./ListenerRoster";

// Phase-2: loads the room, joins the realtime channel (Presence + Postgres
// Changes), runs the clock-sync handshake. Queue UI/voting (Phase 3) and the
// YouTube player (Phase 4) mount into the marked slots below.
export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { data: profile } = useProfile(session?.user.id);

  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the room by code (RLS lets members read it).
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    supabase
      .from("rooms")
      .select("*")
      .eq("code", code.toUpperCase())
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setRoom(data as Room);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Clock-sync handshake once on entering the room (foundation for synced mode).
  useEffect(() => {
    void syncClock();
  }, []);

  const me: PresenceMeta | null = useMemo(() => {
    if (!session || !profile) return null;
    return {
      user_id: session.user.id,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
    };
  }, [session, profile]);

  const { listeners, connected } = useRoomChannel({ roomId: room?.id, me });

  // Seed fetches (patched live by the channel).
  const { data: queue = [] } = useQueue(room?.id);
  const { data: playback } = usePlayback(room?.id);

  if (error) {
    return (
      <div className="center">
        <div className="card">
          <p style={{ color: "#ff6b6b" }}>Couldn’t open room: {error}</p>
          <button onClick={() => navigate("/")}>Back to lobby</button>
        </div>
      </div>
    );
  }

  if (!room) return <div className="center muted">Opening room…</div>;

  const isHost = session?.user.id === room.host_id;
  const nowPlaying = queue.find((q) => q.status === "playing") ?? null;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>{room.name}</h2>
          <p className="muted" style={{ margin: "4px 0" }}>
            Code <strong>{room.code}</strong> · mode {room.playback_mode}
            {isHost && " · you’re the host"} ·{" "}
            <span style={{ color: connected ? "var(--accent)" : "var(--muted)" }}>
              {connected ? "live" : "connecting…"}
            </span>
          </p>
        </div>
        <button className="secondary" onClick={() => navigate("/")}>
          Leave
        </button>
      </div>

      <ListenerRoster listeners={listeners} hostId={room.host_id} />

      {/* Phase 4: <Player /> (YouTube IFrame) + host transport controls */}
      <section style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Now playing</h3>
        {nowPlaying ? (
          <div className="row">
            {nowPlaying.thumbnail_url && (
              <img
                src={nowPlaying.thumbnail_url}
                alt=""
                width={56}
                height={56}
                style={{ borderRadius: 6 }}
              />
            )}
            <div>
              <div>{nowPlaying.title}</div>
              <div className="muted">{nowPlaying.artist}</div>
            </div>
          </div>
        ) : (
          <p className="muted">
            Nothing playing {playback ? "" : "(no playback state yet)"}.
          </p>
        )}
      </section>

      {/* Phase 3: <SearchBox /> + <Queue /> with realtime + voting */}
      <section style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Queue ({queue.filter((q) => q.status === "queued").length})</h3>
        <p className="muted">Search, add, and voting land in Phase 3.</p>
      </section>
    </div>
  );
}
