import type { PresenceMeta } from "../../lib/types";

interface Props {
  listeners: PresenceMeta[];
  hostId: string;
}

// Live roster of who's currently connected, from Supabase Presence.
export default function ListenerRoster({ listeners, hostId }: Props) {
  return (
    <section style={{ marginTop: 16 }}>
      <h3 style={{ marginBottom: 8 }}>Listening now ({listeners.length})</h3>
      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
        {listeners.length === 0 && <span className="muted">No one here yet.</span>}
        {listeners.map((l) => (
          <div key={l.user_id} className="row" style={{ gap: 6 }}>
            {l.avatar_url ? (
              <img
                src={l.avatar_url}
                alt=""
                width={28}
                height={28}
                style={{ borderRadius: "50%" }}
              />
            ) : (
              <div
                aria-hidden
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "var(--panel-2)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                }}
              >
                {l.display_name.charAt(0).toUpperCase()}
              </div>
            )}
            <span>
              {l.display_name}
              {l.user_id === hostId && (
                <span className="muted" style={{ fontSize: 12 }}>
                  {" "}
                  · host
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
