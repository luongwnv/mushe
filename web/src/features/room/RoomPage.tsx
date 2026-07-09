import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/useAuth";
import { useProfile } from "../../lib/useProfile";
import { expectedPositionMs, isoToServerMs, syncClock } from "../../lib/sync";
import type { PlaybackMode, PresenceMeta, ResolvedTrack, Room } from "../../lib/types";
import { useRoomChannel } from "./useRoomChannel";
import { useMyVotes, usePlayback, useQueue } from "./useRoomData";
import { useQueueActions } from "./useQueueActions";
import { usePlaybackActions } from "./usePlaybackActions";
import { usePlaybackSync } from "./usePlaybackSync";
import SearchBox from "./SearchBox";
import Queue from "./Queue";
import Player, { type PlayerHandle } from "./Player";
import RightPanel from "./RightPanel";
import PlayerBar from "./PlayerBar";
import { Icon } from "../../components/Icon";
import RetroWindow from "../../components/RetroWindow";

// Phase 4/5: full collaborative playback. The host is the authoritative clock;
// every audible client reconciles to playback_state via usePlaybackSync.
export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { data: profile } = useProfile(session?.user.id);

  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "tap to listen" gesture done — pre-satisfied if the user has ever
  // unlocked audio on this site before (this room or any other), since
  // browsers remember per-origin autoplay permission across page loads.
  const [unlocked, setUnlocked] = useState(
    () => localStorage.getItem("mushe:autoplay-unlocked") === "1",
  );
  const [localPosMs, setLocalPosMs] = useState(0);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [volume, setVolume] = useState(100); // local player volume 0..100
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  const copy = useCallback((kind: "code" | "link", text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied((cur) => (cur === kind ? null : cur)), 1500);
    });
  }, []);

  // Player handle is held in state (not just a ref) so effects re-run when the
  // YouTube player finishes loading and the imperative handle becomes available.
  const playerRef = useRef<PlayerHandle>(null);
  const [player, setPlayer] = useState<PlayerHandle | null>(null);
  const playerReady = player !== null;

  // Resolve the room by code (RLS lets members read it).
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    // join_room is idempotent (on-conflict do-nothing), so calling it here
    // covers both a fresh join-via-link and a reload/direct-URL visit —
    // rooms_select_member below would otherwise reject non-members.
    supabase
      .rpc("join_room", { p_code: code.toUpperCase() })
      .then(({ error: joinError }) => {
        if (cancelled) return;
        if (joinError) {
          setError(joinError.message);
          return;
        }
        return supabase
          .from("rooms")
          .select("*")
          .eq("code", code.toUpperCase())
          .single()
          .then(({ data, error }) => {
            if (cancelled) return;
            if (error) setError(error.message);
            else setRoom(data as Room);
          });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Clock-sync handshake on entering the room (foundation for synced playback).
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
  const { data: myVotes } = useMyVotes(room?.id);

  const isHost = session?.user.id === room?.host_id;
  const nowPlaying = queue.find((q) => q.status === "playing") ?? null;
  const queued = queue.filter((q) => q.status === "queued");
  const nextUp = queued[0] ?? null;

  const { addTrack, removeTrack, toggleVote, reorderQueue } = useQueueActions({
    roomId: room?.id ?? "",
    userId: session?.user.id ?? "",
  });
  const transport = usePlaybackActions({
    roomId: room?.id ?? "",
    currentItemId: playback?.current_item_id ?? null,
  });

  // Adding the first track to an idle room should start playback right away
  // instead of leaving it queued until someone hits Play.
  const wasIdle = !playback?.current_item_id;
  const onAddTrack = useCallback(
    (track: ResolvedTrack) => {
      addTrack.mutate(track, {
        onSuccess: () => {
          if (wasIdle) transport.next.mutate();
        },
      });
    },
    [addTrack, transport, wasIdle],
  );

  // Whether THIS client should produce audio: host always; followers only in
  // synced mode. (host_only => non-host players stay muted.)
  const mode = room?.playback_mode ?? "synced";
  const active = isHost || mode === "synced";

  // Drive the local player to the shared clock.
  usePlaybackSync({
    player,
    playerReady,
    playback,
    currentItem: nowPlaying,
    unlocked,
    active,
  });

  // Track local player position for the progress bar / seek anchoring.
  useEffect(() => {
    if (!active || !player) return;
    const id = setInterval(() => setLocalPosMs(player.getTimeMs()), 500);
    return () => clearInterval(id);
  }, [active, player]);

  // Apply local volume to the player. Re-run when unlocked changes so that
  // the volume is pushed again right after the user taps "Tap to listen".
  useEffect(() => {
    player?.setVolume(volume);
  }, [player, volume, unlocked]);

  // Host auto-advance when the current track ends.
  const handleEnded = useCallback(() => {
    if (isHost) transport.next.mutate();
  }, [isHost, transport.next]);

  // Player errors. 101/150 = embedding disabled by the uploader; 2/5/100 = bad
  // id / HTML5 / not found. In all cases this video can't play here — skip to
  // the next track. Any member can trigger the skip (advance_track is
  // idempotent), and we surface a clear message.
  const handleError = useCallback(
    (code: number) => {
      setErrorNotice(
        code === 101 || code === 150
          ? "This video can't be embedded — skipping…"
          : "Couldn't play this video — skipping…",
      );
      setTimeout(() => setErrorNotice(null), 4000);
      transport.next.mutate();
    },
    [transport],
  );

  // Host transport handlers (anchor on the host's local player position).
  const onPlay = useCallback(() => {
    // If nothing is playing yet but the queue has songs, advance to start one.
    if (!playback?.current_item_id && queued.length > 0) {
      transport.next.mutate();
    } else {
      transport.play.mutate(player?.getTimeMs() ?? playback?.position_ms ?? 0);
    }
  }, [playback, queued.length, transport, player]);

  const onPause = useCallback(() => {
    transport.pause.mutate(player?.getTimeMs() ?? 0);
  }, [transport, player]);

  const onSkip = useCallback(() => transport.next.mutate(), [transport]);
  const onPrevious = useCallback(() => transport.previous.mutate(), [transport]);

  const onSeek = useCallback(
    (posMs: number) => {
      setLocalPosMs(posMs);
      transport.seek.mutate({ positionMs: posMs, isPlaying: playback?.is_playing ?? false });
    },
    [transport, playback],
  );

  // Not wired into PlayerBar's UI right now (shuffle/repeat buttons were
  // removed), kept here since the backend mutations still exist and this
  // may get a UI again later.
  const onToggleShuffle = useCallback(() => {
    transport.setShuffle.mutate(!(playback?.shuffle ?? false));
  }, [transport, playback]);
  void onToggleShuffle;

  const onCycleRepeat = useCallback(() => {
    const cur = playback?.repeat_mode ?? "off";
    const next = cur === "off" ? "all" : cur === "all" ? "one" : "off";
    transport.setRepeat.mutate(next);
  }, [transport, playback]);
  void onCycleRepeat;

  const onChangeMode = useCallback(
    async (next: PlaybackMode) => {
      if (!room) return;
      await supabase.from("rooms").update({ playback_mode: next }).eq("id", room.id);
      setRoom({ ...room, playback_mode: next });
    },
    [room],
  );

  if (error) {
    return (
      <div className="center">
        <RetroWindow title="error" className="card">
          <p style={{ color: "#c23b2f" }}>Couldn’t open room: {error}</p>
          <button onClick={() => navigate("/")}>Back to lobby</button>
        </RetroWindow>
      </div>
    );
  }

  if (!room) return <div className="center muted">Opening room…</div>;

  // Progress display uses the shared clock so members (who may have no audible
  // player in host_only mode) still see an accurate position.
  const sharedExpectedMs = playback
    ? expectedPositionMs({
        isPlaying: playback.is_playing,
        positionMs: playback.position_ms,
        startedAtServerMs: isoToServerMs(playback.started_at),
      })
    : 0;
  const displayPosMs = active ? localPosMs : sharedExpectedMs;

  // The (audio-only, hidden) player — rendered once here so playerRef stays in
  // this component (the sync loop needs it).
  const playerSlot = (
    <Player
      ref={playerRef}
      audible={unlocked}
      volume={volume}
      onReady={() => setPlayer(playerRef.current)}
      onEnded={handleEnded}
      onError={handleError}
    />
  );

  return (
    <div className="desktop">
      {/* top bar */}
      <header className="desktop-topbar">
        <button className="iconbtn" onClick={() => navigate("/")} title="Home">
          <Icon name="home" size={18} />
        </button>
        <span className="logo">mushe</span>
        <div className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="search" size={15} /> {room.name} · code {room.code}
        </div>
        <div className="spacer" />
        <span className={connected ? "pill live-pill" : "pill"}>
          {connected && <span aria-hidden className="live-dot" />}
          {connected ? "live" : "connecting…"}
        </span>
        <div className="avatar" title={isHost ? "Host" : "Listener"}>
          {(profile?.display_name ?? "?").charAt(0).toUpperCase()}
        </div>
      </header>

      {/* LEFT: room info / share */}
      <nav className="desktop-col desktop-col-left">
        <RetroWindow title="this room">
          <div style={{ display: "grid", gap: 16 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{room.name}</strong>
              <button className="secondary" onClick={() => navigate("/")}>
                Leave
              </button>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, textTransform: "uppercase" }}>
                Share code
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
                <div
                  className="pixel-heading"
                  style={{ fontSize: 24, letterSpacing: 3, color: "var(--accent-press)" }}
                >
                  {room.code}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="iconbtn"
                    title="Copy room code"
                    onClick={() => copy("code", room.code)}
                    style={{ padding: 8 }}
                  >
                    <Icon name={copied === "code" ? "check" : "copy"} size={20} />
                  </button>
                  <button
                    type="button"
                    className="iconbtn"
                    title="Copy invite link"
                    onClick={() =>
                      copy(
                        "link",
                        `${window.location.origin}${import.meta.env.BASE_URL}room/${room.code}`,
                      )
                    }
                    style={{ padding: 8 }}
                  >
                    <Icon name={copied === "link" ? "check" : "link"} size={20} />
                  </button>
                </div>
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                Listening mode
              </div>
              {isHost ? (
                <select
                  className="select"
                  value={mode}
                  onChange={(e) => void onChangeMode(e.target.value as PlaybackMode)}
                  style={{ width: "100%" }}
                >
                  <option value="synced">Synced (all devices)</option>
                  <option value="host_only">Host only (one speaker)</option>
                </select>
              ) : (
                <div className="muted" style={{ fontSize: 13 }}>
                  {mode === "synced" ? "Synced — playing on your device" : "Host is the speaker"}
                </div>
              )}
            </div>

            <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              Anyone with the code can join, add songs, upvote, and control
              playback.
            </div>
          </div>
        </RetroWindow>

        <RetroWindow title={`listening now (${listeners.length})`}>
          <div style={{ display: "grid", gap: 10 }}>
            {listeners.length === 0 && <span className="muted">No one here yet.</span>}
            {listeners.map((l) => (
              <div key={l.user_id} className="listener-row">
                {l.avatar_url ? (
                  <img
                    src={l.avatar_url}
                    alt=""
                    width={26}
                    height={26}
                    style={{ borderRadius: "50%", border: "1.5px solid var(--border)" }}
                  />
                ) : (
                  <div className="listener-avatar" aria-hidden>
                    {l.display_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span>
                  {l.display_name}
                  {l.user_id === room.host_id && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {" "}
                      · host
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </RetroWindow>
      </nav>

      {/* MIDDLE: radio player + search + queue */}
      <main className="desktop-col desktop-col-mid">
        {active && !unlocked && (
          <button
            onClick={() => {
              localStorage.setItem("mushe:autoplay-unlocked", "1");
              setUnlocked(true);
            }}
            style={{ width: "100%" }}
          >
            Tap to listen
          </button>
        )}
        <PlayerBar
          playback={playback}
          currentItem={nowPlaying}
          nextItem={nextUp}
          hasQueued={queued.length > 0}
          positionMs={displayPosMs}
          volume={volume}
          canRemoveCurrent={isHost || nowPlaying?.added_by === session?.user.id}
          onPlay={onPlay}
          onPause={onPause}
          onNext={onSkip}
          onPrevious={onPrevious}
          onSeek={onSeek}
          onVolume={setVolume}
          onRemoveCurrent={() => nowPlaying && removeTrack.mutate(nowPlaying.id)}
        />

        {/* the (audio-only, hidden) player mounts here */}
        <div style={{ display: "none" }}>{active ? playerSlot : null}</div>
        {!active && (
          <div className="muted" style={{ fontSize: 12, textAlign: "center" }}>
            Host is the speaker in this room
          </div>
        )}
        {errorNotice && (
          <p style={{ fontSize: 13, textAlign: "center", color: "#c23b2f" }}>{errorNotice}</p>
        )}

        <RetroWindow title="collaborative queue" className="grow" bodyClassName="scroll">
          <div style={{ display: "grid", gap: 18 }}>
            <div>
              <SearchBox onAdd={onAddTrack} adding={addTrack.isPending} />
              {addTrack.isError && (
                <p style={{ color: "#c23b2f" }}>{(addTrack.error as Error).message}</p>
              )}
            </div>

            <Queue
              items={queued}
              myVotes={myVotes ?? new Set()}
              myUserId={session?.user.id ?? ""}
              isHost={isHost}
              onToggleVote={(itemId, voted) => toggleVote.mutate({ itemId, voted })}
              onRemove={(itemId) => removeTrack.mutate(itemId)}
              onReorder={(orderedIds) => reorderQueue.mutate(orderedIds)}
            />
          </div>
        </RetroWindow>
      </main>

      {/* RIGHT: now playing art */}
      <RightPanel
        roomName={room.name}
        playerSlot={null}
        active={active}
        nowPlaying={nowPlaying}
      />
    </div>
  );
}
