import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { CallState } from "../chat/calls";
import { Icon, dur, initials, type IconName } from "./ui";

export type CallPeer = { name: string; role: string; image?: string };

export type CallActions = {
  accept: (video: boolean) => void;
  end: () => void;
  mic: () => void;
  cam: () => void;
  requestVideo: () => void;
  cancelVideo: () => void;
  answerSwitch: (agree: boolean) => void;
  mini: (on: boolean) => void;
  retry: () => void;
  voiceInstead: () => void;
  /** Nexconn refused (Audio & Video not enabled): run the same call as an on-device demo. */
  demoInstead?: () => void;
  dismiss: () => void;
  openDevices: (anchor: HTMLElement) => void;
  /** Lobby → place the call with the chosen devices. */
  place: (choice: { camera?: string; mic?: string; cam: boolean; mic_on: boolean }) => void;
  registerLocal: (element: HTMLVideoElement | null) => void;
  registerRemote: (element: HTMLVideoElement | null) => void;
};

type Props = {
  call: CallState;
  peer: CallPeer;
  /** Chat connection state; "connecting" during a call means Nexconn is reconnecting. */
  link: "connected" | "connecting" | "offline" | "elsewhere";
  now: number;
  actions: CallActions;
  /** Preview gallery only: shows the frame without touching devices. */
  preview?: boolean;
};

function phaseLine(call: CallState, peer: CallPeer, seconds: number): string {
  const first = peer.name.split(" ")[0] || "them";
  switch (call.phase) {
    case "lobby":
      return "Check your camera and microphone";
    case "starting":
      return "Starting the call…";
    case "ringing":
      return `Ringing ${first}…`;
    case "incoming":
      return `Incoming ${call.media === "video" ? "video" : "voice"} call`;
    case "connecting":
      return "Connecting…";
    case "connected":
      return dur(seconds);
    case "ended":
      return call.ended ? `${call.ended.label}${call.ended.seconds ? ` · ${dur(call.ended.seconds)}` : ""}` : "Call ended";
    case "failed":
      return call.failure?.title ?? "The call could not start";
  }
}

function Ctrl({
  icon,
  label,
  onClick,
  tone,
  pressed,
  disabled,
  kbd,
  autoFocus,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  tone?: "end" | "ok" | "off";
  pressed?: boolean;
  disabled?: boolean;
  kbd?: string;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ix-cbtn${tone ? ` ${tone}` : ""}`}
      onClick={onClick}
      aria-pressed={pressed}
      disabled={disabled}
      aria-keyshortcuts={kbd}
      title={kbd ? `${label} (${kbd})` : label}
      autoFocus={autoFocus}
    >
      <i>
        <Icon name={icon} />
      </i>
      <span>{label}</span>
    </button>
  );
}

/**
 * The call surface. It only renders what the store says: no state here invents a
 * connection, and remote video is shown only once its element is actually playing.
 */
export function CallScreen({ call, peer, link, now, actions, preview }: Props) {
  const [remoteLive, setRemoteLive] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const video = call.media === "video";
  const seconds = call.startedAt ? (now - call.startedAt) / 1000 : 0;
  const reconnecting = call.phase === "connected" && (call.offline || link !== "connected");
  const first = peer.name.split(" ")[0] || "them";

  useEffect(() => setRemoteLive(false), [call.callId, call.media]);

  const remoteRef = useCallback((element: HTMLVideoElement | null) => actions.registerRemote(element), [actions]);
  const localRef = useCallback((element: HTMLVideoElement | null) => actions.registerLocal(element), [actions]);

  // Keyboard: M mute, V camera, Esc minimise (only when that is safe).
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    const live = call.phase === "connected" || call.phase === "ringing" || call.phase === "connecting";
    if (key === "m" && live && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      actions.mic();
    } else if (key === "v" && live && video && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      actions.cam();
    } else if (key === "escape") {
      if (live) actions.mini(true);
      else if (call.phase === "ended" || call.phase === "failed" || call.phase === "lobby") actions.dismiss();
    } else if (key === "tab") {
      // Keep focus inside the call dialog.
      const items = rootRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), select, [tabindex='0']");
      if (!items || items.length === 0) return;
      const list = Array.from(items);
      const index = list.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        list[list.length - 1].focus();
      } else if (!event.shiftKey && index === list.length - 1) {
        event.preventDefault();
        list[0].focus();
      }
    }
  }

  useEffect(() => {
    if (preview) return;
    const root = rootRef.current;
    if (root && !root.contains(document.activeElement)) root.querySelector<HTMLElement>("[autofocus], .ix-cbtn")?.focus();
  }, [call.phase, preview]);

  const showRemoteVideo = video && call.phase === "connected";
  const showSelf = video && call.cam && (call.phase === "ringing" || call.phase === "connecting" || call.phase === "connected" || call.phase === "starting");
  const speaking = call.phase === "connected" && call.peerLevel > 12 && !call.remoteMicOff;

  let stage: ReactNode;
  if (call.phase === "lobby") {
    stage = <Lobby peer={peer} preview={preview} onCancel={actions.dismiss} onPlace={actions.place} onVoice={actions.voiceInstead} />;
  } else if (call.phase === "failed" && call.failure) {
    const f = call.failure;
    stage = (
      <div className="ix-call-msg" role="alert">
        <span className="glyph">
          <Icon name="alert" />
        </span>
        <h2>{f.title}</h2>
        <p>{f.detail}</p>
        <small className="code">
          {/^\d+$/.test(f.code) ? `Nexconn code ${f.code}` : f.code === "ENGINE" || f.code === "THROW" ? "Call SDK" : `Browser: ${f.code}`}
        </small>
        <div className="row">
          {f.offerDemo && actions.demoInstead ? (
            <button type="button" className="ix-cpill ok" onClick={actions.demoInstead} autoFocus>
              <Icon name="phone" /> Use a demo call
            </button>
          ) : null}
          {f.offerVoice ? (
            <button type="button" className="ix-cpill" onClick={actions.voiceInstead} autoFocus>
              <Icon name="phone" /> Voice call instead
            </button>
          ) : null}
          {f.canRetry ? (
            <button type="button" className="ix-cpill" onClick={actions.retry} autoFocus={!f.offerVoice}>
              Try again
            </button>
          ) : null}
          <button type="button" className="ix-cpill ghost" onClick={actions.dismiss} autoFocus={!f.offerVoice && !f.canRetry && !f.offerDemo}>
            Close
          </button>
        </div>
      </div>
    );
  } else {
    stage = (
      <div className={`ix-call-id${showRemoteVideo && remoteLive && !call.remoteCamOff ? " over-video" : ""}`}>
        {showRemoteVideo && remoteLive && !call.remoteCamOff ? null : (
          <div className={`ix-call-av${speaking ? " speaking" : ""}${call.phase === "ringing" || call.phase === "incoming" ? " ring" : ""}`} aria-hidden="true">
            {peer.image ? <img src={peer.image} alt="" /> : <span>{initials(peer.name)}</span>}
          </div>
        )}
        <p className="eyebrow">{peer.role}</p>
        <h2>{peer.name}</h2>
        <p className={`state${call.phase === "ended" && call.ended?.bad ? " bad" : ""}`}>
          {call.phase === "connected" ? <i className={`dot${reconnecting || call.weak ? " warn" : ""}`} /> : null}
          <span className={call.phase === "connected" ? "ix-mono" : undefined}>{phaseLine(call, peer, seconds)}</span>
          {reconnecting ? <em> · Reconnecting…</em> : call.weak ? <em> · Weak connection</em> : null}
        </p>
        {call.phase === "connected" && video && !remoteLive && !call.remoteCamOff ? (
          <p className="sub">{call.demo ? `Demo call: ${first}'s video is not simulated` : `Waiting for ${first}'s video…`}</p>
        ) : null}
        {call.phase === "connected" && video && call.remoteCamOff ? <p className="sub">{first} turned the camera off</p> : null}
        {call.phase === "connected" && call.remoteMicOff ? <p className="sub">{first} is muted</p> : null}
        {call.phase === "ended" ? <span className="ix-call-fade" aria-hidden="true" /> : null}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`ix-call${showRemoteVideo && remoteLive && !call.remoteCamOff ? " has-video" : ""}${call.phase === "lobby" ? " lobby" : ""}`}
      data-phase={call.phase}
      role="dialog"
      aria-modal="true"
      aria-label={`${video ? "Video" : "Voice"} call with ${peer.name}`}
      onKeyDown={onKeyDown}
    >
      <div className="ix-call-aura" aria-hidden="true" />
      {showRemoteVideo ? (
        <video
          className={`remote${remoteLive && !call.remoteCamOff ? " live" : ""}`}
          ref={preview ? undefined : remoteRef}
          autoPlay
          playsInline
          onPlaying={() => setRemoteLive(true)}
          onEmptied={() => setRemoteLive(false)}
        />
      ) : null}
      <header className="ix-call-top">
        <div className="ctx">
          <span className="brand">
            ShopBridge call
            {call.demo ? (
              <span className="ix-call-demo" title="Simulated on this device. Nothing is sent to Nexconn and no call is recorded.">
                Demo call · simulated
              </span>
            ) : null}
          </span>
          {call.context ? (
            <span className="order">
              {call.context.title} · <span className="ix-mono">{call.context.orderId}</span>
            </span>
          ) : null}
        </div>
        {call.phase === "connected" || call.phase === "ringing" || call.phase === "connecting" ? (
          <>
            <button type="button" className="ix-call-ib" aria-label="Call devices" title="Devices" onClick={(e) => actions.openDevices(e.currentTarget)}>
              <Icon name="sliders" />
            </button>
            <button type="button" className="ix-call-ib" aria-label="Minimise call and keep chatting" title="Keep chatting (Esc)" onClick={() => actions.mini(true)}>
              <Icon name="min" />
            </button>
          </>
        ) : null}
      </header>

      <main className="ix-call-stage">{stage}</main>

      {showSelf ? (
        <figure className={`ix-call-self${call.phase === "connected" ? "" : " big"}`}>
          {preview ? <div className="ph" /> : <video ref={localRef} autoPlay playsInline muted />}
          <figcaption>You{call.mic ? "" : " · muted"}</figcaption>
        </figure>
      ) : null}

      {call.notice ? (
        <p className="ix-call-notice" role="status">
          {call.notice}
        </p>
      ) : null}

      {call.switchRequest ? (
        <div className="ix-call-ask" role="alertdialog" aria-label="Video request">
          <span>{first} wants to switch to video</span>
          <button type="button" className="ix-cpill ghost" onClick={() => actions.answerSwitch(false)}>
            Not now
          </button>
          <button type="button" className="ix-cpill ok" onClick={() => actions.answerSwitch(true)} autoFocus>
            Turn on video
          </button>
        </div>
      ) : null}

      {call.phase === "lobby" || call.phase === "failed" ? null : (
        <nav className="ix-call-dock" aria-label="Call controls">
          {call.phase === "incoming" ? (
            <>
              <Ctrl icon="hang" label="Decline" tone="end" onClick={actions.end} />
              {video ? <Ctrl icon="phone" label="Voice only" onClick={() => actions.accept(false)} /> : null}
              <Ctrl icon={video ? "video" : "phone"} label="Accept" tone="ok" onClick={() => actions.accept(true)} autoFocus />
            </>
          ) : call.phase === "ended" ? (
            <Ctrl icon="x" label="Close" onClick={actions.dismiss} autoFocus />
          ) : (
            <>
              <Ctrl icon={call.mic ? "mic" : "micOff"} label={call.mic ? "Mute" : "Unmute"} tone={call.mic ? undefined : "off"} pressed={!call.mic} onClick={actions.mic} kbd="M" disabled={!call.callId} />
              {video ? (
                <Ctrl icon={call.cam ? "video" : "videoOff"} label={call.cam ? "Camera" : "Camera off"} tone={call.cam ? undefined : "off"} pressed={!call.cam} onClick={actions.cam} kbd="V" disabled={!call.callId} />
              ) : call.switchPending ? (
                <Ctrl icon="x" label="Cancel video" onClick={actions.cancelVideo} />
              ) : (
                <Ctrl icon="video" label="Add video" onClick={actions.requestVideo} disabled={call.phase !== "connected"} />
              )}
              <Ctrl icon="hang" label={call.phase === "connected" ? "End" : "Cancel"} tone="end" onClick={actions.end} autoFocus={call.phase !== "connected"} />
            </>
          )}
        </nav>
      )}
      {call.phase === "connected" && call.switchPending ? (
        <p className="ix-call-notice" role="status">
          Asking {first} to turn on video…
        </p>
      ) : null}
      <p className="ix-sr" aria-live="polite">
        {call.phase === "connected" ? `Connected to ${peer.name}` : phaseLine(call, peer, 0)}
      </p>
    </div>
  );
}

/**
 * Video pre-call check: a real local preview and microphone meter from getUserMedia.
 * Every track is stopped before the call is placed (the SDK opens its own stream).
 */
function Lobby({
  peer,
  preview,
  onCancel,
  onPlace,
  onVoice,
}: {
  peer: CallPeer;
  preview?: boolean;
  onCancel: () => void;
  onVoice: () => void;
  onPlace: (choice: { camera?: string; mic?: string; cam: boolean; mic_on: boolean }) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camera, setCamera] = useState<string>("");
  const [mic, setMic] = useState<string>("");
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(preview ? "ready" : "loading");
  const [problem, setProblem] = useState<string | null>(null);

  const stop = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (preview) return;
    let alive = true;
    let raf = 0;
    let audio: AudioContext | null = null;
    async function open() {
      stop();
      setStatus("loading");
      setProblem(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setProblem("This browser cannot open a camera here. Use HTTPS in a current browser.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: camera ? { deviceId: { exact: camera } } : true,
          audio: mic ? { deviceId: { exact: mic } } : true,
        });
        if (!alive) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!alive) return;
        setCameras(devices.filter((d) => d.kind === "videoinput"));
        setMics(devices.filter((d) => d.kind === "audioinput"));
        setCamera((value) => value || stream.getVideoTracks()[0]?.getSettings().deviceId || "");
        setMic((value) => value || stream.getAudioTracks()[0]?.getSettings().deviceId || "");
        setStatus("ready");
        // Live microphone meter (real input level).
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx && stream.getAudioTracks().length) {
          audio = new Ctx();
          const analyser = audio.createAnalyser();
          analyser.fftSize = 256;
          audio.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
            if (meterRef.current) meterRef.current.style.setProperty("--lvl", String(Math.min(1, peak / 64)));
            raf = requestAnimationFrame(tick);
          };
          tick();
        }
      } catch (caught) {
        if (!alive) return;
        const name = caught instanceof Error ? caught.name : "";
        setStatus("error");
        setProblem(
          name === "NotAllowedError"
            ? "Camera or microphone access is blocked. Allow it from the icon next to the address bar, then reopen this check."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No camera was found. You can still make a voice call."
              : name === "NotReadableError"
                ? "Your camera is in use by another app or tab."
                : "Your camera could not be opened.",
        );
      }
    }
    void open();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      void audio?.close().catch(() => undefined);
      stop();
    };
    // Re-open the preview when the chosen device changes.
  }, [camera, mic, preview, stop]);

  useEffect(() => {
    for (const track of streamRef.current?.getVideoTracks() ?? []) track.enabled = camOn;
  }, [camOn, status]);
  useEffect(() => {
    for (const track of streamRef.current?.getAudioTracks() ?? []) track.enabled = micOn;
  }, [micOn, status]);

  const first = peer.name.split(" ")[0] || "them";
  return (
    <div className="ix-lobby">
      <div className={`ix-lobby-cam${camOn && status === "ready" ? "" : " off"}`}>
        {preview ? <div className="ph" /> : <video ref={videoRef} autoPlay playsInline muted />}
        {status === "loading" ? <p className="note">Opening your camera…</p> : null}
        {status === "error" ? (
          <p className="note err" role="alert">
            {problem}
          </p>
        ) : null}
        {status === "ready" && !camOn ? <p className="note">Camera off</p> : null}
        <div className="tools">
          <button type="button" className={`ix-call-ib${micOn ? "" : " off"}`} aria-pressed={!micOn} aria-label={micOn ? "Mute microphone" : "Unmute microphone"} onClick={() => setMicOn((v) => !v)}>
            <Icon name={micOn ? "mic" : "micOff"} />
          </button>
          <button type="button" className={`ix-call-ib${camOn ? "" : " off"}`} aria-pressed={!camOn} aria-label={camOn ? "Turn camera off" : "Turn camera on"} onClick={() => setCamOn((v) => !v)}>
            <Icon name={camOn ? "video" : "videoOff"} />
          </button>
          <span className="ix-meter" ref={meterRef} aria-hidden="true" title="Microphone level">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
      <div className="ix-lobby-side">
        <p className="eyebrow">Video call · {peer.role}</p>
        <h2>
          Ready to see <em>{first}</em>?
        </h2>
        <p className="lede">Your camera stays on this device until you start the call. Nothing is sent yet.</p>
        {cameras.length > 1 ? (
          <label>
            Camera
            <select value={camera} onChange={(e) => setCamera(e.target.value)}>
              {cameras.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {mics.length > 1 ? (
          <label>
            Microphone
            <select value={mic} onChange={(e) => setMic(e.target.value)}>
              {mics.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="row">
          <button
            type="button"
            className="ix-cpill ok"
            disabled={status === "loading"}
            autoFocus
            onClick={() => {
              stop();
              if (status === "error") {
                onVoice();
                return;
              }
              onPlace({ camera: camera || undefined, mic: mic || undefined, cam: camOn && status === "ready", mic_on: micOn });
            }}
          >
            <Icon name={status === "error" ? "phone" : "video"} /> {status === "error" ? "Call with voice only" : `Call ${first}`}
          </button>
          <button
            type="button"
            className="ix-cpill ghost"
            onClick={() => {
              stop();
              onCancel();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
