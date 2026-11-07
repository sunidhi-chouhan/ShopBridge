import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MESSAGE_TYPES, type ConversationView } from "../../../shared/types";
import {
  acceptCall,
  answerSwitch,
  callState,
  cancelVideoRequest,
  continueAsDemo,
  dismissCall,
  endCall,
  listDevices,
  onCallEnded,
  placeCall,
  registerLocalVideo,
  registerRemoteVideo,
  requestVideo,
  retryAsVoice,
  retryCall,
  selectDevice,
  setCallPolicy,
  setMini,
  subscribeCall,
  toggleCamera,
  toggleMic,
  type CallDevices,
  type CallState,
} from "../chat/calls";
import { currentLinkState, subscribeLink } from "../chat/nexconn";
import { usePresence } from "../chat/presence";
import { navigate } from "../ui/route";
import { useToast } from "../ui/Toast";
import { CallScreen, type CallActions, type CallPeer } from "./CallScreen";
import { sendCustom } from "./engine";
import { Icon, Popover, dur, initials } from "./ui";
import "./inbox.css";

const ROLE_NAME: Record<string, string> = { member: "Buyer", volunteer: "Seller", coordinator: "Support" };

/** Everyone who legitimately belongs to an order conversation. */
function participants(conversation: ConversationView): Set<string> {
  const ids = new Set<string>([conversation.counterpart.id]);
  if (conversation.support) {
    ids.add(conversation.support.member.id);
    if (conversation.support.volunteer) ids.add(conversation.support.volunteer.id);
    if (conversation.support.coordinator) ids.add(conversation.support.coordinator.id);
  }
  return ids;
}

function peerOf(conversations: ConversationView[] | null, peerId: string, orderId: string | undefined, fallbackName: string): CallPeer {
  const conversation = conversations?.find((item) => item.orderId === orderId) ?? null;
  if (conversation) {
    if (conversation.counterpart.id === peerId) {
      return { name: conversation.counterpart.name, role: ROLE_NAME[conversation.counterpart.role] ?? "Member", image: undefined };
    }
    const support = conversation.support;
    if (support?.coordinator?.id === peerId) return { name: support.coordinator.name, role: "ShopBridge support" };
    if (support?.member.id === peerId) return { name: support.member.name, role: "Buyer" };
    if (support?.volunteer?.id === peerId) return { name: support.volunteer.name, role: "Seller" };
  }
  return { name: fallbackName || "ShopBridge member", role: "Order call" };
}

/** Soft synthesized ring (incoming) or ringback (outgoing). Silent if the browser blocks audio. */
function useRingTone(kind: "in" | "out" | null) {
  useEffect(() => {
    if (!kind) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const audio = new Ctx();
    let stopped = false;
    const beep = () => {
      if (stopped || audio.state !== "running") return;
      const t = audio.currentTime;
      const gain = audio.createGain();
      gain.connect(audio.destination);
      const level = kind === "in" ? 0.06 : 0.03;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + 0.04);
      gain.gain.setValueAtTime(level, t + (kind === "in" ? 0.9 : 1.2));
      gain.gain.linearRampToValueAtTime(0, t + (kind === "in" ? 1 : 1.3));
      for (const frequency of kind === "in" ? [523.25, 659.25] : [440, 480]) {
        const osc = audio.createOscillator();
        osc.type = "sine";
        osc.frequency.value = frequency;
        osc.connect(gain);
        osc.start(t);
        osc.stop(t + 1.35);
      }
    };
    void audio.resume().then(beep).catch(() => undefined);
    const timer = window.setInterval(beep, kind === "in" ? 2200 : 3500);
    if (kind === "in" && "vibrate" in navigator) navigator.vibrate?.([300, 200, 300]);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void audio.close().catch(() => undefined);
    };
  }, [kind]);
}

/** Show who is calling in the tab title so a background tab is noticed. */
function useTitleFlash(text: string | null) {
  useEffect(() => {
    if (!text) return;
    const original = document.title;
    let on = false;
    const timer = window.setInterval(() => {
      on = !on;
      document.title = on ? text : original;
    }, 1200);
    return () => {
      window.clearInterval(timer);
      document.title = original;
    };
  }, [text]);
}

function DevicesMenu({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const [devices, setDevices] = useState<CallDevices | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void listDevices()
      .then(setDevices)
      .catch(() => setError("Devices could not be listed."));
  }, []);
  const pick = (kind: "camera" | "mic" | "speaker", id: string) =>
    void selectDevice(kind, id).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "That device could not be used."));
  const group = (label: string, kind: "camera" | "mic" | "speaker", list: MediaDeviceInfo[]) =>
    list.length ? (
      <label>
        {label}
        <select onChange={(e) => pick(kind, e.target.value)} defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {list.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
    ) : null;
  return (
    <Popover anchor={anchor} className="ix-lang-pop ix-call-pop" alignRight onClose={onClose}>
      <b>Devices</b>
      {devices ? (
        <>
          {group("Camera", "camera", devices.cameras)}
          {group("Microphone", "mic", devices.mics)}
          {group("Speaker", "speaker", devices.speakers)}
          {!devices.cameras.length && !devices.mics.length ? <p className="ix-small">No devices found.</p> : null}
        </>
      ) : (
        <p className="ix-small">Looking for devices…</p>
      )}
      {error ? <p className="ix-error">{error}</p> : null}
    </Popover>
  );
}

/**
 * Global call surface: incoming calls ring on any page. When a placed call ends, the caller
 * posts an SB:Call log card into the order conversation so both sides see it in the chat.
 */
export function CallLayer({ selfId }: { selfId: string }) {
  const [call, setCall] = useState<CallState | null>(callState());
  const [link, setLink] = useState(currentLinkState());
  const [now, setNow] = useState(() => Date.now());
  const [devicesAnchor, setDevicesAnchor] = useState<HTMLElement | null>(null);
  const presence = usePresence();
  const toast = useToast();
  const conversationsRef = useRef(presence.conversations);
  conversationsRef.current = presence.conversations;
  const refreshRef = useRef(presence.refresh);
  refreshRef.current = presence.refresh;

  useEffect(() => subscribeCall(setCall), []);
  useEffect(() => subscribeLink(setLink), []);
  useEffect(() => {
    if (call?.phase !== "connected" && call?.phase !== "ended") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [call?.phase]);

  // Only people in that order's conversation may ring this user.
  useEffect(() => {
    setCallPolicy({
      selfId,
      async allow(callerId, context) {
        if (!context) return false;
        const find = () => conversationsRef.current?.find((item) => item.orderId === context.orderId && item.channelId === context.channelId) ?? null;
        let conversation = find();
        if (!conversation) {
          await refreshRef.current().catch(() => undefined);
          conversation = find();
        }
        return conversation !== null && participants(conversation).has(callerId);
      },
    });
    return () => setCallPolicy(null);
  }, [selfId]);

  useEffect(
    () =>
      onCallEnded((ended) => {
        if (ended.demo) {
          // Demo calls stay on this device: no call log is written into the real conversation.
          if (ended.direction === "in" && !ended.connected && ended.reason === 1002) toast("Missed demo call");
          else toast("Demo call ended. It was simulated on this device and not saved to the conversation.");
          return;
        }
        if (ended.direction === "in" && !ended.connected && (ended.reason === 1002 || ended.reason === 1003)) {
          const who = peerOf(conversationsRef.current, ended.peerId, ended.context?.orderId, presence.senderName(ended.peerId)).name;
          toast(`Missed ${ended.media === "video" ? "video" : "voice"} call from ${who}`);
        }
        if (ended.direction !== "out" || !ended.context) return;
        const content = {
          media: ended.media,
          dur: ended.seconds,
          missed: !ended.connected,
          orderId: ended.context.orderId,
        };
        // Let an open chat for this channel send it (so it appears immediately); otherwise send here.
        const event = new CustomEvent("ix:call-log", { detail: { channelId: ended.context.channelId, content, handled: false } });
        window.dispatchEvent(event);
        if (!event.detail.handled) {
          void sendCustom(ended.context.channelId, MESSAGE_TYPES.call, content, selfId).catch(() => undefined);
        }
      }),
    [selfId, presence, toast],
  );

  const peer = useMemo(
    () => (call ? peerOf(presence.conversations, call.peerId, call.context?.orderId, presence.senderName(call.peerId)) : null),
    [call, presence],
  );
  useRingTone(call?.phase === "incoming" ? "in" : call?.phase === "ringing" ? "out" : null);
  useTitleFlash(call?.phase === "incoming" && peer ? `📞 ${peer.name} is calling` : null);

  const act = useCallback(
    (task: () => Promise<void>) => void task().catch((caught: unknown) => toast(caught instanceof Error ? caught.message : "Call action failed", "error")),
    [toast],
  );

  const actions = useMemo<CallActions>(
    () => ({
      accept: (video) => act(() => acceptCall(video)),
      end: () => act(endCall),
      mic: () => act(toggleMic),
      cam: () => act(toggleCamera),
      requestVideo: () => act(requestVideo),
      cancelVideo: () => act(cancelVideoRequest),
      answerSwitch: (agree) => act(() => answerSwitch(agree)),
      mini: (on) => setMini(on),
      retry: () => act(retryCall),
      voiceInstead: () => act(retryAsVoice),
      demoInstead: () => act(continueAsDemo),
      dismiss: dismissCall,
      openDevices: (anchor) => setDevicesAnchor(anchor),
      place: (choice) => act(() => placeCall({ ...choice, skipCheck: true })),
      registerLocal: registerLocalVideo,
      registerRemote: (element) => {
        const id = callState()?.peerId;
        if (id) registerRemoteVideo(id, element);
      },
    }),
    [act],
  );

  if (!call || !peer) return null;

  if (call.mini) {
    const seconds = call.startedAt ? (now - call.startedAt) / 1000 : 0;
    return createPortal(
      <div className="ix-mini" role="region" aria-label={`Call with ${peer.name}`}>
        {call.media === "video" && call.phase === "connected" ? <video ref={actions.registerRemote} autoPlay playsInline /> : null}
        <div className="mb">
          <span className={`av${call.peerLevel > 12 ? " speaking" : ""}`} aria-hidden="true">
            {initials(peer.name)}
          </span>
          <div>
            <b>{peer.name}</b>
            <span className="ix-mono">{call.phase === "connected" ? dur(seconds) : call.phase === "ringing" ? "Ringing…" : "Connecting…"}</span>
          </div>
          <button
            type="button"
            aria-label="Return to call"
            title="Return to call"
            onClick={() => {
              setMini(false);
              if (call.context) navigate("inbox", call.context.orderId);
            }}
          >
            <Icon name="min" />
          </button>
          <button type="button" className={call.mic ? undefined : "off"} aria-pressed={!call.mic} aria-label={call.mic ? "Mute" : "Unmute"} onClick={actions.mic}>
            <Icon name={call.mic ? "mic" : "micOff"} />
          </button>
          <button type="button" className="end" aria-label="End call" onClick={actions.end}>
            <Icon name="hang" />
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <>
      <CallScreen call={call} peer={peer} link={link} now={now} actions={actions} />
      {devicesAnchor ? <DevicesMenu anchor={devicesAnchor} onClose={() => setDevicesAnchor(null)} /> : null}
    </>,
    document.body,
  );
}
