import { signInWithGoogle } from "../lib/useAuth";

export default function LoginPage() {
  return (
    <div className="center">
      <div className="card" style={{ textAlign: "center" }}>
        <h1 style={{ marginTop: 0 }}>mushe</h1>
        <p className="muted">Listen to music together, in real time.</p>
        <button onClick={() => void signInWithGoogle()} style={{ marginTop: 16 }}>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
