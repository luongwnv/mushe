import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { signOut } from "../lib/useAuth";

export default function LobbyPage() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    setBusy(true);
    setError(null);
    // create_room RPC inserts the room + host membership + empty playback_state
    // and returns the shareable code.
    const { data, error } = await supabase.rpc("create_room", {
      p_name: roomName.trim() || "Untitled Room",
    });
    setBusy(false);
    if (error) return setError(error.message);
    navigate(`/room/${data as string}`);
  }

  async function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    setError(null);
    // join_room is the only sanctioned join path (non-members can't SELECT rooms).
    const { error } = await supabase.rpc("join_room", { p_code: code });
    setBusy(false);
    if (error) return setError(error.message);
    navigate(`/room/${code}`);
  }

  return (
    <div className="center">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 style={{ margin: 0 }}>mushe</h1>
          <button className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>

        <h3>Create a room</h3>
        <div className="row">
          <input
            placeholder="Room name (optional)"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            style={{ flex: 1 }}
          />
          <button onClick={() => void createRoom()} disabled={busy}>
            Create
          </button>
        </div>

        <h3>Join a room</h3>
        <div className="row">
          <input
            placeholder="Room code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            style={{ flex: 1 }}
          />
          <button onClick={() => void joinRoom()} disabled={busy}>
            Join
          </button>
        </div>

        {error && (
          <p style={{ color: "#ff6b6b", marginTop: 16 }}>{error}</p>
        )}
      </div>
    </div>
  );
}
