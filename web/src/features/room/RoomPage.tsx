import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import type { Room } from "../../lib/types";

// Phase-1 skeleton: loads the room by code and renders the room shell.
// Realtime queue/presence (Phase 2) and the YouTube player (Phase 4) mount here.
export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div style={{ padding: 24 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>{room.name}</h2>
          <p className="muted" style={{ margin: "4px 0" }}>
            Code <strong>{room.code}</strong> · mode {room.playback_mode}
          </p>
        </div>
        <button className="secondary" onClick={() => navigate("/")}>
          Leave
        </button>
      </div>

      {/* Phase 2: <ListenerRoster /> via Supabase Presence */}
      {/* Phase 3: <SearchBox /> + <Queue /> with realtime + voting */}
      {/* Phase 4: <Player /> (YouTube IFrame) + host transport controls */}
      <p className="muted" style={{ marginTop: 40 }}>
        Queue, voting, and the synced player land in the next phases.
      </p>
    </div>
  );
}
