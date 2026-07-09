import { useState } from "react";
import {
  resendConfirmation,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "../lib/useAuth";
import RetroWindow from "../components/RetroWindow";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signup") {
        const { needsConfirmation } = await signUpWithEmail(email.trim(), password);
        if (needsConfirmation) {
          setNotice(
            "Account created. Check your email and click the confirmation link, then sign in.",
          );
          setMode("signin");
        }
      } else {
        await signInWithEmail(email.trim(), password);
        // App routes away automatically once the session is set.
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    try {
      await resendConfirmation(email.trim());
      setNotice("Confirmation email resent.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="center">
      <RetroWindow title="mushe.exe" className="card">
        <div style={{ textAlign: "center" }}>
          <h1 className="pixel-heading" style={{ marginTop: 0, fontSize: 26 }}>
            mushe
          </h1>
          <p className="muted">Listen to music together, in real time.</p>

          <div style={{ display: "grid", gap: 10, marginTop: 16, textAlign: "left" }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
            <button onClick={() => void submit()} disabled={busy || !email || !password}>
              {mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </div>

          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            {mode === "signin" ? (
              <>
                No account?{" "}
                <a href="#" onClick={(e) => (e.preventDefault(), setMode("signup"))}>
                  Create one
                </a>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <a href="#" onClick={(e) => (e.preventDefault(), setMode("signin"))}>
                  Sign in
                </a>{" "}
                ·{" "}
                <a href="#" onClick={(e) => (e.preventDefault(), void resend())}>
                  Resend confirmation
                </a>
              </>
            )}
          </p>

          <div style={{ borderTop: "2px dashed var(--border)", margin: "16px 0" }} />

          <button
            className="secondary"
            onClick={() => void signInWithGoogle()}
            style={{ width: "100%" }}
          >
            Continue with Google
          </button>

          {error && <p style={{ color: "#c23b2f", marginTop: 14 }}>{error}</p>}
          {notice && <p style={{ color: "var(--accent-2)", marginTop: 14 }}>{notice}</p>}
        </div>
      </RetroWindow>
    </div>
  );
}
