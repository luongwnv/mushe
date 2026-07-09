import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import RetroWindow from "../components/RetroWindow";
import { signOut } from "../lib/useAuth";
import {
  clearRoom,
  useActiveListeners,
  useAdminRooms,
  useIsAdmin,
} from "../features/admin/useAdminData";

interface Props {
  session: Session;
}

export default function AdminPage({ session }: Props) {
  const navigate = useNavigate();
  const { data: isAdmin, isLoading: checkingAdmin } = useIsAdmin(session.user.id);
  const { data: rooms, isLoading: loadingRooms, refetch } = useAdminRooms(!!isAdmin);
  const { perRoom, total: activeListeners } = useActiveListeners((rooms ?? []).map((r) => r.id));
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (checkingAdmin) {
    return <div className="center muted">Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="center">
        <RetroWindow title="mushe — admin" className="card">
          <p>You don't have access to this page.</p>
          <button className="secondary" onClick={() => navigate("/")}>
            Back to lobby
          </button>
        </RetroWindow>
      </div>
    );
  }

  async function handleClear(roomId: string, roomName: string) {
    if (!window.confirm(`Clear room "${roomName}"? This deletes it and everything in it.`)) return;
    setClearingId(roomId);
    setError(null);
    try {
      await clearRoom(roomId);
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClearingId(null);
    }
  }

  const roomList = rooms ?? [];

  return (
    <div className="center" style={{ alignItems: "flex-start", padding: "24px 20px" }}>
      <div style={{ width: "100%", maxWidth: 900, display: "flex", flexDirection: "column", gap: 18 }}>
        <RetroWindow
          title="mushe — admin dashboard"
          right={
            <button className="secondary" style={{ padding: "3px 10px" }} onClick={() => void signOut()}>
              Sign out
            </button>
          }
        >
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            <div className="admin-stat">
              <div className="admin-stat-value">{loadingRooms ? "…" : roomList.length}</div>
              <div className="admin-stat-label">Active rooms</div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat-value">{activeListeners}</div>
              <div className="admin-stat-label">Active users</div>
            </div>
            <div style={{ flex: 1 }} />
            <button className="secondary" onClick={() => navigate("/")}>
              Lobby
            </button>
          </div>
        </RetroWindow>

        <RetroWindow title={`rooms (${roomList.length})`} bodyClassName="scroll" scroll noPad>
          {loadingRooms ? (
            <p className="muted" style={{ padding: 14 }}>
              Loading…
            </p>
          ) : roomList.length === 0 ? (
            <p className="muted" style={{ padding: 14 }}>
              No active rooms.
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Mode</th>
                  <th>Members</th>
                  <th>Queued</th>
                  <th>Listening now</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {roomList.map((room) => (
                  <tr key={room.id}>
                    <td>{room.name}</td>
                    <td className="muted">{room.code}</td>
                    <td className="muted">{room.playback_mode}</td>
                    <td>{room.member_count}</td>
                    <td>{room.queued_count}</td>
                    <td>{perRoom.get(room.id) ?? 0}</td>
                    <td className="muted">{new Date(room.created_at).toLocaleString()}</td>
                    <td>
                      <button
                        className="danger"
                        disabled={clearingId === room.id}
                        onClick={() => void handleClear(room.id, room.name)}
                      >
                        {clearingId === room.id ? "Clearing…" : "Clear"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </RetroWindow>

        {error && <p style={{ color: "#c23b2f" }}>{error}</p>}
      </div>
    </div>
  );
}
