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
import SearchBox from "./SearchBox";
import Queue from "./Queue";
import Player, { type PlayerHandle } from "./Player";
import RightPanel from "./RightPanel";
import PlayerBar from "./PlayerBar";
import { Icon } from "../../components/Icon";

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
  const [localPosMs, setLocalPosMs] = useState(0);
  const [adNotice, setAdNotice] = useState(false);
  const [volume, setVolume] = useState(100); // local player volume 0..100

  // Player handle is held in state (not just a ref) so effects re-run when the
  // YouTube player finishes loading and the imperative handle becomes available.
  const playerRef = useRef<PlayerHandle>(null);
  const [player, setPlayer] = useState<PlayerHandle | null>(null);
  const playerReady = player !== null;

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

  // Apply local volume to the player.
  useEffect(() => {
    player?.setVolume(volume);
  }, [player, volume]);

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

  const onToggleShuffle = useCallback(() => {
    transport.setShuffle.mutate(!(playback?.shuffle ?? false));
  }, [transport, playback]);

  const onCycleRepeat = useCallback(() => {
    const cur = playback?.repeat_mode ?? "off";
    const next = cur === "off" ? "all" : cur === "all" ? "one" : "off";
    transport.setRepeat.mutate(next);
  }, [transport, playback]);

  const onFullscreen = useCallback(() => {
    const el = document.querySelector(".col-right iframe") as HTMLElement | null;
    void el?.requestFullscreen?.();
  }, []);

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

  // The player element — rendered once here so playerRef stays in this component
  // (the sync loop needs it). Passed into the right panel's slot.
  const playerSlot = (
    <div>
      {!unlocked && (
        <button
          onClick={() => setUnlocked(true)}
          style={{ marginBottom: 10, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          <Icon name="speaker" size={16} /> Tap to listen
        </button>
      )}
      <Player
        ref={playerRef}
        audible={unlocked}
        onReady={() => setPlayer(playerRef.current)}
        onEnded={handleEnded}
        onError={handleError}
      />
      {adNotice && (
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
          Catching up after an interruption…
        </p>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      {/* top bar */}
      <header className="topbar">
        <button className="iconbtn" onClick={() => navigate("/")} title="Home">
          <Icon name="home" size={18} />
        </button>
        <div className="pill search" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="search" size={15} /> {room.name} · code {room.code}
        </div>
        <span
          className="muted"
          style={{ color: connected ? "var(--accent)" : "var(--muted)", fontSize: 13 }}
        >
          {connected ? "● live" : "connecting…"}
        </span>
        <div className="avatar" title={isHost ? "Host" : "Listener"}>
          {(profile?.display_name ?? "?").charAt(0).toUpperCase()}
        </div>
      </header>

      {/* 3 columns */}
      <div className="cols">
        {/* LEFT: room info / share */}
        <nav className="col col-left">
          <div className="col-scroll" style={{ display: "grid", gap: 16 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>This room</strong>
              <button className="secondary" onClick={() => navigate("/")}>
                Leave
              </button>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{room.name}</div>
              <div className="muted" style={{ marginTop: 4 }}>
                Share code
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 26,
                  fontWeight: 800,
                  letterSpacing: 2,
                  color: "var(--accent)",
                }}
              >
                {room.code}
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
        </nav>

        {/* MIDDLE: header + search + queue table */}
        <main className="col col-mid">
          <div className="room-header">
            <div className="row" style={{ gap: 16 }}>
              {playback?.is_playing ? (
                <button className="play-fab" onClick={onPause} title="Pause">
                  <Icon name="pause" size={22} />
                </button>
              ) : (
                <button
                  className="play-fab"
                  onClick={onPlay}
                  title="Play"
                  disabled={!nowPlaying && queued.length === 0}
                >
                  <Icon name="play" size={22} />
                </button>
              )}
              <div>
                <div className="muted" style={{ fontSize: 12, textTransform: "uppercase" }}>
                  Collaborative queue
                </div>
                <h1 style={{ margin: "2px 0" }}>{room.name}</h1>
                <div className="muted" style={{ fontSize: 13 }}>
                  {listeners.length} listening · {queued.length} in queue
                </div>
              </div>
            </div>
          </div>

          <div className="col-scroll" style={{ display: "grid", gap: 20 }}>
            <div>
              <SearchBox onAdd={(t) => addTrack.mutate(t)} adding={addTrack.isPending} />
              {addTrack.isError && (
                <p style={{ color: "#ff6b6b" }}>{(addTrack.error as Error).message}</p>
              )}
            </div>

            <Queue
              items={queued}
              myVotes={myVotes ?? new Set()}
              myUserId={session?.user.id ?? ""}
              isHost={isHost}
              onToggleVote={(itemId, voted) => toggleVote.mutate({ itemId, voted })}
              onRemove={(itemId) => removeTrack.mutate(itemId)}
            />
          </div>
        </main>

        {/* RIGHT: player + now playing + listeners */}
        <RightPanel
          roomName={room.name}
          playerSlot={playerSlot}
          active={active}
          nowPlaying={nowPlaying}
          listeners={listeners}
          hostId={room.host_id}
        />
      </div>

      {/* bottom player bar */}
      <PlayerBar
        playback={playback}
        currentItem={nowPlaying}
        hasQueued={queued.length > 0}
        positionMs={displayPosMs}
        volume={volume}
        canRemoveCurrent={isHost || nowPlaying?.added_by === session?.user.id}
        onPlay={onPlay}
        onPause={onPause}
        onNext={onSkip}
        onPrevious={onPrevious}
        onSeek={onSeek}
        onToggleShuffle={onToggleShuffle}
        onCycleRepeat={onCycleRepeat}
        onVolume={setVolume}
        onRemoveCurrent={() => nowPlaying && removeTrack.mutate(nowPlaying.id)}
        onFullscreen={onFullscreen}
      />
    </div>
  );
}
