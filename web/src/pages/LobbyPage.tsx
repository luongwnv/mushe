import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { signOut } from "../lib/useAuth";
import RetroWindow from "../components/RetroWindow";

export default function LobbyPage() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clicking Create/Join is itself a user gesture — mark autoplay as
  // unlocked (persists across reloads/rooms) so RoomPage can skip its
  // "tap to listen" prompt.
  function markAutoplayUnlocked() {
    localStorage.setItem("mushe:autoplay-unlocked", "1");
  }

  async function createRoom() {
    setBusy(true);
    setError(null);
    markAutoplayUnlocked();
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
    markAutoplayUnlocked();
    // join_room is the only sanctioned join path (non-members can't SELECT rooms).
    const { error } = await supabase.rpc("join_room", { p_code: code });
    setBusy(false);
    if (error) return setError(error.message);
    navigate(`/room/${code}`);
  }

  return (
    <div className="center">
      <RetroWindow
        title="mushe — lobby"
        className="card"
        right={
          <button className="secondary" style={{ padding: "3px 10px" }} onClick={() => void signOut()}>
            Sign out
          </button>
        }
      >
        <h1 className="pixel-heading" style={{ margin: "0 0 4px", fontSize: 22 }}>
          mushe
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>Listen to music together, in real time.</p>

        <h3 className="pixel-heading" style={{ fontSize: 14 }}>Create a room</h3>
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

        <h3 className="pixel-heading" style={{ fontSize: 14 }}>Join a room</h3>
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
          <p style={{ color: "#c23b2f", marginTop: 16 }}>{error}</p>
        )}
      </RetroWindow>
    </div>
  );
}
