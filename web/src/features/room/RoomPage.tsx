import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/useAuth";
import { useProfile } from "../../lib/useProfile";
import { expectedPositionMs, isoToServerMs, syncClock } from "../../lib/sync";
import type { PlaybackMode, PresenceMeta, Room } from "../../lib/types";
import { useRoomChannel } from "./useRoomChannel";
import { useMyVotes, usePlayback, useQueue } from "./useRoomData";
import { useQueueActions } from "./useQueueActions";
import { usePlaybackActions } from "./usePlaybackActions";
import { usePlaybackSync } from "./usePlaybackSync";
import ListenerRoster from "./ListenerRoster";
import SearchBox from "./SearchBox";
import Queue from "./Queue";
import HostControls from "./HostControls";
import Player, { type PlayerHandle } from "./Player";
import { formatDuration } from "./format";

// Phase 4/5: full collaborative playback. The host is the authoritative clock;
// every audible client reconciles to playback_state via usePlaybackSync.
export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { data: profile } = useProfile(session?.user.id);

  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false); // "tap to listen" gesture done
  const [playerReady, setPlayerReady] = useState(false);
  const [localPosMs, setLocalPosMs] = useState(0);
  const [adNotice, setAdNotice] = useState(false);

  const playerRef = useRef<PlayerHandle>(null);

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

  const { addTrack, removeTrack, toggleVote } = useQueueActions({
    roomId: room?.id ?? "",
    userId: session?.user.id ?? "",
  });
  const transport = usePlaybackActions({
    roomId: room?.id ?? "",
    currentItemId: playback?.current_item_id ?? null,
  });

  // Whether THIS client should produce audio: host always; followers only in
  // synced mode. (host_only => non-host players stay muted.)
  const mode = room?.playback_mode ?? "synced";
  const active = isHost || mode === "synced";

  // Drive the local player to the shared clock.
  usePlaybackSync({
    player: playerRef.current,
    playerReady,
    playback,
    currentItem: nowPlaying,
    unlocked,
    active,
  });

  // Track local player position for the progress bar / seek anchoring.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (p) setLocalPosMs(p.getTimeMs());
    }, 500);
    return () => clearInterval(id);
  }, [active]);

  // Host auto-advance when the current track ends.
  const handleEnded = useCallback(() => {
    if (isHost) transport.next.mutate();
  }, [isHost, transport.next]);

  // Ad interruptions briefly desync; the sync loop self-heals. Surface a hint.
  const handleError = useCallback((code: number) => {
    // 101/150 => embedding disabled; host should skip. 2/5/100 => other.
    if ((code === 101 || code === 150) && isHost) {
      transport.next.mutate();
    } else {
      setAdNotice(true);
      setTimeout(() => setAdNotice(false), 4000);
    }
  }, [isHost, transport.next]);

  // Host transport handlers (anchor on the host's local player position).
  const onPlay = useCallback(() => {
    // If nothing is playing yet but the queue has songs, advance to start one.
    if (!playback?.current_item_id && queued.length > 0) {
      transport.next.mutate();
    } else {
      transport.play.mutate(playerRef.current?.getTimeMs() ?? playback?.position_ms ?? 0);
    }
  }, [playback, queued.length, transport]);

  const onPause = useCallback(() => {
    transport.pause.mutate(playerRef.current?.getTimeMs() ?? 0);
  }, [transport]);

  const onSkip = useCallback(() => transport.next.mutate(), [transport]);

  const onSeek = useCallback(
    (posMs: number) => {
      setLocalPosMs(posMs);
      transport.seek.mutate({ positionMs: posMs, isPlaying: playback?.is_playing ?? false });
    },
    [transport, playback],
  );

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
        <div className="card">
          <p style={{ color: "#ff6b6b" }}>Couldn’t open room: {error}</p>
          <button onClick={() => navigate("/")}>Back to lobby</button>
        </div>
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
  const durationMs = nowPlaying?.duration_ms ?? 0;

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

      <section style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Now playing</h3>

        {/* Tap-to-listen unlocks browser autoplay with sound. */}
        {active && !unlocked && (
          <button onClick={() => setUnlocked(true)} style={{ marginBottom: 12 }}>
            🔊 Tap to listen
          </button>
        )}

        {/* The audible/active client mounts a real player (ToS: keep it visible). */}
        {active && (
          <div style={{ marginBottom: 12 }}>
            <Player
              ref={playerRef}
              audible={unlocked}
              onReady={() => setPlayerReady(true)}
              onEnded={handleEnded}
              onError={handleError}
            />
          </div>
        )}

        {nowPlaying ? (
          <div>
            <div className="row" style={{ gap: 10 }}>
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
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              {formatDuration(displayPosMs)}
              {durationMs ? ` / ${formatDuration(durationMs)}` : ""}
              {!playback?.is_playing && " · paused"}
            </div>
          </div>
        ) : (
          <p className="muted">
            Nothing playing.{" "}
            {isHost ? "Add a song and press Play." : "Waiting for the host."}
          </p>
        )}

        {adNotice && (
          <p className="muted" style={{ fontSize: 13 }}>
            Catching up after an interruption…
          </p>
        )}

        {isHost && (
          <HostControls
            playback={playback}
            currentItem={nowPlaying}
            hasQueued={queued.length > 0}
            mode={mode}
            positionMs={displayPosMs}
            onPlay={onPlay}
            onPause={onPause}
            onSkip={onSkip}
            onSeek={onSeek}
            onChangeMode={(m) => void onChangeMode(m)}
          />
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Add a song</h3>
        <SearchBox onAdd={(t) => addTrack.mutate(t)} adding={addTrack.isPending} />
        {addTrack.isError && (
          <p style={{ color: "#ff6b6b" }}>{(addTrack.error as Error).message}</p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Queue ({queued.length})</h3>
        <Queue
          items={queued}
          myVotes={myVotes ?? new Set()}
          myUserId={session?.user.id ?? ""}
          isHost={isHost}
          onToggleVote={(itemId, voted) => toggleVote.mutate({ itemId, voted })}
          onRemove={(itemId) => removeTrack.mutate(itemId)}
        />
      </section>
    </div>
  );
}
