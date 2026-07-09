import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/useAuth";
import LoginPage from "./pages/LoginPage";
import LobbyPage from "./pages/LobbyPage";
import AuthCallback from "./pages/AuthCallback";
import AdminPage from "./pages/AdminPage";
import RoomPage from "./features/room/RoomPage";

export default function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return <div className="center muted">Loading…</div>;
  }

  return (
    <>
      <div className="sky" aria-hidden />
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        {!session ? (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        ) : (
          <>
            <Route path="/" element={<LobbyPage />} />
            <Route path="/room/:code" element={<RoomPage />} />
            <Route path="/admin" element={<AdminPage session={session} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </>
  );
}
